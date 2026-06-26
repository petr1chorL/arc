from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select

from api_test_support import create_authenticated_client, csrf_headers, workspace_url
from app.models import ReviewerRecord, UserRecord, WorkspaceMembershipRecord
from app.security import SecurityService


@dataclass
class FakeModelResult:
    content: str
    model: str = "fake-model"
    prompt_tokens: int = 12
    completion_tokens: int = 8


class FakeGateway:
    def __init__(self, results: list[FakeModelResult | Exception]):
        self.results = results
        self.calls: list[dict] = []

    def complete(self, **request):
        self.calls.append(request)
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def bind_reviewer_to_user(
    client: TestClient,
    workspace_id: str,
    reviewer: dict,
    *,
    email: str = "workflow-reviewer@example.com",
) -> dict:
    security = SecurityService()
    now = datetime(2026, 6, 26, 9, 0, tzinfo=timezone.utc)
    with client.app.state.session_factory() as session:
        reviewer_record = session.get(ReviewerRecord, reviewer["id"])
        assert reviewer_record is not None
        admin = session.scalar(select(UserRecord).where(UserRecord.is_organization_admin.is_(True)))
        assert admin is not None
        user = UserRecord(
            organization_id=admin.organization_id,
            email=email,
            normalized_email=email,
            display_name=email,
            password_hash=security.hash_password("Reviewer Password 42!"),
            status="active",
            password_changed_at=now,
            created_at=now,
            updated_at=now,
        )
        session.add(user)
        session.flush()
        session.add(
            WorkspaceMembershipRecord(
                workspace_id=workspace_id,
                user_id=user.id,
                role="operator",
                status="active",
                invited_by=admin.id,
                activated_at=now,
                created_at=now,
                updated_at=now,
            ),
        )
        reviewer_record.user_id = user.id
        reviewer_record.is_active = True
        session.commit()
        return {**reviewer, "email": email, "userId": user.id}


def login_reviewer(client: TestClient, email: str) -> None:
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": "Reviewer Password 42!"},
    )
    assert response.status_code == 200


def create_human_workflow(
    client: TestClient,
    workspace_id: str,
    human_data: dict | None = None,
    *,
    post_human_agent: bool = False,
) -> dict:
    agent = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": "Review Source Agent",
            "role": "Generate a draft for human review.",
            "owner": "Platform Team",
            "model": "configured-model",
        },
        headers=csrf_headers(client),
    ).json()
    version = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/publish"),
        headers=csrf_headers(client),
    ).json()
    nodes = [
        {
            "id": "start",
            "type": "trigger",
            "position": {"x": 0, "y": 0},
            "data": {"label": "Start"},
        },
        {
            "id": "agent-1",
            "type": "agent",
            "position": {"x": 220, "y": 0},
            "data": {
                "label": "Review Source Agent",
                "agentId": agent["id"],
                "agentVersion": version["version"],
            },
        },
        {
            "id": "human-1",
            "type": "human",
            "position": {"x": 440, "y": 0},
            "data": {
                "label": "Human Review",
                "assignmentType": "group_claim",
                "reviewPolicy": "any_one",
                "requiredApprovals": 1,
                "reviewerIds": [],
                **(human_data or {}),
            },
        },
    ]
    edges = [
        {"id": "start-agent", "source": "start", "target": "agent-1"},
        {"id": "agent-human", "source": "agent-1", "target": "human-1"},
    ]
    if post_human_agent:
        nodes.append({
            "id": "agent-2",
            "type": "agent",
            "position": {"x": 660, "y": 0},
            "data": {
                "label": "Review Follow-up Agent",
                "agentId": agent["id"],
                "agentVersion": version["version"],
                "retryMaxAttempts": 2,
            },
        })
        edges.append({"id": "human-agent-2", "source": "human-1", "target": "agent-2"})
        end_x = 880
        end_source = "agent-2"
    else:
        end_x = 660
        end_source = "human-1"
    nodes.append({
        "id": "end",
        "type": "end",
        "position": {"x": end_x, "y": 0},
        "data": {"label": "End"},
    })
    edges.append({"id": "to-end", "source": end_source, "target": "end"})
    workflow = client.post(
        workspace_url(workspace_id, "/workflows"),
        json={
            "name": "Human Review Workflow",
            "nodes": nodes,
            "edges": edges,
        },
        headers=csrf_headers(client),
    ).json()
    published = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/publish"),
        headers=csrf_headers(client),
    )
    assert published.status_code == 201
    return workflow


