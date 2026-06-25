import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from test_human_workflow_execution import (
    FakeGateway,
    FakeModelResult,
    create_human_workflow,
)


def create_task(
    tmp_path,
    *,
    policy: str = "any_one",
    required: int = 1,
) -> tuple[TestClient, dict, list[dict]]:
    gateway = FakeGateway([
        FakeModelResult("这是一段等待多人审核且长度足够的业务结论。"),
    ])
    client = TestClient(create_app(f"sqlite:///{tmp_path / f'{policy}-{required}.db'}", gateway))
    workflow = create_human_workflow(
        client,
        {
            "reviewPolicy": policy,
            "requiredApprovals": required,
        },
    )
    client.post(
        f"/api/workflows/{workflow['id']}/runs",
        json={"input": "生成等待审核的结论"},
    )
    task = client.get("/api/human-tasks").json()[0]
    reviewers = client.get("/api/reviewers").json()
    return client, task, reviewers


def decision_body(task: dict, reviewer_id: str, decision: str) -> dict:
    return {
        "reviewerId": reviewer_id,
        "decision": decision,
        "reason": f"{decision} 的审核原因",
        "artifactVersionId": task["artifactVersionId"],
        "idempotencyKey": f"{task['id']}-{reviewer_id}-{decision}",
    }


def test_directory_claim_conflict_and_transfer(tmp_path):
    client, task, reviewers = create_task(tmp_path)
    groups_response = client.get("/api/review-groups")

    assert len(reviewers) == 3
    assert groups_response.status_code == 200
    groups = groups_response.json()
    assert {group["name"] for group in groups} == {"产品审核组", "升级审核组"}

    first, second = reviewers[:2]
    claimed = client.post(
        f"/api/human-tasks/{task['id']}/claim",
        json={"reviewerId": first["id"]},
    )
    assert claimed.status_code == 200
    assert claimed.json()["assigneeReviewerId"] == first["id"]
    assert claimed.json()["status"] == "审核中"

    conflict = client.post(
        f"/api/human-tasks/{task['id']}/claim",
        json={"reviewerId": second["id"]},
    )
    assert conflict.status_code == 409

    transferred = client.post(
        f"/api/human-tasks/{task['id']}/transfer",
        json={
            "actorId": first["id"],
            "reviewerId": second["id"],
            "reason": "原审核人需要转交",
        },
    )
    assert transferred.status_code == 200
    assert transferred.json()["assigneeReviewerId"] == second["id"]


def test_round_robin_assigns_successive_reviewers(tmp_path):
    gateway = FakeGateway([
        FakeModelResult("第一份等待轮询审核且长度足够的业务结论。"),
        FakeModelResult("第二份等待轮询审核且长度足够的业务结论。"),
    ])
    client = TestClient(create_app(f"sqlite:///{tmp_path / 'round-robin.db'}", gateway))
    workflow = create_human_workflow(
        client,
        {"assignmentType": "round_robin"},
    )
    reviewers = client.get("/api/reviewers").json()

    client.post(f"/api/workflows/{workflow['id']}/runs", json={"input": "第一次运行"})
    first_task = client.get("/api/human-tasks").json()[0]
    client.post(f"/api/workflows/{workflow['id']}/runs", json={"input": "第二次运行"})
    second_task = client.get("/api/human-tasks").json()[0]

    assert first_task["assigneeReviewerId"] == reviewers[0]["id"]
    assert second_task["assigneeReviewerId"] == reviewers[1]["id"]
    assert first_task["status"] == "审核中"
    assert second_task["status"] == "审核中"


@pytest.mark.parametrize(
    ("policy", "required", "expected_after_first"),
    [
        ("any_one", 1, "已通过"),
        ("all", 2, "审核中"),
        ("threshold", 2, "审核中"),
    ],
)
def test_countersign_policies(
    tmp_path,
    policy: str,
    required: int,
    expected_after_first: str,
):
    client, task, reviewers = create_task(tmp_path, policy=policy, required=required)

    first = client.post(
        f"/api/human-tasks/{task['id']}/decisions",
        json=decision_body(task, reviewers[0]["id"], "approve"),
    )
    assert first.status_code == 200
    assert first.json()["status"] == expected_after_first

    if required == 2:
        second = client.post(
            f"/api/human-tasks/{task['id']}/decisions",
            json=decision_body(task, reviewers[1]["id"], "approve"),
        )
        assert second.status_code == 200
        assert second.json()["status"] == "已通过"
        assert second.json()["approvalProgress"] == {"required": 2, "received": 2}


@pytest.mark.parametrize(
    ("decision", "expected_status"),
    [
        ("reject", "已驳回"),
        ("return_for_rerun", "已退回"),
    ],
)
def test_reject_and_rerun_are_immediate(
    tmp_path,
    decision: str,
    expected_status: str,
):
    client, task, reviewers = create_task(tmp_path, policy="all", required=2)

    response = client.post(
        f"/api/human-tasks/{task['id']}/decisions",
        json=decision_body(task, reviewers[0]["id"], decision),
    )

    assert response.status_code == 200
    assert response.json()["status"] == expected_status
