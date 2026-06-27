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