def test_human_node_pauses_workflow_and_creates_task(tmp_path):
    gateway = FakeGateway([
        FakeModelResult("This draft is long enough to pause for human review and inspect later."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'human-workflow.db'}",
        model_gateway=gateway,
    )
    workflow = create_human_workflow(client, workspace_id)

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Need a reviewed answer."},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    run = response.json()
    assert [node["nodeType"] for node in run["nodes"]] == ["trigger", "agent", "human"]
    assert run["nodes"][-1]["status"] == run["status"]

    tasks_response = client.get(workspace_url(workspace_id, "/human-tasks"))
    assert tasks_response.status_code == 200
    tasks = tasks_response.json()
    assert len(tasks) == 1
    assert tasks[0]["workflowRunId"] == run["id"]
    assert tasks[0]["sourceNodeId"] == "agent-1"

    detail_response = client.get(
        workspace_url(workspace_id, f"/human-tasks/{tasks[0]['id']}"),
    )
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["artifact"]["content"].startswith("This draft is long enough")
    assert detail["run"]["status"] == run["status"]
    assert detail["run"]["currentNode"] == run["currentNode"]
    assert detail["approvalProgress"] == {"required": 1, "received": 0}


def paused_run(
    tmp_path,
    results: list[FakeModelResult],
) -> tuple[TestClient, str, FakeGateway, dict, dict, dict]:
    gateway = FakeGateway(results)
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'review-outcome.db'}",
        model_gateway=gateway,
    )
    workflow = create_human_workflow(client, workspace_id)
    run = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Prepare a reviewed response."},
        headers=csrf_headers(client),
    ).json()
    task = client.get(workspace_url(workspace_id, "/human-tasks")).json()[0]
    reviewer = client.get(workspace_url(workspace_id, "/reviewers")).json()[0]
    reviewer = bind_reviewer_to_user(client, workspace_id, reviewer)
    login_reviewer(client, reviewer["email"])
    return client, workspace_id, gateway, run, task, reviewer


def submit_decision(
    client: TestClient,
    workspace_id: str,
    task: dict,
    reviewer: dict,
    decision: str,
    *,
    modified_content: str | None = None,
    idempotency_key: str | None = None,
):
    body = {
        "decision": decision,
        "reason": f"{decision} in test",
        "artifactVersionId": task["artifactVersionId"],
        "idempotencyKey": idempotency_key or f"{task['id']}-{decision}",
    }
    if modified_content is not None:
        body["modifiedContent"] = modified_content
        body["tags"] = ["edited", "review"]
    return client.post(
        workspace_url(workspace_id, f"/human-tasks/{task['id']}/decisions"),
        json=body,
        headers=csrf_headers(client),
    )


def test_approve_resumes_downstream_once(tmp_path):
    client, workspace_id, _, run, task, reviewer = paused_run(
        tmp_path,
        [FakeModelResult("The reviewed workflow can now complete successfully.")],
    )

    first = submit_decision(client, workspace_id, task, reviewer, "approve", idempotency_key="approve-once")
    repeated = submit_decision(client, workspace_id, task, reviewer, "approve", idempotency_key="approve-once")

    assert first.status_code == 200
    assert repeated.status_code == 200
    persisted = client.get(workspace_url(workspace_id, f"/runs/{run['id']}")).json()
    assert persisted["status"] == "已完成"
    assert [node["nodeType"] for node in persisted["nodes"]].count("end") == 1


