from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from api_test_support import create_authenticated_client, csrf_headers, workspace_url
from test_human_workflow_execution import (
    FakeGateway,
    FakeModelResult,
    create_human_workflow,
)


class MutableClock:
    def __init__(self, current: datetime):
        self.current = current

    def __call__(self) -> datetime:
        return self.current

    def advance(self, **delta) -> None:
        self.current += timedelta(**delta)


def create_task(
    tmp_path,
    *,
    policy: str = "any_one",
    required: int = 1,
) -> tuple[TestClient, str, dict, list[dict]]:
    gateway = FakeGateway([
        FakeModelResult("This generated draft is ready for human task queue testing."),
        FakeModelResult("This rerun draft is ready for the next review cycle."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / f'{policy}-{required}.db'}",
        model_gateway=gateway,
    )
    reviewers = client.get(workspace_url(workspace_id, "/reviewers")).json()
    human_data = {
        "reviewPolicy": policy,
        "requiredApprovals": required,
    }
    if policy == "threshold":
        human_data |= {
            "assignmentType": "direct",
            "reviewerIds": [reviewers[0]["id"], reviewers[1]["id"]],
        }
    workflow = create_human_workflow(client, workspace_id, human_data)
    client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Create a task for queue testing."},
        headers=csrf_headers(client),
    )
    task = client.get(workspace_url(workspace_id, "/human-tasks")).json()[0]
    reviewers = client.get(workspace_url(workspace_id, "/reviewers")).json()
    return client, workspace_id, task, reviewers


def decision_body(task: dict, reviewer_id: str, decision: str) -> dict:
    return {
        "reviewerId": reviewer_id,
        "decision": decision,
        "reason": f"{decision} in test",
        "artifactVersionId": task["artifactVersionId"],
        "idempotencyKey": f"{task['id']}-{reviewer_id}-{decision}",
    }


def test_human_task_queue_supports_assignment_status_sla_and_active_filters(tmp_path):
    client, workspace_id, task, reviewers = create_task(tmp_path)
    groups = client.get(workspace_url(workspace_id, "/review-groups")).json()
    assigned_group = next(group for group in groups if group["id"] == task["assigneeGroupId"])

    claimed = client.post(
        workspace_url(workspace_id, f"/human-tasks/{task['id']}/claim"),
        json={"reviewerId": reviewers[0]["id"]},
        headers=csrf_headers(client),
    ).json()

    filtered = client.get(
        workspace_url(workspace_id, "/human-tasks"),
        params={
            "status": claimed["status"],
            "reviewerId": reviewers[0]["id"],
            "groupId": assigned_group["id"],
            "slaStatus": claimed["slaStatus"],
            "active": True,
        },
    ).json()
    assert [item["id"] for item in filtered] == [claimed["id"]]

    decided = client.post(
        workspace_url(workspace_id, f"/human-tasks/{task['id']}/decisions"),
        json=decision_body(task, reviewers[0]["id"], "approve"),
        headers=csrf_headers(client),
    ).json()

    active_items = client.get(
        workspace_url(workspace_id, "/human-tasks"),
        params={"active": True},
    ).json()
    assert all(item["id"] != task["id"] or item["status"] == decided["status"] for item in active_items)
    closed = client.get(
        workspace_url(workspace_id, "/human-tasks"),
        params={"status": decided["status"], "active": False},
    ).json()
    assert [item["id"] for item in closed] == [task["id"]]


def test_directory_claim_conflict_and_transfer(tmp_path):
    client, workspace_id, task, reviewers = create_task(tmp_path)
    groups_response = client.get(workspace_url(workspace_id, "/review-groups"))

    assert len(reviewers) == 3
    assert groups_response.status_code == 200
    groups = groups_response.json()
    assert len(groups) == 2

    first, second = reviewers[:2]
    claimed = client.post(
        workspace_url(workspace_id, f"/human-tasks/{task['id']}/claim"),
        json={"reviewerId": first["id"]},
        headers=csrf_headers(client),
    )
    assert claimed.status_code == 200
    assert claimed.json()["assigneeReviewerId"] == first["id"]

    conflict = client.post(
        workspace_url(workspace_id, f"/human-tasks/{task['id']}/claim"),
        json={"reviewerId": second["id"]},
        headers=csrf_headers(client),
    )
    assert conflict.status_code == 409

    transferred = client.post(
        workspace_url(workspace_id, f"/human-tasks/{task['id']}/transfer"),
        json={
            "actorId": first["id"],
            "reviewerId": second["id"],
            "reason": "transfer in test",
        },
        headers=csrf_headers(client),
    )
    assert transferred.status_code == 200
    assert transferred.json()["assigneeReviewerId"] == second["id"]


