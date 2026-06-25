from fastapi.testclient import TestClient

from app.main import create_app


def published_agent(client: TestClient) -> tuple[str, str]:
    agent = client.post(
        "/api/agents",
        json={
            "name": "工作流 Agent",
            "role": "处理工作流节点",
            "owner": "平台组",
            "model": "GPT-5",
        },
    ).json()
    version = client.post(f"/api/agents/{agent['id']}/publish").json()
    return agent["id"], version["version"]


def valid_graph(agent_id: str, agent_version: str) -> dict:
    return {
        "nodes": [
            {"id": "start", "type": "trigger", "position": {"x": 0, "y": 0}, "data": {"label": "开始"}},
            {
                "id": "agent",
                "type": "agent",
                "position": {"x": 220, "y": 0},
                "data": {
                    "label": "执行 Agent",
                    "agentId": agent_id,
                    "agentVersion": agent_version,
                },
            },
            {"id": "end", "type": "end", "position": {"x": 440, "y": 0}, "data": {"label": "结束"}},
        ],
        "edges": [
            {"id": "start-agent", "source": "start", "target": "agent"},
            {"id": "agent-end", "source": "agent", "target": "end"},
        ],
    }


def test_workflow_draft_publishes_an_immutable_snapshot(tmp_path):
    client = TestClient(create_app(f"sqlite:///{tmp_path / 'workflows.db'}"))
    agent_id, agent_version = published_agent(client)
    graph = valid_graph(agent_id, agent_version)
    workflow = client.post(
        "/api/workflows",
        json={"name": "新品研究流程", **graph},
    ).json()

    validation = client.post(f"/api/workflows/{workflow['id']}/validate")
    published = client.post(f"/api/workflows/{workflow['id']}/publish")

    assert validation.status_code == 200
    assert validation.json() == {"valid": True, "errors": []}
    assert published.status_code == 201
    assert published.json()["version"] == "v1.0.0"

    changed_graph = valid_graph(agent_id, agent_version)
    changed_graph["nodes"][1]["data"]["label"] = "修改后的草稿"
    client.patch(
        f"/api/workflows/{workflow['id']}",
        json={"name": "新品研究流程", **changed_graph},
    )
    versions = client.get(f"/api/workflows/{workflow['id']}/versions").json()

    assert versions[0]["snapshot"]["nodes"][1]["data"]["label"] == "执行 Agent"


def test_workflow_publish_rejects_cycles_and_unpublished_agent_references(tmp_path):
    client = TestClient(create_app(f"sqlite:///{tmp_path / 'workflows.db'}"))
    graph = {
        "nodes": [
            {"id": "start", "type": "trigger", "position": {"x": 0, "y": 0}, "data": {"label": "开始"}},
            {
                "id": "agent",
                "type": "agent",
                "position": {"x": 220, "y": 0},
                "data": {
                    "label": "未发布 Agent",
                    "agentId": "missing",
                    "agentVersion": "v1.0.0",
                },
            },
            {"id": "end", "type": "end", "position": {"x": 440, "y": 0}, "data": {"label": "结束"}},
        ],
        "edges": [
            {"id": "one", "source": "start", "target": "agent"},
            {"id": "two", "source": "agent", "target": "end"},
            {"id": "cycle", "source": "end", "target": "start"},
        ],
    }
    workflow = client.post(
        "/api/workflows",
        json={"name": "非法流程", **graph},
    ).json()

    validation = client.post(f"/api/workflows/{workflow['id']}/validate")
    published = client.post(f"/api/workflows/{workflow['id']}/publish")

    assert validation.status_code == 200
    assert validation.json()["valid"] is False
    assert any("有向环" in error for error in validation.json()["errors"])
    assert any("Agent 版本" in error for error in validation.json()["errors"])
    assert published.status_code == 422


def test_workflow_publish_rejects_invalid_human_node_configuration(tmp_path):
    client = TestClient(create_app(f"sqlite:///{tmp_path / 'human-validation.db'}"))
    graph = {
        "nodes": [
            {
                "id": "start",
                "type": "trigger",
                "position": {"x": 0, "y": 0},
                "data": {"label": "开始"},
            },
            {
                "id": "human",
                "type": "human",
                "position": {"x": 220, "y": 0},
                "data": {
                    "label": "人工审核",
                    "assignmentType": "direct",
                    "reviewerIds": [],
                    "reviewPolicy": "threshold",
                    "requiredApprovals": 2,
                    "dueMinutes": 0,
                    "escalationMinutes": 0,
                },
            },
            {
                "id": "end",
                "type": "end",
                "position": {"x": 440, "y": 0},
                "data": {"label": "结束"},
            },
        ],
        "edges": [
            {"id": "start-human", "source": "start", "target": "human"},
            {"id": "human-end", "source": "human", "target": "end"},
        ],
    }
    workflow = client.post(
        "/api/workflows",
        json={"name": "无效人工审核流程", **graph},
    ).json()

    validation = client.post(f"/api/workflows/{workflow['id']}/validate")
    published = client.post(f"/api/workflows/{workflow['id']}/publish")

    assert validation.status_code == 200
    assert validation.json()["valid"] is False
    errors = validation.json()["errors"]
    assert any("直接分配必须选择审核人" in error for error in errors)
    assert any("通过人数不能超过参与审核人数" in error for error in errors)
    assert any("截止时间必须大于 0" in error for error in errors)
    assert any("升级时间必须晚于截止时间" in error for error in errors)
    assert published.status_code == 422
