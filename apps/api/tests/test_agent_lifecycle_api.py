from fastapi.testclient import TestClient

from app.main import create_app


def create_agent(client: TestClient) -> dict:
    response = client.post(
        "/api/agents",
        json={
            "name": "研究 Agent",
            "role": "完成结构化研究",
            "owner": "产品组",
            "model": "GPT-5",
        },
    )
    assert response.status_code == 201
    return response.json()


def test_agent_draft_can_be_edited_and_published_as_immutable_versions(tmp_path):
    client = TestClient(create_app(f"sqlite:///{tmp_path / 'agents.db'}"))
    agent = create_agent(client)

    update_response = client.patch(
        f"/api/agents/{agent['id']}",
        json={
            "name": "高级研究 Agent",
            "role": "完成结构化研究与证据核验",
            "owner": "产品组",
            "model": "GPT-5",
            "systemPrompt": "只输出有证据支持的结论。",
            "tools": ["Web Search"],
            "skills": ["竞品分析"],
        },
    )
    assert update_response.status_code == 200
    assert update_response.json()["systemPrompt"] == "只输出有证据支持的结论。"

    first_version = client.post(f"/api/agents/{agent['id']}/publish")
    assert first_version.status_code == 201
    assert first_version.json()["version"] == "v1.0.0"
    assert first_version.json()["snapshot"]["name"] == "高级研究 Agent"

    client.patch(
        f"/api/agents/{agent['id']}",
        json={**update_response.json(), "name": "研究 Agent 草稿二"},
    )
    second_version = client.post(f"/api/agents/{agent['id']}/publish")
    versions = client.get(f"/api/agents/{agent['id']}/versions").json()

    assert second_version.status_code == 201
    assert second_version.json()["version"] == "v1.1.0"
    assert versions[1]["snapshot"]["name"] == "高级研究 Agent"
    assert versions[0]["snapshot"]["name"] == "研究 Agent 草稿二"


def test_deactivated_agent_cannot_be_edited_or_published(tmp_path):
    client = TestClient(create_app(f"sqlite:///{tmp_path / 'agents.db'}"))
    agent = create_agent(client)

    response = client.post(f"/api/agents/{agent['id']}/deactivate")

    assert response.status_code == 200
    assert response.json()["status"] == "已停用"
    assert client.patch(
        f"/api/agents/{agent['id']}",
        json={"name": "不能修改"},
    ).status_code == 409
    assert client.post(f"/api/agents/{agent['id']}/publish").status_code == 409