def test_round_robin_assigns_successive_reviewers(tmp_path):
    gateway = FakeGateway([
        FakeModelResult("Round robin draft one is ready for review."),
        FakeModelResult("Round robin draft two is ready for review."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'round-robin.db'}",
        model_gateway=gateway,
    )
    groups = client.get(workspace_url(workspace_id, "/review-groups")).json()
    workflow = create_human_workflow(
        client,
        workspace_id,
        {"assignmentType": "round_robin", "groupId": groups[0]["id"]},
    )
    reviewers = client.get(workspace_url(workspace_id, "/reviewers")).json()

    client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Round robin first run"},
        headers=csrf_headers(client),
    )
    first_task = client.get(workspace_url(workspace_id, "/human-tasks")).json()[0]
    client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Round robin second run"},
        headers=csrf_headers(client),
    )
    tasks = client.get(workspace_url(workspace_id, "/human-tasks")).json()
    second_task = next(item for item in tasks if item["id"] != first_task["id"])

    assert first_task["assigneeReviewerId"] == reviewers[0]["id"]
    assert second_task["assigneeReviewerId"] == reviewers[1]["id"]
    assert first_task["status"] == second_task["status"]


@pytest.mark.parametrize(
    ("policy", "required"),
    [
        ("any_one", 1),
        ("all", 2),
        ("threshold", 2),
    ],
)
def test_countersign_policies(tmp_path, policy: str, required: int):
    client, workspace_id, task, reviewers = create_task(tmp_path, policy=policy, required=required)
    initial_status = task["status"]

    first = client.post(
        workspace_url(workspace_id, f"/human-tasks/{task['id']}/decisions"),
        json=decision_body(task, reviewers[0]["id"], "approve"),
        headers=csrf_headers(client),
    )
    assert first.status_code == 200
    assert first.json()["approvalProgress"] == {"required": required, "received": 1}

    if required == 1:
        assert first.json()["status"] == "已通过"
        return

    assert first.json()["status"] != "已通过"
    second = client.post(
        workspace_url(workspace_id, f"/human-tasks/{task['id']}/decisions"),
        json=decision_body(task, reviewers[1]["id"], "approve"),
        headers=csrf_headers(client),
    )
    assert second.status_code == 200
    assert second.json()["status"] == "已通过"
    assert second.json()["approvalProgress"] == {"required": 2, "received": 2}


