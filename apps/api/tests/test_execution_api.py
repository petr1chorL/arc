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
    def __init__(self, results: list[FakeModelResult | Exception]):
        self.results = results
        self.calls: list[dict] = []

    def complete(self, **request):
        self.calls.append(request)
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def create_published_agent(client: TestClient, name: str = "执行 Agent") -> tuple[dict, dict]:
    agent = client.post(
        "/api/agents",
        json={
            "name": name,
            "role": "根据输入生成结构化结论",
            "owner": "平台组",
            "model": "configured-model",
        },
    ).json()
    client.patch(
        f"/api/agents/{agent['id']}",
        json={
            "systemPrompt": "只输出有证据支持的结构化结论。",
            "tools": ["Web Search"],
            "skills": ["研究分析"],
        },
    )
    version = client.post(f"/api/agents/{agent['id']}/publish").json()
    return agent, version


def create_published_workflow(client: TestClient, agent: dict, version: dict) -> dict:
    workflow = client.post(
        "/api/workflows",
        json={
            "name": "真实执行流程",
            "nodes": [
                {"id": "start", "type": "trigger", "position": {"x": 0, "y": 0}, "data": {"label": "开始"}},
                {
                    "id": "agent",
                    "type": "agent",
                    "position": {"x": 200, "y": 0},
                    "data": {
                        "label": "执行 Agent",
                        "agentId": agent["id"],
                        "agentVersion": version["version"],
                    },
                },
                {"id": "end", "type": "end", "position": {"x": 400, "y": 0}, "data": {"label": "结束"}},
            ],
            "edges": [
                {"id": "start-agent", "source": "start", "target": "agent"},
                {"id": "agent-end", "source": "agent", "target": "end"},
            ],
        },
    ).json()
    client.post(f"/api/workflows/{workflow['id']}/publish")
    return workflow


def test_agent_test_run_records_model_usage_and_output(tmp_path):
    gateway = FakeGateway([FakeModelResult("这是一段足够长的结构化模型输出，用于证明执行已经成功完成。")])
    client = TestClient(create_app(f"sqlite:///{tmp_path / 'execution.db'}", gateway))
    agent, version = create_published_agent(client)

    response = client.post(
        f"/api/agents/{agent['id']}/test-runs",
        json={"input": "分析用户对新品的主要诉求", "version": version["version"]},
    )

    assert response.status_code == 201
    run = response.json()
    assert run["status"] == "已完成"
    assert run["output"].startswith("这是一段足够长")
    assert run["model"] == "fake-model"
    assert run["totalTokens"] == 20
    assert run["score"] == 100
    assert gateway.calls[0]["system_prompt"].startswith("只输出有证据")


def test_workflow_run_retries_and_persists_node_timeline(tmp_path):
    gateway = FakeGateway([
        RuntimeError("temporary provider failure"),
        FakeModelResult("重试后成功生成了足够长的工作流结果，节点应当记录两次尝试。"),
    ])
    database_url = f"sqlite:///{tmp_path / 'execution.db'}"
    client = TestClient(create_app(database_url, gateway))
    agent, version = create_published_agent(client)
    workflow = create_published_workflow(client, agent, version)

    response = client.post(
        f"/api/workflows/{workflow['id']}/runs",
        json={"input": "执行一条真实工作流"},
    )

    assert response.status_code == 201
    run = response.json()
    assert run["status"] == "已完成"
    assert run["output"].startswith("重试后成功")
    assert run["totalTokens"] == 20
    assert [node["status"] for node in run["nodes"]] == ["已完成", "已完成", "已完成"]
    assert run["nodes"][1]["attempts"] == 2

    restarted = TestClient(create_app(database_url, FakeGateway([])))
    persisted = restarted.get(f"/api/runs/{run['id']}").json()
    assert persisted["output"] == run["output"]
    assert len(persisted["nodes"]) == 3


def test_low_quality_output_creates_human_review(tmp_path):
    gateway = FakeGateway([FakeModelResult("太短")])
    client = TestClient(create_app(f"sqlite:///{tmp_path / 'execution.db'}", gateway))
    agent, version = create_published_agent(client)
    workflow = create_published_workflow(client, agent, version)

    run = client.post(
        f"/api/workflows/{workflow['id']}/runs",
        json={"input": "生成结果"},
    ).json()
    reviews = client.get("/api/reviews").json()

    assert run["status"] == "需介入"
    assert run["score"] == 50
    assert len(reviews) == 1
    assert reviews[0]["runId"] == run["id"]
    assert reviews[0]["status"] == "待处理"


def test_agent_test_run_exhausts_retries_without_exposing_provider_error(tmp_path):
    gateway = FakeGateway([
        RuntimeError("provider-secret-detail"),
        RuntimeError("provider-secret-detail"),
    ])
    client = TestClient(create_app(f"sqlite:///{tmp_path / 'execution.db'}", gateway))
    agent, version = create_published_agent(client)

    response = client.post(
        f"/api/agents/{agent['id']}/test-runs",
        json={"input": "执行一个必然失败的测试", "version": version["version"]},
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
    gateway = FakeGateway([FakeModelResult("太短")])
    client = TestClient(create_app(f"sqlite:///{tmp_path / 'execution.db'}", gateway))
    agent, version = create_published_agent(client)
    workflow = create_published_workflow(client, agent, version)
    run = client.post(
        f"/api/workflows/{workflow['id']}/runs",
        json={"input": "生成需要复核的结果"},
    ).json()
    review = client.get("/api/reviews").json()[0]

    response = client.post(
        f"/api/reviews/{review['id']}/decision",
        json={"decision": "approve"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "已完成"
    assert client.get(f"/api/runs/{run['id']}").json()["status"] == "已完成"
