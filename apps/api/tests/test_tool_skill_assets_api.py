from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select

from api_test_support import (
    csrf_headers,
    create_authenticated_client,
    login_client,
    workspace_url,
)
from app.models import UserRecord, WorkspaceMembershipRecord, WorkspaceRecord
from app.security import SecurityService


def create_asset(client: TestClient, workspace_id: str, name: str = "飞书搜索") -> dict:
    response = client.post(
        workspace_url(workspace_id, "/asset-library"),
        json={
            "assetType": "tool",
            "name": name,
            "description": "Search Feishu documents",
            "parameterSchema": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
        headers=csrf_headers(client),
    )
    assert response.status_code == 201
    return response.json()


def test_create_and_list_tool_skill_assets(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'tool-skill-assets.db'}",
    )

    asset = create_asset(client, workspace_id)
    list_response = client.get(workspace_url(workspace_id, "/asset-library"))

    assert asset["assetType"] == "tool"
    assert asset["name"] == "飞书搜索"
    assert asset["status"] == "active"
    assert asset["parameterSchema"]["required"] == ["query"]
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [asset["id"]]


def test_tool_skill_asset_names_are_unique_per_workspace_and_type(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'tool-skill-assets-unique.db'}",
    )
    create_asset(client, workspace_id)

    duplicate = client.post(
        workspace_url(workspace_id, "/asset-library"),
        json={
            "assetType": "tool",
            "name": "飞书搜索",
            "description": "Duplicate",
            "parameterSchema": {"type": "object"},
        },
        headers=csrf_headers(client),
    )
    skill_same_name = client.post(
        workspace_url(workspace_id, "/asset-library"),
        json={
            "assetType": "skill",
            "name": "飞书搜索",
            "description": "Allowed because type differs",
            "parameterSchema": {"type": "object"},
        },
        headers=csrf_headers(client),
    )

    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "资产名称已存在"
    assert skill_same_name.status_code == 201
    assert skill_same_name.json()["assetType"] == "skill"


def test_tool_skill_assets_are_workspace_scoped(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'tool-skill-assets-scope.db'}",
    )
    with client.app.state.session_factory() as session:
        workspace = session.get(WorkspaceRecord, workspace_id)
        assert workspace is not None
        other = WorkspaceRecord(
            organization_id=workspace.organization_id,
            name="Other Workspace",
            slug="other-workspace",
            status="active",
        )
        session.add(other)
        session.commit()
        other_workspace_id = other.id

    create_asset(client, workspace_id)

    assert client.get(workspace_url(other_workspace_id, "/asset-library")).json() == []


def test_viewer_cannot_create_tool_skill_asset(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'tool-skill-assets-viewer.db'}",
    )
    security = SecurityService()
    now = datetime(2026, 6, 26, 9, 0, tzinfo=timezone.utc)
    with client.app.state.session_factory() as session:
        workspace = session.get(WorkspaceRecord, workspace_id)
        assert workspace is not None
        viewer = UserRecord(
            organization_id=workspace.organization_id,
            email="viewer@example.com",
            normalized_email="viewer@example.com",
            display_name="Viewer",
            password_hash=security.hash_password("Viewer Password 42!"),
            status="active",
            password_changed_at=now,
            created_at=now,
            updated_at=now,
        )
        session.add(viewer)
        session.flush()
        session.add(WorkspaceMembershipRecord(
            workspace_id=workspace_id,
            user_id=viewer.id,
            role="viewer",
            status="active",
            activated_at=now,
            created_at=now,
            updated_at=now,
        ))
        session.commit()

    client.cookies.clear()
    login_client(client, email="viewer@example.com", password="Viewer Password 42!")
    response = client.post(
        workspace_url(workspace_id, "/asset-library"),
        json={
            "assetType": "tool",
            "name": "受限工具",
            "description": "Viewer cannot create this",
            "parameterSchema": {"type": "object"},
        },
        headers=csrf_headers(client),
    )

    assert response.status_code == 403