@pytest.mark.parametrize("decision", ["reject", "return_for_rerun"])
def test_reject_and_rerun_are_immediate(tmp_path, decision: str):
    client, workspace_id, task, reviewers = create_task(tmp_path, policy="all", required=2)

    response = client.post(
        workspace_url(workspace_id, f"/human-tasks/{task['id']}/decisions"),
        json=decision_body(task, reviewers[0]["id"], decision),
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    assert response.json()["status"] in {"已驳回", "已退回"}


def test_sla_refresh_reminds_overdues_and_escalates_once(tmp_path):
    clock = MutableClock(datetime(2026, 6, 25, 1, 0, tzinfo=timezone.utc))
    gateway = FakeGateway([
        FakeModelResult("SLA test draft is waiting for attention."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'sla.db'}",
        model_gateway=gateway,
        human_task_clock=clock,
    )
    workflow = create_human_workflow(
        client,
        workspace_id,
        {
            "dueMinutes": 60,
            "escalationMinutes": 120,
        },
    )
    client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Exercise SLA transitions"},
        headers=csrf_headers(client),
    )
    task = client.get(workspace_url(workspace_id, "/human-tasks")).json()[0]
    groups = client.get(workspace_url(workspace_id, "/review-groups")).json()
    escalation_group = next(group for group in groups if group["isEscalationGroup"])

    initial_status = task["slaStatus"]

    clock.advance(minutes=50)
    due_soon = client.get(workspace_url(workspace_id, "/human-tasks")).json()[0]
    clock.advance(minutes=20)
    overdue = client.get(workspace_url(workspace_id, f"/human-tasks/{task['id']}")).json()
    clock.advance(minutes=60)
    escalated = client.get(workspace_url(workspace_id, "/human-tasks")).json()[0]

    assert len({initial_status, due_soon["slaStatus"], overdue["slaStatus"], escalated["slaStatus"]}) == 4
    assert escalated["assigneeGroupId"] == escalation_group["id"]

    client.get(workspace_url(workspace_id, "/human-tasks"))
    detail = client.get(workspace_url(workspace_id, f"/human-tasks/{task['id']}")).json()
    event_types = [event["eventType"] for event in detail["auditEvents"]]
    notification_types = [item["eventType"] for item in detail["notifications"]]
    assert event_types.count("sla_due_soon") == 1
    assert event_types.count("sla_overdue") == 1
    assert event_types.count("sla_escalated") == 1
    assert notification_types.count("due_soon") == 1
    assert notification_types.count("escalated") == 1


def test_only_human_modification_creates_feedback_candidate(tmp_path):
    approve_path = tmp_path / "approve"
    approve_path.mkdir()
    approve_client, approve_workspace_id, approve_task, approve_reviewers = create_task(approve_path)
    approved = approve_client.post(
        workspace_url(approve_workspace_id, f"/human-tasks/{approve_task['id']}/decisions"),
        json=decision_body(approve_task, approve_reviewers[0]["id"], "approve"),
        headers=csrf_headers(approve_client),
    )
    assert approved.status_code == 200
    assert approve_client.get(workspace_url(approve_workspace_id, "/feedback-candidates")).json() == []

    modified_path = tmp_path / "modified"
    modified_path.mkdir()
    client, workspace_id, task, reviewers = create_task(modified_path)
    original_content = client.get(
        workspace_url(workspace_id, f"/human-tasks/{task['id']}"),
    ).json()["artifact"]["content"]
    modified_content = "The reviewer rewrote the draft before approving it."
    response = client.post(
        workspace_url(workspace_id, f"/human-tasks/{task['id']}/decisions"),
        json={
            **decision_body(task, reviewers[0]["id"], "modify_and_approve"),
            "modifiedContent": modified_content,
            "tags": ["edited", "quality"],
        },
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    candidates = client.get(workspace_url(workspace_id, "/feedback-candidates")).json()
    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["originalContent"] == original_content
    assert candidate["modifiedContent"] == modified_content
    assert candidate["unifiedDiff"]
    assert candidate["reason"] == "modify_and_approve in test"
    assert candidate["tags"] == ["edited", "quality"]
    assert candidate["workflowRunId"] == task["workflowRunId"]
    assert candidate["sourceNodeId"] == task["sourceNodeId"]
    assert candidate["status"]


def test_expert_confirms_feedback_candidate_idempotently(tmp_path):
    client, workspace_id, task, reviewers = create_task(tmp_path)
    client.post(
        workspace_url(workspace_id, f"/human-tasks/{task['id']}/decisions"),
        json={
            **decision_body(task, reviewers[0]["id"], "modify_and_approve"),
            "modifiedContent": "The expert-ready rewrite becomes the golden output.",
            "tags": ["golden"],
        },
        headers=csrf_headers(client),
    )
    candidate = client.get(workspace_url(workspace_id, "/feedback-candidates")).json()[0]
    non_expert = reviewers[0]
    expert = next(reviewer for reviewer in reviewers if reviewer["isExpert"])

    rejected = client.post(
        workspace_url(workspace_id, f"/feedback-candidates/{candidate['id']}/confirm"),
        json={
            "reviewerId": non_expert["id"],
            "reason": "not allowed",
            "idempotencyKey": "golden-confirm-1",
        },
        headers=csrf_headers(client),
    )
    assert rejected.status_code == 422

    body = {
        "reviewerId": expert["id"],
        "reason": "expert confirmation",
        "idempotencyKey": "golden-confirm-1",
    }
    confirmed = client.post(
        workspace_url(workspace_id, f"/feedback-candidates/{candidate['id']}/confirm"),
        json=body,
        headers=csrf_headers(client),
    )
    repeated = client.post(
        workspace_url(workspace_id, f"/feedback-candidates/{candidate['id']}/confirm"),
        json=body,
        headers=csrf_headers(client),
    )

    assert confirmed.status_code == 201
    assert repeated.status_code == 201
    assert repeated.json()["id"] == confirmed.json()["id"]
    assert confirmed.json()["candidateId"] == candidate["id"]
    assert confirmed.json()["expectedOutput"].startswith("The expert-ready rewrite")

    conflict = client.post(
        workspace_url(workspace_id, f"/feedback-candidates/{candidate['id']}/confirm"),
        json={**body, "idempotencyKey": "golden-confirm-2"},
        headers=csrf_headers(client),
    )
    assert conflict.status_code == 409

    detail = client.get(workspace_url(workspace_id, f"/human-tasks/{task['id']}")).json()
    event_types = [event["eventType"] for event in detail["auditEvents"]]
    assert "feedback_candidate_created" in event_types
    assert "golden_sample_confirmed" in event_types
