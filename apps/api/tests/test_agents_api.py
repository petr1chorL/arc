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
