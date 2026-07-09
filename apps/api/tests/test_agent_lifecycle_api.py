from fastapi.testclient import TestClient

from api_test_support import create_authenticated_client, csrf_headers, workspace_url
from app.models import ToolSkillAssetRecord


def create_agent(client: TestClient, workspace_id: str) -> dict:
    response = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": "鐮旂┒ Agent",
            "role": "瀹屾垚缁撴瀯鍖栫爺绌?",
            "owner": "浜у搧缁?",
            "model": "GPT-5",
        },
        headers=csrf_headers(client),
    )
    assert response.status_code == 201
    return response.json()


def test_agent_draft_can_be_edited_and_published_as_immutable_versions(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'agents.db'}")
    agent = create_agent(client, workspace_id)
    create_tool_skill_asset(client, workspace_id, asset_type="tool", name="Web Search")
    create_tool_skill_asset(client, workspace_id, asset_type="skill", name="绔炲搧鍒嗘瀽")

    update_response = client.patch(
        workspace_url(workspace_id, f"/agents/{agent['id']}"),
        json={
            "name": "楂樼骇鐮旂┒ Agent",
            "role": "瀹屾垚缁撴瀯鍖栫爺绌朵笌璇佹嵁鏍搁獙",
            "owner": "浜у搧缁?",
            "model": "GPT-5",
            "systemPrompt": "鍙緭鍑烘湁璇佹嵁鏀寔鐨勭粨璁恒€?",
            "tools": ["Web Search"],
            "skills": ["绔炲搧鍒嗘瀽"],
        },
        headers=csrf_headers(client),
    )
    assert update_response.status_code == 200
    assert update_response.json()["systemPrompt"] == "鍙緭鍑烘湁璇佹嵁鏀寔鐨勭粨璁恒€?"

    first_version = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/publish"),
        json={"note": "首版发布，绑定检索工具和竞品分析 Skill"},
        headers=csrf_headers(client),
    )
    assert first_version.status_code == 201
    assert first_version.json()["version"] == "v1.0.0"
    assert first_version.json()["note"] == "首版发布，绑定检索工具和竞品分析 Skill"
    assert first_version.json()["snapshot"]["name"] == "楂樼骇鐮旂┒ Agent"
    openapi = client.get("/openapi.json").json()
    publish_operation = openapi["paths"]["/api/workspaces/{workspace_id}/agents/{agent_id}/publish"]["post"]
    assert "requestBody" in publish_operation

    client.patch(
        workspace_url(workspace_id, f"/agents/{agent['id']}"),
        json={**update_response.json(), "name": "鐮旂┒ Agent 鑽夌浜?"},
        headers=csrf_headers(client),
    )
    second_version = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/publish"),
        headers=csrf_headers(client),
    )
    versions = client.get(
        workspace_url(workspace_id, f"/agents/{agent['id']}/versions"),
    ).json()

    assert second_version.status_code == 201
    assert second_version.json()["version"] == "v1.1.0"
    assert versions[1]["snapshot"]["name"] == "楂樼骇鐮旂┒ Agent"
    assert versions[1]["note"] == "首版发布，绑定检索工具和竞品分析 Skill"
    assert versions[0]["snapshot"]["name"] == "鐮旂┒ Agent 鑽夌浜?"


def test_deactivated_agent_cannot_be_edited_or_published(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'agents.db'}")
    agent = create_agent(client, workspace_id)

    response = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/deactivate"),
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    assert response.json()["status"] == "宸插仠鐢?"
    assert client.patch(
        workspace_url(workspace_id, f"/agents/{agent['id']}"),
        json={"name": "涓嶈兘淇敼"},
        headers=csrf_headers(client),
    ).status_code == 409
    assert client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/publish"),
        headers=csrf_headers(client),
    ).status_code == 409


def test_deactivated_agent_can_be_activated_again(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'agent-reactivate.db'}")
    agent = create_agent(client, workspace_id)

    draft_deactivate = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/deactivate"),
        headers=csrf_headers(client),
    )
    draft_activate = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/activate"),
        headers=csrf_headers(client),
    )
    publish = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/publish"),
        headers=csrf_headers(client),
    )
    published_deactivate = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/deactivate"),
        headers=csrf_headers(client),
    )
    published_activate = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/activate"),
        headers=csrf_headers(client),
    )

    assert draft_deactivate.status_code == 200
    assert draft_activate.status_code == 200
    assert draft_activate.json()["status"] == "调试中"
    assert publish.status_code == 201
    assert published_deactivate.status_code == 200
    assert published_activate.status_code == 200
    assert published_activate.json()["status"] == "在线"


def create_tool_skill_asset(
    client: TestClient,
    workspace_id: str,
    *,
    asset_type: str,
    name: str,
) -> dict:
    response = client.post(
        workspace_url(workspace_id, "/asset-library"),
        json={
            "assetType": asset_type,
            "name": name,
            "description": f"{asset_type} asset",
            "parameterSchema": {"type": "object"},
        },
        headers=csrf_headers(client),
    )
    assert response.status_code == 201
    return response.json()


def test_agent_can_only_bind_existing_active_tool_and_skill_assets(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'agent-assets.db'}")
    agent = create_agent(client, workspace_id)
    create_tool_skill_asset(client, workspace_id, asset_type="tool", name="飞书搜索")
    create_tool_skill_asset(client, workspace_id, asset_type="skill", name="竞品分析")

    valid = client.patch(
        workspace_url(workspace_id, f"/agents/{agent['id']}"),
        json={
            "tools": ["飞书搜索"],
            "skills": ["竞品分析"],
        },
        headers=csrf_headers(client),
    )
    invalid_tool = client.patch(
        workspace_url(workspace_id, f"/agents/{agent['id']}"),
        json={
            "tools": ["不存在的工具"],
        },
        headers=csrf_headers(client),
    )
    invalid_skill = client.patch(
        workspace_url(workspace_id, f"/agents/{agent['id']}"),
        json={
            "skills": ["不存在的技能"],
        },
        headers=csrf_headers(client),
    )

    assert valid.status_code == 200
    assert valid.json()["tools"] == ["飞书搜索"]
    assert valid.json()["skills"] == ["竞品分析"]
    assert invalid_tool.status_code == 422
    assert invalid_tool.json()["detail"] == "未授权或不可用的 Tool：不存在的工具"
    assert invalid_skill.status_code == 422
    assert invalid_skill.json()["detail"] == "未授权或不可用的 Skill：不存在的技能"


def test_agent_publish_revalidates_bound_tool_and_skill_assets(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'agent-assets-publish.db'}",
    )
    agent = create_agent(client, workspace_id)
    tool = create_tool_skill_asset(client, workspace_id, asset_type="tool", name="飞书搜索")
    create_tool_skill_asset(client, workspace_id, asset_type="skill", name="竞品分析")
    update = client.patch(
        workspace_url(workspace_id, f"/agents/{agent['id']}"),
        json={
            "tools": ["飞书搜索"],
            "skills": ["竞品分析"],
        },
        headers=csrf_headers(client),
    )
    assert update.status_code == 200

    with client.app.state.session_factory() as session:
        tool_record = session.get(ToolSkillAssetRecord, tool["id"])
        assert tool_record is not None
        tool_record.status = "disabled"
        session.commit()

    publish = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/publish"),
        headers=csrf_headers(client),
    )

    assert publish.status_code == 422
    assert publish.json()["detail"] == "未授权或不可用的 Tool：飞书搜索"
