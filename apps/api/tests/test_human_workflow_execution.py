from dataclasses import dataclass

from fastapi.testclient import TestClient

from app.main import create_app


@dataclass
class FakeModelResult:
    content: str
    model: str = "fake-model"
    prompt_tokens: int = 12
    completion_tokens: int = 8


class FakeGateway:
    def __init__(self, results: list[FakeModelResult]):
        self.results = results
        self.calls: list[dict] = []

    def complete(self, **request):
        self.calls.append(request)
        return self.results.pop(0)


def create_human_workflow(
    client: TestClient,
    human_data: dict | None = None,
) -> dict:
    agent = client.post(
        "/api/agents",
        json={
            "name": "审核前 Agent",
            "role": "生成需要人工确认的业务结论",
            "owner": "平台组",
            "model": "configured-model",
        },
    ).json()
    version = client.post(f"/api/agents/{agent['id']}/publish").json()
    workflow = client.post(
        "/api/workflows",
        json={
            "name": "人工协作流程",
            "nodes": [
                {
                    "id": "start",
                    "type": "trigger",
                    "position": {"x": 0, "y": 0},
                    "data": {"label": "开始"},
                },
                {
                    "id": "agent-1",
                    "type": "agent",
                    "position": {"x": 220, "y": 0},
                    "data": {
                        "label": "审核前 Agent",
                        "agentId": agent["id"],
                        "agentVersion": version["version"],
                    },
                },
                {
                    "id": "human-1",
                    "type": "human",
                    "position": {"x": 440, "y": 0},
                    "data": {
                        "label": "人工审核",
                        "assignmentType": "group_claim",
                        "reviewPolicy": "any_one",
                        "requiredApprovals": 1,
                        "reviewerIds": [],
                        **(human_data or {}),
                    },
                },
                {
                    "id": "end",
                    "type": "end",
                    "position": {"x": 660, "y": 0},
                    "data": {"label": "结束"},
                },
            ],
            "edges": [
                {"id": "start-agent", "source": "start", "target": "agent-1"},
                {"id": "agent-human", "source": "agent-1", "target": "human-1"},
                {"id": "human-end", "source": "human-1", "target": "end"},
            ],
        },
    ).json()
    published = client.post(f"/api/workflows/{workflow['id']}/publish")
    assert published.status_code == 201
    return workflow


def test_human_node_pauses_workflow_and_creates_task(tmp_path):
    gateway = FakeGateway([
        FakeModelResult("这是一段需要人工确认且长度足够的业务结论。"),
    ])
    client = TestClient(create_app(f"sqlite:///{tmp_path / 'human-workflow.db'}", gateway))
    workflow = create_human_workflow(client)

    response = client.post(
        f"/api/workflows/{workflow['id']}/runs",
        json={"input": "生成一份等待人工审核的结论"},
    )

    assert response.status_code == 201
    run = response.json()
    assert run["status"] == "等待审核"
    assert [node["nodeType"] for node in run["nodes"]] == ["trigger", "agent", "human"]
    assert run["nodes"][-1]["status"] == "等待审核"

    tasks_response = client.get("/api/human-tasks")
    assert tasks_response.status_code == 200
    tasks = tasks_response.json()
    assert len(tasks) == 1
    assert tasks[0]["workflowRunId"] == run["id"]
    assert tasks[0]["sourceNodeId"] == "agent-1"

    detail_response = client.get(f"/api/human-tasks/{tasks[0]['id']}")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["artifact"]["content"].startswith("这是一段需要人工确认")
    assert detail["run"]["status"] == "等待审核"
    assert detail["run"]["currentNode"] == "人工审核"
    assert detail["approvalProgress"] == {"required": 1, "received": 0}
