from dataclasses import dataclass

from fastapi.testclient import TestClient
from sqlalchemy import select

from api_test_support import create_authenticated_client, csrf_headers, workspace_url
from app.models import AuditEventRecord


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


def create_published_agent(
    client: TestClient,
    workspace_id: str,
    name: str = "Insight Agent",
) -> tuple[dict, dict]:
    agent = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": name,
            "role": "Analyze the request and produce a concise answer.",
            "owner": "Platform Team",
            "model": "configured-model",
        },
        headers=csrf_headers(client),
    ).json()
    for asset_type, asset_name in (("tool", "Web Search"), ("skill", "Reasoning")):
        asset_response = client.post(
            workspace_url(workspace_id, "/asset-library"),
            json={
                "assetType": asset_type,
                "name": asset_name,
                "description": f"{asset_type} asset",
                "parameterSchema": {"type": "object"},
            },
            headers=csrf_headers(client),
        )
        assert asset_response.status_code == 201
    client.patch(
        workspace_url(workspace_id, f"/agents/{agent['id']}"),
        json={
            "systemPrompt": "Respond clearly and keep the answer actionable.",
            "tools": ["Web Search"],
            "skills": ["Reasoning"],
        },
        headers=csrf_headers(client),
    )
    version = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/publish"),
        headers=csrf_headers(client),
    ).json()
    return agent, version


def create_published_workflow(
    client: TestClient,
    workspace_id: str,
    agent: dict,
    version: dict,
) -> dict:
    workflow = client.post(
        workspace_url(workspace_id, "/workflows"),
        json={
            "name": "Execution Workflow",
            "nodes": [
                {"id": "start", "type": "trigger", "position": {"x": 0, "y": 0}, "data": {"label": "Start"}},
                {
                    "id": "agent",
                    "type": "agent",
                    "position": {"x": 200, "y": 0},
                    "data": {
                        "label": "Insight Agent",
                        "agentId": agent["id"],
                        "agentVersion": version["version"],
                    },
                },
                {"id": "end", "type": "end", "position": {"x": 400, "y": 0}, "data": {"label": "End"}},
            ],
            "edges": [
                {"id": "start-agent", "source": "start", "target": "agent"},
                {"id": "agent-end", "source": "agent", "target": "end"},
            ],
        },
        headers=csrf_headers(client),
    ).json()
    publish_response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/publish"),
        headers=csrf_headers(client),
    )
    assert publish_response.status_code == 201
    return workflow


def test_agent_test_run_records_model_usage_and_output(tmp_path):
    gateway = FakeGateway([FakeModelResult("This is a sufficiently long generated answer for the test run.")])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)

    response = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/test-runs"),
        json={"input": "Summarize the customer issue.", "version": version["version"]},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    run = response.json()
    assert run["status"] == "已完成"
    assert run["output"].startswith("This is a sufficiently long")
    assert run["model"] == "fake-model"
    assert run["totalTokens"] == 20
    assert run["score"] == 100
    assert gateway.calls[0]["system_prompt"].startswith("Respond clearly")


def test_workflow_run_retries_and_persists_node_timeline(tmp_path):
    gateway = FakeGateway([
        RuntimeError("temporary provider failure"),
        FakeModelResult("The workflow recovered on retry and completed successfully."),
    ])
    database_url = f"sqlite:///{tmp_path / 'execution.db'}"
    client, workspace_id = create_authenticated_client(database_url, model_gateway=gateway)
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Generate a polished final answer."},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    run = response.json()
    assert run["status"] == "已完成"
    assert run["output"].startswith("The workflow recovered on retry")
    assert run["totalTokens"] == 20
    assert [node["status"] for node in run["nodes"]] == ["已完成", "已完成", "已完成"]
    assert run["nodes"][1]["attempts"] == 2

    restarted, restarted_workspace_id = create_authenticated_client(
        database_url,
        model_gateway=FakeGateway([]),
    )
    persisted = restarted.get(
        workspace_url(restarted_workspace_id, f"/runs/{run['id']}"),
    ).json()
    assert persisted["output"] == run["output"]
    assert len(persisted["nodes"]) == 3


