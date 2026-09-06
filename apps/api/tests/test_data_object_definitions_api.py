import pytest
import sqlite3
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from api_test_support import create_authenticated_client, csrf_headers, workspace_url
from app.models import DataObjectDefinitionRecord, DataObjectVersionRecord, UserRecord, WorkspaceMembershipRecord


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
        record.object_schema = {"type": "object", "properties": {"updated": {"type": "boolean"}}}
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
    assert republished.json()["snapshot"]["schema"] == {
        "type": "object", "properties": {"updated": {"type": "boolean"}},
    }
    with client.app.state.session_factory() as session:
        stored_first = session.get(DataObjectVersionRecord, version["id"])
        stored_second = session.get(DataObjectVersionRecord, republished.json()["id"])
        assert stored_first.snapshot == version["snapshot"]
        assert stored_second.snapshot == republished.json()["snapshot"]


def test_data_object_definition_can_be_updated_and_republished(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'data-objects-update.db'}",
    )
    definition = create_data_object(client, workspace_id)
    first_version = client.post(
        workspace_url(workspace_id, f"/data-objects/{definition['id']}/publish"),
        headers=csrf_headers(client),
    ).json()

    update_response = client.patch(
        workspace_url(workspace_id, f"/data-objects/{definition['id']}"),
        json={
            "name": "Updated Product Brief",
            "description": "Updated schema for downstream workflows.",
            "schema": {
                "type": "object",
                "required": ["asin", "score"],
                "properties": {
                    "asin": {"type": "string"},
                    "score": {"type": "number"},
                },
            },
        },
        headers=csrf_headers(client),
    )

    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["name"] == "Updated Product Brief"
    assert updated["description"] == "Updated schema for downstream workflows."
    assert updated["schema"]["required"] == ["asin", "score"]
    assert updated["updatedAt"] != definition["updatedAt"]

    second_version = client.post(
        workspace_url(workspace_id, f"/data-objects/{definition['id']}/publish"),
        headers=csrf_headers(client),
    ).json()
    assert first_version["snapshot"]["name"] == "Product Brief"
    assert first_version["snapshot"]["schema"]["required"] == ["asin", "summary"]
    assert second_version["version"] == "v1.1.0"
    assert second_version["snapshot"]["name"] == "Updated Product Brief"
    assert second_version["snapshot"]["schema"]["required"] == ["asin", "score"]
    with client.app.state.session_factory() as session:
        assert session.get(DataObjectVersionRecord, first_version["id"]).snapshot == first_version["snapshot"]
        assert session.get(DataObjectVersionRecord, second_version["id"]).snapshot == second_version["snapshot"]


def test_data_object_definition_update_rejects_duplicate_name(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'data-objects-update-duplicate.db'}",
    )
    first = create_data_object(client, workspace_id, name="Product Brief")
    second = create_data_object(client, workspace_id, name="User Insight")

    duplicate = client.patch(
        workspace_url(workspace_id, f"/data-objects/{second['id']}"),
        json={"name": first["name"]},
        headers=csrf_headers(client),
    )

    assert duplicate.status_code == 409


def test_data_object_history_reads_frozen_versions_after_draft_changes(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'data-object-history.db'}",
    )
    definition = create_data_object(client, workspace_id)
    path = workspace_url(workspace_id, f"/data-objects/{definition['id']}")
    empty = client.get(f"{path}/versions")
    assert empty.status_code == 200
    assert empty.json() == []
    first = client.post(f"{path}/publish", headers=csrf_headers(client))
    assert first.status_code == 201
    updated_schema = {"type": "object", "properties": {"score": {"type": "number"}}}
    update = client.patch(path, json={"schema": updated_schema}, headers=csrf_headers(client))
    assert update.status_code == 200
    second = client.post(f"{path}/publish", headers=csrf_headers(client))
    assert second.status_code == 201
    history = client.get(f"{path}/versions")
    assert history.status_code == 200
    assert history.json() == [second.json(), first.json()]
    assert first.json()["snapshot"]["schema"] == definition["schema"]
    assert second.json()["snapshot"]["schema"] == updated_schema
    with client.app.state.session_factory() as session:
        assert session.get(DataObjectVersionRecord, first.json()["id"]).snapshot == first.json()["snapshot"]
        assert session.get(DataObjectVersionRecord, second.json()["id"]).snapshot == second.json()["snapshot"]


