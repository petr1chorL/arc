"""Characterize existing rubric semantics before the Netlify migration."""
import pytest
from sqlalchemy import select
from app.models import RubricRecord, RubricVersionRecord
from api_test_support import create_authenticated_client, csrf_headers, workspace_url


@pytest.fixture
def rubric_client(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'rubric-guard.db'}")
    with client:
        base = workspace_url(workspace_id, "/evaluations/rubrics")
        response = client.post(base, headers=csrf_headers(client), json={"name": "Guard rubric", "artifact": "Report",
            "gate": "Required", "passScore": 80, "dimensions": [{"id": "quality", "name": "Quality", "weight": 100}]})
        assert response.status_code == 201
        yield client, base, response.json()
    client.app.state.session_factory.kw["bind"].dispose()


@pytest.mark.parametrize("corruption", [None, [], {"dimensions": None}, {"judge_type": "unknown"}])
def test_rubric_history_corruption_is_fixed_conflict_without_rewrite(rubric_client, corruption):
    client, base, rubric = rubric_client
    published = client.post(f"{base}/{rubric['id']}/publish", headers=csrf_headers(client))
    assert published.status_code == 201
    with client.app.state.session_factory() as session:
        record = session.get(RubricVersionRecord, published.json()["id"])
        malformed = {**record.snapshot, **corruption} if isinstance(corruption, dict) else corruption
        record.snapshot = malformed
        session.commit()
    response = client.get(f"{base}/{rubric['id']}/versions")
    assert response.status_code == 409
    assert response.json() == {"detail": "历史评分量规结构不符合要求，需先完成治理"}
    with client.app.state.session_factory() as session:
        assert session.get(RubricVersionRecord, published.json()["id"]).snapshot == malformed


def test_corrupt_current_rubric_is_rejected_without_publication_or_deactivation(rubric_client):
    client, base, rubric = rubric_client
    with client.app.state.session_factory() as session:
        session.get(RubricRecord, rubric["id"]).dimensions = None
        session.commit()
    for method, path in [("GET", base), ("POST", f"{base}/{rubric['id']}/publish"), ("POST", f"{base}/{rubric['id']}/deactivate")]:
        response = client.request(method, path, headers=csrf_headers(client))
        assert response.status_code == 409
        assert response.json() == {"detail": "历史评分量规结构不符合要求，需先完成治理"}
        with client.app.state.session_factory() as session:
            record = session.get(RubricRecord, rubric["id"])
            assert (record.dimensions, record.status, record.version) == (None, "draft", "v0.1.0")
            assert list(session.scalars(select(RubricVersionRecord).where(RubricVersionRecord.rubric_id == rubric["id"]))) == []


def test_existing_candidate_rubric_version_rejects_publication_without_state_write(rubric_client):
    client, base, rubric = rubric_client
    with client.app.state.session_factory() as session:
        record = session.get(RubricRecord, rubric["id"])
        session.add(RubricVersionRecord(workspace_id=record.workspace_id, rubric_id=record.id, version="v1.1.0", snapshot={}))
        session.commit()
    response = client.post(f"{base}/{rubric['id']}/publish", headers=csrf_headers(client))
    assert response.status_code == 409
    assert response.json() == {"detail": "评分量规版本号冲突，需先完成治理"}
    with client.app.state.session_factory() as session:
        record = session.get(RubricRecord, rubric["id"])
        assert (record.status, record.version) == ("draft", "v0.1.0")
        assert len(list(session.scalars(select(RubricVersionRecord).where(RubricVersionRecord.rubric_id == record.id)))) == 1


@pytest.mark.parametrize("method,path", [
    ("POST", "/evaluations/rubrics"),
    ("PATCH", "/evaluations/rubrics/missing"),
    ("POST", "/feedback-candidates/missing/confirm"),
])
def test_governance_validation_uses_fixed_error_without_echo(tmp_path, method, path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'validation.db'}")
    with client:
        response = client.request(method, workspace_url(workspace_id, path), headers=csrf_headers(client),
                                  json={"unexpected": "synthetic-private-marker"})
        assert response.status_code == 422
        assert response.json() == {"detail": "量规或样本请求字段不符合要求"}
        assert "synthetic-private-marker" not in response.text


def test_rubric_patch_is_full_write_and_publication_snapshots_active_state(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'rubric-contract.db'}")
    with client:
        base = workspace_url(workspace_id, "/evaluations/rubrics")
        provider = client.post(workspace_url(workspace_id, "/model-providers"), headers=csrf_headers(client), json={
            "name": "Synthetic", "baseUrl": "https://models.example.invalid", "defaultModel": "synthetic",
            "secretRef": "SYNTHETIC_KEY",
        })
        assert provider.status_code == 201
        body = {"name": "Rubric", "artifact": "Report", "gate": "Required", "passScore": 80,
                "dimensions": [{"id": "quality", "name": "Quality", "weight": 100, "criteria": "Grounded"}]}
        created = client.post(base, headers=csrf_headers(client), json={**body, "judgeType": "llm",
            "judgeModel": "synthetic", "modelProviderId": provider.json()["id"]})
        assert created.status_code == 201
        path = f"{base}/{created.json()['id']}"
        partial = client.patch(path, headers=csrf_headers(client), json={"name": "Partial"})
        assert partial.status_code == 422
        assert client.get(base).json() == [created.json()]
        replaced = client.patch(path, headers=csrf_headers(client), json=body)
        assert replaced.status_code == 200
        assert replaced.json()["judgeType"] == "deterministic"
        assert replaced.json()["judgeModel"] == ""
        assert "modelProviderId" not in replaced.json()
        published = client.post(f"{path}/publish", headers=csrf_headers(client))
        assert published.status_code == 201
        snapshot = published.json()["snapshot"]
        assert snapshot["status"] == "active"
        assert snapshot["version"] == published.json()["version"] == "v1.0.0"
        assert snapshot["dimensions"][0]["id"] == "quality"
        assert client.patch(path, headers=csrf_headers(client), json={**body, "passScore": 95}).status_code == 200
        assert client.post(f"{path}/deactivate", headers=csrf_headers(client)).status_code == 200
        assert client.get(f"{path}/versions").json() == [published.json()]
