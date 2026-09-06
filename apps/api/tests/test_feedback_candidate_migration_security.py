"""Migration source guards using a complete synthetic human-review lineage."""
import pytest
from types import SimpleNamespace
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError

from api_test_support import csrf_headers, workspace_url
from app.models import (ArtifactDiffRecord, ArtifactVersionRecord, AuditEventRecord, FeedbackCandidateRecord,
                        GoldenSampleRecord, HumanTaskRecord, WorkflowRunRecord)
from test_human_task_api import create_task, decision_body, login_reviewer


@pytest.fixture
def expert_candidate(tmp_path):
    client, workspace_id, task, reviewers = create_task(tmp_path)
    try:
        login_reviewer(client, reviewers[0]["email"])
        response = client.post(workspace_url(workspace_id, f"/human-tasks/{task['id']}/decisions"),
            headers=csrf_headers(client), json={**decision_body(task, reviewers[0]["id"], "modify_and_approve"),
                "modifiedContent": "Synthetic reviewed content", "tags": ["golden"]})
        assert response.status_code == 200
        candidate = client.get(workspace_url(workspace_id, "/feedback-candidates")).json()[0]
        login_reviewer(client, next(reviewer for reviewer in reviewers if reviewer["isExpert"])["email"])
        yield client, workspace_id, candidate
    finally:
        client.close()
        client.app.state.session_factory.kw["bind"].dispose()


def test_confirmation_replay_and_conflict_messages(expert_candidate):
    client, workspace_id, candidate = expert_candidate
    path = workspace_url(workspace_id, f"/feedback-candidates/{candidate['id']}/confirm")
    body = {"reason": "Synthetic confirmation", "idempotencyKey": "synthetic-confirm"}
    missing = client.post(workspace_url(workspace_id, "/feedback-candidates/missing/confirm"),
        headers=csrf_headers(client), json=body)
    assert missing.status_code == 422
    assert missing.json() == {"detail": "反馈候选不存在"}
    created = client.post(path, headers=csrf_headers(client), json=body)
    assert created.status_code == 201
    replay = client.post(path, headers=csrf_headers(client), json={**body, "reason": "Do not replace"})
    assert replay.status_code == 201
    assert replay.json() == created.json()
    conflict = client.post(path, headers=csrf_headers(client), json={**body, "idempotencyKey": "different"})
    assert conflict.status_code == 409
    assert conflict.json() == {"detail": "反馈候选已确认黄金样本"}


def test_confirmation_replay_rejects_foreign_historical_sample(expert_candidate):
    client, workspace_id, candidate = expert_candidate
    path = workspace_url(workspace_id, f"/feedback-candidates/{candidate['id']}/confirm")
    body = {"reason": "Synthetic confirmation", "idempotencyKey": "synthetic-confirm"}
    created = client.post(path, headers=csrf_headers(client), json=body)
    assert created.status_code == 201
    with client.app.state.session_factory() as session:
        sample = session.get(GoldenSampleRecord, created.json()["id"])
        sample.workspace_id = "foreign-space"
        session.commit()
        audits_before = set(session.scalars(select(AuditEventRecord.id)))
    response = client.post(path, headers=csrf_headers(client), json=body)
    assert response.status_code == 409
    assert response.json() == {"detail": "幂等键已用于其他黄金样本"}
    assert "Synthetic reviewed content" not in response.text
    with client.app.state.session_factory() as session:
        assert session.get(GoldenSampleRecord, created.json()["id"]).workspace_id == "foreign-space"
        assert set(session.scalars(select(AuditEventRecord.id))) == audits_before


@pytest.mark.parametrize("field,model", [
    ("modified_version_id", ArtifactVersionRecord),
    ("workflow_run_id", WorkflowRunRecord),
    ("human_task_id", HumanTaskRecord),
])
@pytest.mark.parametrize("invalid", ["missing", "foreign"])
def test_confirmation_rejects_invalid_source_without_partial_sample(expert_candidate, field, model, invalid):
    client, workspace_id, candidate = expert_candidate
    with client.app.state.session_factory() as session:
        record = session.get(FeedbackCandidateRecord, candidate["id"])
        if invalid == "missing":
            setattr(record, field, "missing-source")
        else:
            session.get(model, getattr(record, field)).workspace_id = "foreign-space"
        session.commit()
        audits_before = set(session.scalars(select(AuditEventRecord.id)))
    response = client.post(workspace_url(workspace_id, f"/feedback-candidates/{candidate['id']}/confirm"),
        headers=csrf_headers(client), json={"reason": "Synthetic confirmation", "idempotencyKey": "synthetic-confirm"})
    assert response.status_code == 422
    assert response.json() == {"detail": "黄金样本来源不完整，需先完成治理"}
    with client.app.state.session_factory() as session:
        assert list(session.scalars(select(GoldenSampleRecord.id))) == []
        record = session.get(FeedbackCandidateRecord, candidate["id"])
        assert record.status == candidate["status"] and record.confirmed_at is None
        assert set(session.scalars(select(AuditEventRecord.id))) == audits_before