def test_low_quality_output_creates_human_review(tmp_path):
    gateway = FakeGateway([FakeModelResult("short")])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)

    run = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Generate result"},
        headers=csrf_headers(client),
    ).json()
    reviews = client.get(workspace_url(workspace_id, "/reviews")).json()

    assert run["status"] == "需介入"
    assert run["score"] == 50
    assert len(reviews) == 1
    assert reviews[0]["runId"] == run["id"]
    assert reviews[0]["status"]


def test_agent_test_run_exhausts_retries_without_exposing_provider_error(tmp_path):
    gateway = FakeGateway([
        RuntimeError("provider-secret-detail"),
        RuntimeError("provider-secret-detail"),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)

    response = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/test-runs"),
        json={"input": "Retry until the provider fails twice.", "version": version["version"]},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    run = response.json()
    assert run["status"] == "失败"
    assert run["error"] == "Agent 执行失败，请稍后重试"
    assert run["nodes"][0]["status"] == "失败"
    assert run["nodes"][0]["attempts"] == 2
    assert run["nodes"][0]["error"] == "Agent 执行失败，请稍后重试"
    assert "provider-secret-detail" not in response.text


def test_human_review_decision_updates_review_and_run_status(tmp_path):
    gateway = FakeGateway([FakeModelResult("short")])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)
    run = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Produce a short answer that requires review."},
        headers=csrf_headers(client),
    ).json()
    review = client.get(workspace_url(workspace_id, "/reviews")).json()[0]

    response = client.post(
        workspace_url(workspace_id, f"/reviews/{review['id']}/decision"),
        json={"decision": "approve"},
        headers={**csrf_headers(client), "X-Request-ID": "req-review-approve"},
    )

    assert response.status_code == 200
    persisted = client.get(workspace_url(workspace_id, f"/runs/{run['id']}")).json()
    assert response.json()["status"] == persisted["status"]
    with client.app.state.session_factory() as session:
        event = session.scalars(
            select(AuditEventRecord)
            .where(
                AuditEventRecord.action == "review.decision",
                AuditEventRecord.target_id == review["id"],
                AuditEventRecord.outcome == "success",
            )
            .order_by(AuditEventRecord.created_at.desc()),
        ).first()
        assert event is not None
        assert event.workspace_id == workspace_id
        assert event.request_id == "req-review-approve"


def test_human_review_decision_reject_is_allowed_and_writes_success_audit(tmp_path):
    gateway = FakeGateway([FakeModelResult("short")])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution-reject.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)
    client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Produce a short answer that requires review."},
        headers=csrf_headers(client),
    )
    review = client.get(workspace_url(workspace_id, "/reviews")).json()[0]

    response = client.post(
        workspace_url(workspace_id, f"/reviews/{review['id']}/decision"),
        json={"decision": "reject"},
        headers={**csrf_headers(client), "X-Request-ID": "req-review-reject"},
    )

    assert response.status_code == 200
    with client.app.state.session_factory() as session:
        event = session.scalars(
            select(AuditEventRecord)
            .where(
                AuditEventRecord.action == "review.decision",
                AuditEventRecord.target_id == review["id"],
                AuditEventRecord.outcome == "success",
            )
            .order_by(AuditEventRecord.created_at.desc()),
        ).first()
        assert event is not None
        assert event.workspace_id == workspace_id
        assert event.request_id == "req-review-reject"


def test_human_review_decision_rejects_invalid_payload_without_changing_state(tmp_path):
    gateway = FakeGateway([FakeModelResult("short")])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution-invalid-review.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)
    run = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Produce a short answer that requires review."},
        headers=csrf_headers(client),
    ).json()
    review = client.get(workspace_url(workspace_id, "/reviews")).json()[0]
    before_review_status = review["status"]
    before_run_status = client.get(workspace_url(workspace_id, f"/runs/{run['id']}")).json()["status"]

    response = client.post(
        workspace_url(workspace_id, f"/reviews/{review['id']}/decision"),
        json={"decision": "maybe"},
        headers=csrf_headers(client),
    )

    assert response.status_code == 422
    after_review_status = client.get(workspace_url(workspace_id, "/reviews")).json()[0]["status"]
    after_run_status = client.get(workspace_url(workspace_id, f"/runs/{run['id']}")).json()["status"]
    assert after_review_status == before_review_status
    assert after_run_status == before_run_status
