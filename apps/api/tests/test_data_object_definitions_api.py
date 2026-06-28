from sqlalchemy import select

from api_test_support import create_authenticated_client, csrf_headers, workspace_url
from app.models import DataObjectDefinitionRecord


def create_data_object(client, workspace_id: str, name: str = "Product Brief") -> dict:
    response = client.post(
        workspace_url(workspace_id, "/data-objects"),
        json={
            "name": name,
            "description": "Structured product brief exchanged between workflow nodes.",
            "schema": {
                "type": "object",
                "required": ["asin", "summary"],
                "properties": {
                    "asin": {"type": "string"},
                    "summary": {"type": "string"},
                },
            },
        },
        headers=csrf_headers(client),
    )
    assert response.status_code == 201
    return response.json()


def test_create_and_list_data_object_definitions(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'data-objects.db'}",
    )

    definition = create_data_object(client, workspace_id)
    list_response = client.get(workspace_url(workspace_id, "/data-objects"))

    assert definition["name"] == "Product Brief"
    assert definition["status"] == "draft"
    assert definition["version"] == "unpublished"
    assert definition["schema"]["required"] == ["asin", "summary"]
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [definition["id"]]


def test_data_object_definition_names_are_unique_per_workspace(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'data-objects-unique.db'}",
    )
    create_data_object(client, workspace_id)

    duplicate = client.post(
        workspace_url(workspace_id, "/data-objects"),
        json={
            "name": "Product Brief",
            "schema": {"type": "object"},
        },
        headers=csrf_headers(client),
    )

    assert duplicate.status_code == 409


def test_data_object_definitions_are_isolated_by_workspace(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'data-objects-isolation.db'}"
    client, workspace_id = create_authenticated_client(database_url)
    definition = create_data_object(client, workspace_id)

    other_workspace = client.post(
        "/api/workspaces",
        json={"name": "Other Workspace", "slug": "other-workspace"},
        headers=csrf_headers(client),
    )
    assert other_workspace.status_code == 201
    other_workspace_id = other_workspace.json()["id"]

    assert client.get(workspace_url(other_workspace_id, "/data-objects")).json() == []
    assert client.get(workspace_url(workspace_id, "/data-objects")).json()[0]["id"] == definition["id"]


def test_data_object_publish_freezes_snapshot(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'data-objects-publish.db'}",
    )
    definition = create_data_object(client, workspace_id)

    published = client.post(
        workspace_url(workspace_id, f"/data-objects/{definition['id']}/publish"),
        headers=csrf_headers(client),
    )
    assert published.status_code == 201
    version = published.json()
    assert version["version"] == "v1.0.0"
    assert version["snapshot"]["name"] == "Product Brief"
    assert version["snapshot"]["schema"]["required"] == ["asin", "summary"]

    with client.app.state.session_factory() as session:
        record = session.scalar(select(DataObjectDefinitionRecord).where(
            DataObjectDefinitionRecord.id == definition["id"],
        ))
        record.name = "Updated Product Brief"
        record.schema = {"type": "object", "properties": {"updated": {"type": "boolean"}}}
        session.commit()

    republished = client.post(
        workspace_url(workspace_id, f"/data-objects/{definition['id']}/publish"),
        headers=csrf_headers(client),
    )
    assert republished.status_code == 201
    assert version["snapshot"]["name"] == "Product Brief"
    assert version["snapshot"]["schema"]["required"] == ["asin", "summary"]
    assert republished.json()["version"] == "v1.1.0"
    assert republished.json()["snapshot"]["name"] == "Updated Product Brief"