def test_modify_and_approve_uses_new_artifact_version(tmp_path):
    client, workspace_id, _, run, task, reviewer = paused_run(
        tmp_path,
        [FakeModelResult("The original draft is long enough to be edited and approved.")],
    )
    modified = "The human reviewer updated the draft before approving the output."

    response = submit_decision(
        client,
        workspace_id,
        task,
        reviewer,
        "modify_and_approve",
        modified_content=modified,
    )

    assert response.status_code == 200
    detail = response.json()
    assert detail["status"] == "修改后通过"
    assert detail["artifact"]["content"] == modified
    assert detail["artifact"]["version"] == 2
    persisted = client.get(workspace_url(workspace_id, f"/runs/{run['id']}")).json()
    assert persisted["status"] == "已完成"
    assert persisted["output"] == modified


def test_return_for_rerun_executes_source_agent_and_pauses_again(tmp_path):
    client, workspace_id, gateway, run, task, reviewer = paused_run(
        tmp_path,
        [
            FakeModelResult("The first reviewed draft should be returned for a rerun."),
            FakeModelResult("The rerun draft should pause again for another review step."),
        ],
    )

    response = submit_decision(client, workspace_id, task, reviewer, "return_for_rerun")

    assert response.status_code == 200
    persisted = client.get(workspace_url(workspace_id, f"/runs/{run['id']}")).json()
    assert persisted["status"] == run["status"]
    assert [node["nodeType"] for node in persisted["nodes"]].count("agent") == 2
    assert len(gateway.calls) == 2
    tasks = client.get(workspace_url(workspace_id, "/human-tasks")).json()
    assert len(tasks) == 2
    assert any(item["id"] != task["id"] for item in tasks)


def test_reject_terminates_without_running_downstream(tmp_path):
    client, workspace_id, _, run, task, reviewer = paused_run(
        tmp_path,
        [FakeModelResult("The generated draft will be rejected by the reviewer.")],
    )

    response = submit_decision(client, workspace_id, task, reviewer, "reject")

    assert response.status_code == 200
    persisted = client.get(workspace_url(workspace_id, f"/runs/{run['id']}")).json()
    assert persisted["status"] == "已驳回"
    assert all(node["nodeType"] != "end" for node in persisted["nodes"])


def test_failed_resume_can_retry_without_new_decision(tmp_path):
    gateway = FakeGateway([
        FakeModelResult("The first draft pauses for review before a downstream failure."),
        RuntimeError("temporary downstream failure"),
        RuntimeError("temporary downstream failure"),
        FakeModelResult("The retry path succeeds and the workflow finishes cleanly."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'resume-retry.db'}",
        model_gateway=gateway,
    )
    workflow = create_human_workflow(client, workspace_id, post_human_agent=True)
    run = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Exercise retry resume behavior."},
        headers=csrf_headers(client),
    ).json()
    task = client.get(workspace_url(workspace_id, "/human-tasks")).json()[0]
    reviewer = client.get(workspace_url(workspace_id, "/reviewers")).json()[0]
    reviewer = bind_reviewer_to_user(
        client,
        workspace_id,
        reviewer,
        email="resume-reviewer@example.com",
    )
    login_reviewer(client, reviewer["email"])

    failed = submit_decision(client, workspace_id, task, reviewer, "approve")

    assert failed.status_code == 200
    assert failed.json()["status"] == "恢复失败"
    assert client.get(workspace_url(workspace_id, f"/runs/{run['id']}")).json()["status"] == "恢复失败"

    retried = client.post(
        workspace_url(workspace_id, f"/human-tasks/{task['id']}/retry-resume"),
        headers=csrf_headers(client),
    )

    assert retried.status_code == 200
    assert retried.json()["status"] == "已通过"
    persisted = client.get(workspace_url(workspace_id, f"/runs/{run['id']}")).json()
    assert persisted["status"] == "已完成"
    assert persisted["output"].startswith("The retry path succeeds")