def test_confirmation_audit_failure_rolls_back_sample_and_candidate(expert_candidate):
    client, workspace_id, candidate = expert_candidate
    with client.app.state.session_factory() as session:
        audits_before = set(session.scalars(select(AuditEventRecord.id)))

    def reject_audit(mapper, connection, target):
        if target.event_type == "golden_sample_confirmed":
            raise RuntimeError("synthetic audit failure")

    event.listen(AuditEventRecord, "before_insert", reject_audit)
    try:
        with pytest.raises(RuntimeError, match="synthetic audit failure"):
            client.post(workspace_url(workspace_id, f"/feedback-candidates/{candidate['id']}/confirm"),
                headers=csrf_headers(client), json={"reason": "Synthetic confirmation", "idempotencyKey": "synthetic-confirm"})
    finally:
        event.remove(AuditEventRecord, "before_insert", reject_audit)
    with client.app.state.session_factory() as session:
        assert list(session.scalars(select(GoldenSampleRecord.id))) == []
        record = session.get(FeedbackCandidateRecord, candidate["id"])
        assert record.status == candidate["status"] and record.confirmed_at is None
        assert set(session.scalars(select(AuditEventRecord.id))) == audits_before


@pytest.mark.parametrize("field,model", [
    ("original_version_id", ArtifactVersionRecord),
    ("modified_version_id", ArtifactVersionRecord),
    ("diff_id", ArtifactDiffRecord),
])
@pytest.mark.parametrize("invalid", ["missing", "foreign"])
def test_candidate_reads_reject_invalid_source_without_rewriting(tmp_path, field, model, invalid):
    client, workspace_id, task, reviewers = create_task(tmp_path)
    try:
        login_reviewer(client, reviewers[0]["email"])
        decision = client.post(workspace_url(workspace_id, f"/human-tasks/{task['id']}/decisions"),
            headers=csrf_headers(client), json={**decision_body(task, reviewers[0]["id"], "modify_and_approve"),
                "modifiedContent": "Synthetic reviewed content", "tags": ["golden"]})
        assert decision.status_code == 200
        base = workspace_url(workspace_id, "/feedback-candidates")
        candidate = client.get(base).json()[0]
        with client.app.state.session_factory() as session:
            record = session.get(FeedbackCandidateRecord, candidate["id"])
            original_id = getattr(record, field)
            if invalid == "missing":
                setattr(record, field, "missing-source")
            else:
                session.get(model, original_id).workspace_id = "foreign-space"
            session.commit()
            before_ids = list(session.scalars(select(FeedbackCandidateRecord.id)))
        for path in (base, f"{base}/{candidate['id']}"):
            response = client.get(path)
            assert response.status_code == 409
            assert response.json() == {"detail": "反馈候选来源不完整，需先完成治理"}
            assert "Synthetic reviewed content" not in response.text
        with client.app.state.session_factory() as session:
            assert list(session.scalars(select(FeedbackCandidateRecord.id))) == before_ids
            record = session.get(FeedbackCandidateRecord, candidate["id"])
            assert getattr(record, field) == ("missing-source" if invalid == "missing" else original_id)
            if invalid == "foreign":
                assert session.get(model, original_id).workspace_id == "foreign-space"
    finally:
        client.close()
        client.app.state.session_factory.kw["bind"].dispose()


@pytest.mark.parametrize("constraint,sqlstate,known", [
    ("uq_golden_sample_candidate", "23505", True),
    ("unrelated_constraint", "23505", False),
    ("uq_golden_sample_candidate", "23503", False),
    (None, None, False),
])
def test_only_known_sample_unique_constraints_map_to_conflict(expert_candidate, monkeypatch, constraint, sqlstate, known):
    client, workspace_id, candidate = expert_candidate
    original = Exception("synthetic integrity failure")
    monkeypatch.setattr(original, "sqlstate", sqlstate, raising=False)
    monkeypatch.setattr(original, "diag", SimpleNamespace(constraint_name=constraint), raising=False)

    def reject_insert(mapper, connection, target):
        raise IntegrityError("synthetic insert", {}, original)

    event.listen(GoldenSampleRecord, "before_insert", reject_insert)
    try:
        path = workspace_url(workspace_id, f"/feedback-candidates/{candidate['id']}/confirm")
        body = {"reason": "Synthetic confirmation", "idempotencyKey": "synthetic-confirm"}
        if known:
            response = client.post(path, json=body, headers=csrf_headers(client))
            assert response.status_code == 409
            assert response.json() == {"detail": "黄金样本确认冲突，请刷新后重试"}
        else:
            with pytest.raises(IntegrityError):
                client.post(path, json=body, headers=csrf_headers(client))
    finally:
        event.remove(GoldenSampleRecord, "before_insert", reject_insert)
    with client.app.state.session_factory() as session:
        assert list(session.scalars(select(GoldenSampleRecord.id))) == []
        record = session.get(FeedbackCandidateRecord, candidate["id"])
        assert record.status == candidate["status"] and record.confirmed_at is None