@pytest.mark.parametrize("snapshot", [[], {"schema": []}, {"name": "synthetic-private"}])
def test_data_object_history_rejects_invalid_snapshot_without_rewriting(tmp_path, snapshot):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'data-object-invalid-history.db'}",
    )
    definition = create_data_object(client, workspace_id)
    path = workspace_url(workspace_id, f"/data-objects/{definition['id']}")
    published = client.post(f"{path}/publish", headers=csrf_headers(client)).json()
    with client.app.state.session_factory() as session:
        session.get(DataObjectVersionRecord, published["id"]).snapshot = snapshot
        session.commit()
    response = client.get(f"{path}/versions")
    assert response.status_code == 409
    assert response.json() == {"detail": "历史 Data Object 版本结构不符合要求，需先完成治理"}
    with client.app.state.session_factory() as session:
        assert session.get(DataObjectVersionRecord, published["id"]).snapshot == snapshot


def test_data_object_history_scopes_definition_and_versions(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'data-object-history-scope.db'}",
    )
    definition = create_data_object(client, workspace_id)
    path = f"/data-objects/{definition['id']}/versions"
    other = client.post("/api/workspaces", json={"name": "History Other", "slug": "history-other"},
                        headers=csrf_headers(client))
    assert other.status_code == 201
    other_id = other.json()["id"]
    assert client.get(workspace_url(other_id, path)).status_code == 404
    assert client.get(workspace_url(workspace_id, "/data-objects/missing/versions")).status_code == 404
    with client.app.state.session_factory() as session:
        session.add(DataObjectVersionRecord(workspace_id=other_id, definition_id=definition["id"],
                                           version="v9.0.0", snapshot={"schema": {}}))
        session.commit()
    assert client.get(workspace_url(workspace_id, path)).json() == []
    client.cookies.clear()
    assert client.get(workspace_url(workspace_id, path)).status_code == 401


@pytest.mark.parametrize("method,suffix,body", [
    ("POST", "", {"name": "synthetic-private", "schema": []}),
    ("PATCH", "/missing", {"description": {"synthetic-private": True}}),
])
def test_data_object_invalid_input_has_fixed_error(tmp_path, method, suffix, body):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'data-object-fixed-error.db'}",
    )
    response = client.request(method, workspace_url(workspace_id, f"/data-objects{suffix}"),
                              json=body, headers=csrf_headers(client))
    assert response.status_code == 422
    assert response.json() == {"detail": "Data Object 请求字段不符合要求"}
    assert "synthetic-private" not in response.text


def test_data_object_publish_rejects_existing_candidate_without_partial_write(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'data-object-version-conflict.db'}",
    )
    definition = create_data_object(client, workspace_id)
    with client.app.state.session_factory() as session:
        session.add(DataObjectVersionRecord(workspace_id=workspace_id, definition_id=definition["id"],
                                           version="v1.1.0", snapshot=definition))
        session.commit()
    response = client.post(workspace_url(workspace_id, f"/data-objects/{definition['id']}/publish"),
                           headers=csrf_headers(client))
    assert response.status_code == 409
    assert response.json() == {"detail": "Data Object version already exists"}
    with client.app.state.session_factory() as session:
        versions = list(session.scalars(select(DataObjectVersionRecord).where(
            DataObjectVersionRecord.definition_id == definition["id"],
        )))
        assert len(versions) == 1
        assert versions[0].snapshot == definition
        stored = session.get(DataObjectDefinitionRecord, definition["id"])
        assert (stored.status, stored.version) == ("draft", "unpublished")


