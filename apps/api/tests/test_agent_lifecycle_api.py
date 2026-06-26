from fastapi.testclient import TestClient

from api_test_support import create_authenticated_client, csrf_headers, workspace_url


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
        headers=csrf_headers(client),
    )
    assert first_version.status_code == 201
    assert first_version.json()["version"] == "v1.0.0"
    assert first_version.json()["snapshot"]["name"] == "楂樼骇鐮旂┒ Agent"

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
