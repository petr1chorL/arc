from uuid import UUID

from fastapi.testclient import TestClient

from api_test_support import create_authenticated_client, csrf_headers, workspace_url


def test_create_agent_rejects_blank_name(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'agents.db'}"
    client, workspace_id = create_authenticated_client(database_url)

    response = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": " ",
            "role": "Draft answers for customer issues.",
            "owner": "Product Team",
            "model": "GPT-5",
        },
        headers=csrf_headers(client),
    )

    assert response.status_code == 422


def test_create_agent_persists_and_lists_complete_contract(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'agents.db'}"
    client, workspace_id = create_authenticated_client(database_url)
    payload = {
        "name": "Customer Insight Agent",
        "role": "Draft answers for customer issues.",
        "owner": "Product Team",
        "model": "GPT-5",
    }

    create_response = client.post(
        workspace_url(workspace_id, "/agents"),
        json=payload,
        headers=csrf_headers(client),
    )

    assert create_response.status_code == 201
    created = create_response.json()
    UUID(created["id"])
    assert created == {
        **payload,
        "id": created["id"],
        "status": "调试中",
        "version": "v0.1.0",
        "passRate": 0,
        "runs": 0,
        "modelProvider": "openai-compatible",
        "modelBaseUrl": "",
        "temperature": 0.2,
        "maxOutputTokens": 2000,
        "tools": [],
        "skills": [],
        "systemPrompt": "",
        "createdAt": created["createdAt"],
        "updatedAt": created["updatedAt"],
    }
    assert created["createdAt"] == created["updatedAt"]

    list_response = client.get(workspace_url(workspace_id, "/agents"))

    assert list_response.status_code == 200
    assert list_response.json() == [created]


def test_agent_runtime_configuration_is_saved_and_published_without_secrets(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'agents.db'}"
    client, workspace_id = create_authenticated_client(database_url)
    created = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": "Runtime Config Agent",
            "role": "Run with explicit provider settings.",
            "owner": "Platform Team",
            "model": "deepseek-v4-pro",
        },
        headers=csrf_headers(client),
    ).json()

    update_response = client.patch(
        workspace_url(workspace_id, f"/agents/{created['id']}"),
        json={
            "modelProvider": "openai-compatible",
            "modelBaseUrl": "https://api.deepseek.com",
            "temperature": 0.2,
            "maxOutputTokens": 1200,
            "apiKey": "must-not-be-persisted",
        },
        headers=csrf_headers(client),
    )

    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["modelProvider"] == "openai-compatible"
    assert updated["modelBaseUrl"] == "https://api.deepseek.com"
    assert updated["temperature"] == 0.2
    assert updated["maxOutputTokens"] == 1200
    assert "apiKey" not in updated

    published = client.post(
        workspace_url(workspace_id, f"/agents/{created['id']}/publish"),
        headers=csrf_headers(client),
    ).json()

    assert published["snapshot"]["modelProvider"] == "openai-compatible"
    assert published["snapshot"]["modelBaseUrl"] == "https://api.deepseek.com"
    assert published["snapshot"]["temperature"] == 0.2
    assert published["snapshot"]["maxOutputTokens"] == 1200
    assert "apiKey" not in published["snapshot"]


def test_agent_survives_application_restart(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'agents.db'}"
    payload = {
        "name": "Scenario Agent",
        "role": "Generate scenario plans for the team.",
        "owner": "Platform Team",
        "model": "GPT-5",
    }
    first_client, workspace_id = create_authenticated_client(database_url)
    created = first_client.post(
        workspace_url(workspace_id, "/agents"),
        json=payload,
        headers=csrf_headers(first_client),
    ).json()
    first_client.close()

    restarted_client, restarted_workspace_id = create_authenticated_client(database_url)
    agents = restarted_client.get(workspace_url(restarted_workspace_id, "/agents")).json()

    assert agents == [created]