def test_update_and_deactivate_tool_skill_asset_blocks_new_agent_binding(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'tool-skill-assets-lifecycle.db'}",
    )
    asset = create_asset(client, workspace_id)

    update = client.patch(
        workspace_url(workspace_id, f"/asset-library/{asset['id']}"),
        json={
            "name": "飞书搜索 V2",
            "description": "Search Feishu documents with a safer contract",
            "parameterSchema": {
                "type": "object",
                "properties": {"keyword": {"type": "string"}},
                "required": ["keyword"],
            },
            "adapterType": "http",
            "adapterConfig": {
                "method": "POST",
                "url": "https://internal.example.test/search",
            },
        },
        headers=csrf_headers(client),
    )
    deactivated = client.post(
        workspace_url(workspace_id, f"/asset-library/{asset['id']}/deactivate"),
        headers=csrf_headers(client),
    )
    agent = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": "工具治理 Agent",
            "role": "Use governed tools.",
            "owner": "Platform Team",
            "model": "configured-model",
        },
        headers=csrf_headers(client),
    ).json()
    bind_disabled = client.patch(
        workspace_url(workspace_id, f"/agents/{agent['id']}"),
        json={"tools": ["飞书搜索 V2"]},
        headers=csrf_headers(client),
    )

    assert update.status_code == 200
    assert update.json()["name"] == "飞书搜索 V2"
    assert update.json()["description"] == "Search Feishu documents with a safer contract"
    assert update.json()["parameterSchema"]["required"] == ["keyword"]
    assert update.json()["adapterType"] == "http"
    assert update.json()["adapterConfig"]["method"] == "POST"
    assert deactivated.status_code == 200
    assert deactivated.json()["status"] == "disabled"
    assert bind_disabled.status_code == 422
    assert bind_disabled.json()["detail"] == "未授权或不可用的 Tool：飞书搜索 V2"
    assert "apiKey" not in update.text
    assert "apiKey" not in deactivated.text


def test_tool_skill_asset_impact_lists_draft_agents_and_published_versions(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'tool-skill-assets-impact.db'}",
    )
    tool = create_asset(client, workspace_id, name="飞书搜索")
    skill = client.post(
        workspace_url(workspace_id, "/asset-library"),
        json={
            "assetType": "skill",
            "name": "竞品分析",
            "description": "Analyze competitors",
            "parameterSchema": {"type": "object"},
        },
        headers=csrf_headers(client),
    ).json()
    draft_agent = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": "草稿工具 Agent",
            "role": "Draft depends on the Tool.",
            "owner": "Platform Team",
            "model": "configured-model",
        },
        headers=csrf_headers(client),
    ).json()
    client.patch(
        workspace_url(workspace_id, f"/agents/{draft_agent['id']}"),
        json={"tools": ["飞书搜索"]},
        headers=csrf_headers(client),
    )
    versioned_agent = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": "版本工具 Agent",
            "role": "Published with Tool and Skill snapshots.",
            "owner": "Platform Team",
            "model": "configured-model",
        },
        headers=csrf_headers(client),
    ).json()
    client.patch(
        workspace_url(workspace_id, f"/agents/{versioned_agent['id']}"),
        json={"tools": ["飞书搜索"], "skills": ["竞品分析"]},
        headers=csrf_headers(client),
    )
    published = client.post(
        workspace_url(workspace_id, f"/agents/{versioned_agent['id']}/publish"),
        headers=csrf_headers(client),
    ).json()
    client.post(
        workspace_url(workspace_id, f"/asset-library/{tool['id']}/deactivate"),
        headers=csrf_headers(client),
    )

    tool_impact = client.get(workspace_url(workspace_id, f"/asset-library/{tool['id']}/impact"))
    skill_impact = client.get(workspace_url(workspace_id, f"/asset-library/{skill['id']}/impact"))

    assert tool_impact.status_code == 200
    impact = tool_impact.json()
    assert impact["assetId"] == tool["id"]
    assert impact["assetType"] == "tool"
    assert impact["assetName"] == "飞书搜索"
    assert impact["totals"] == {"draftAgents": 2, "publishedVersions": 1}
    assert {item["agentName"] for item in impact["draftAgents"]} == {"草稿工具 Agent", "版本工具 Agent"}
    assert impact["publishedVersions"] == [
        {
            "agentId": versioned_agent["id"],
            "agentName": "版本工具 Agent",
            "versionId": published["id"],
            "version": published["version"],
        },
    ]
    assert "飞书搜索" in published["snapshot"]["tools"]
    assert skill_impact.status_code == 200
    assert skill_impact.json()["assetType"] == "skill"
    assert skill_impact.json()["totals"] == {"draftAgents": 1, "publishedVersions": 1}
    assert "apiKey" not in tool_impact.text