@pytest.mark.parametrize("operation", ["list", "update", "publish"])
def test_data_object_invalid_draft_schema_fails_closed(tmp_path, operation):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'data-object-invalid-draft.db'}",
    )
    definition = create_data_object(client, workspace_id)
    with client.app.state.session_factory() as session:
        session.get(DataObjectDefinitionRecord, definition["id"]).object_schema = ["synthetic-private"]
        session.commit()
    base = workspace_url(workspace_id, "/data-objects")
    if operation == "list":
        response = client.get(base)
    elif operation == "update":
        response = client.patch(f"{base}/{definition['id']}", json={"description": "must roll back"}, headers=csrf_headers(client))
    else:
        response = client.post(f"{base}/{definition['id']}/publish", headers=csrf_headers(client))
    assert response.status_code == 409
    assert response.json() == {"detail": "历史 Data Object 版本结构不符合要求，需先完成治理"}
    with client.app.state.session_factory() as session:
        record = session.get(DataObjectDefinitionRecord, definition["id"])
        assert record.object_schema == ["synthetic-private"]
        assert record.description == definition["description"]
        assert record.version == "unpublished"


@pytest.mark.parametrize("operation", ["create", "update"])
def test_data_object_name_constraint_race_returns_conflict(tmp_path, monkeypatch, operation):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'data-object-name-race.db'}",
    )
    definition = create_data_object(client, workspace_id)
    original_flush = Session.flush

    def fail_name_constraint(session, objects=None):
        if any(isinstance(record, DataObjectDefinitionRecord) and record.name == "Race target"
               for record in [*session.new, *session.dirty]):
            raise IntegrityError("synthetic", {}, sqlite3.IntegrityError(
                "UNIQUE constraint failed: data_object_definitions.workspace_id, data_object_definitions.name"))
        return original_flush(session, objects)

    monkeypatch.setattr(Session, "flush", fail_name_constraint)
    base = workspace_url(workspace_id, "/data-objects")
    response = client.request("POST" if operation == "create" else "PATCH",
                              base if operation == "create" else f"{base}/{definition['id']}",
                              json={"name": "Race target", "schema": {}}, headers=csrf_headers(client))
    assert response.status_code == 409
    assert response.json() == {"detail": "Data Object definition name already exists"}
    monkeypatch.setattr(Session, "flush", original_flush)
    assert client.get(base).json() == [definition]


@pytest.mark.parametrize("role", ["viewer", "operator", "builder", "workspace_admin"])
def test_data_object_five_routes_respect_workspace_role(tmp_path, role):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'data-object-roles.db'}",
    )
    definition = create_data_object(client, workspace_id)
    with client.app.state.session_factory() as session:
        user = session.scalar(select(UserRecord))
        user.is_organization_admin = False
        membership = session.scalar(select(WorkspaceMembershipRecord).where(
            WorkspaceMembershipRecord.workspace_id == workspace_id,
            WorkspaceMembershipRecord.user_id == user.id,
        ))
        membership.role = role
        session.commit()
    base = workspace_url(workspace_id, "/data-objects")
    writable = role in {"builder", "workspace_admin"}
    for method, suffix, body in [
        ("GET", "", None),
        ("POST", "", {"name": "Role object", "schema": {}}),
        ("PATCH", f"/{definition['id']}", {"description": "Role edit"}),
        ("POST", f"/{definition['id']}/publish", None),
        ("GET", f"/{definition['id']}/versions", None),
    ]:
        response = client.request(method, base + suffix, headers=csrf_headers(client),
                                  **({"json": body} if body is not None else {}))
        expected = 200 if method == "GET" else 403 if not writable else 201 if method == "POST" else 200
        assert response.status_code == expected, (role, method, suffix, response.status_code)
    if not writable:
        assert client.get(base).json() == [definition]
