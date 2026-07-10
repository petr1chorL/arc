from uuid import UUID

from fastapi.testclient import TestClient

from api_test_support import create_authenticated_client, csrf_headers, workspace_url
from app.models import ModelProviderRecord


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
        "modelProviderId": None,
        "modelProvider": "openai-compatible",
        "modelBaseUrl": "",
        "temperature": 0.2,
        "maxOutputTokens": 2000,
        "tools": [],
        "skills": [],
        "toolAssetRefs": [],
        "skillAssetRefs": [],
        "systemPrompt": "",
        "runtimeManifest": {},
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


def test_agent_runtime_manifest_is_saved_and_published(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'agents-runtime-manifest.db'}"
    client, workspace_id = create_authenticated_client(database_url)
    created = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": "LangChain Package Agent",
            "role": "Run an external LangChain Python package.",
            "owner": "Platform Team",
            "model": "deepseek-v4-pro",
        },
        headers=csrf_headers(client),
    ).json()
    runtime_manifest = {
        "runtime": "langchain",
        "sourceType": "python_package",
        "packageName": "arc-langchain-agents",
        "packageVersion": "1.0.3",
        "entrypoint": "arc_agents.weather:create_agent",
        "packageSource": "internal-pypi",
        "packageHash": "sha256:abc123",
    }

    update_response = client.patch(
        workspace_url(workspace_id, f"/agents/{created['id']}"),
        json={"runtimeManifest": runtime_manifest},
        headers=csrf_headers(client),
    )

    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["runtimeManifest"] == runtime_manifest

    published = client.post(
        workspace_url(workspace_id, f"/agents/{created['id']}/publish"),
        json={"note": "Register Python package runtime entrypoint"},
        headers=csrf_headers(client),
    ).json()

    assert published["snapshot"]["runtimeManifest"] == runtime_manifest


def test_agent_can_bind_workspace_model_provider_asset(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'agents.db'}"
    client, workspace_id = create_authenticated_client(database_url)
    provider = client.post(
        workspace_url(workspace_id, "/model-providers"),
        json={
            "name": "DeepSeek Production",
            "providerType": "openai-compatible",
            "baseUrl": "https://api.deepseek.com",
            "defaultModel": "deepseek-v4-pro",
            "secretRef": "DEEPSEEK_API_KEY",
        },
        headers=csrf_headers(client),
    ).json()
    created = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": "Provider Bound Agent",
            "role": "Run with a Provider asset.",
            "owner": "Platform Team",
            "model": "placeholder-model",
        },
        headers=csrf_headers(client),
    ).json()

    update_response = client.patch(
        workspace_url(workspace_id, f"/agents/{created['id']}"),
        json={
            "modelProviderId": provider["id"],
            "apiKey": "must-not-be-persisted",
        },
        headers=csrf_headers(client),
    )

    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["modelProviderId"] == provider["id"]
    assert updated["modelProvider"] == "openai-compatible"
    assert updated["modelBaseUrl"] == "https://api.deepseek.com"
    assert updated["model"] == "deepseek-v4-pro"
    assert "apiKey" not in updated

    missing_response = client.patch(
        workspace_url(workspace_id, f"/agents/{created['id']}"),
        json={"modelProviderId": "missing-provider-id"},
        headers=csrf_headers(client),
    )

    assert missing_response.status_code == 404
    assert missing_response.json()["detail"] == "模型 Provider 不存在"

    published = client.post(
        workspace_url(workspace_id, f"/agents/{created['id']}/publish"),
        headers=csrf_headers(client),
    ).json()

    assert published["snapshot"]["modelProviderId"] == provider["id"]
    assert published["snapshot"]["modelProvider"] == "openai-compatible"
    assert published["snapshot"]["modelBaseUrl"] == "https://api.deepseek.com"
    assert published["snapshot"]["model"] == "deepseek-v4-pro"
    assert published["snapshot"]["modelSecretRef"] == "DEEPSEEK_API_KEY"
    assert "apiKey" not in published["snapshot"]


def test_agent_publish_does_not_snapshot_legacy_invalid_model_secret_ref(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'agents-inline-provider.db'}"
    client, workspace_id = create_authenticated_client(database_url)
    provider = client.post(
        workspace_url(workspace_id, "/model-providers"),
        json={
            "name": "DeepSeek Legacy Invalid",
            "providerType": "openai-compatible",
            "baseUrl": "https://api.deepseek.com",
            "defaultModel": "deepseek-v4-pro",
            "secretRef": "DEEPSEEK_API_KEY",
        },
        headers=csrf_headers(client),
    ).json()
    submitted_value = "inline-secret-value"
    with client.app.state.session_factory() as session:
        stored_provider = session.get(ModelProviderRecord, provider["id"])
        stored_provider.secret_ref = submitted_value
        session.commit()
    created = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": "Legacy Invalid Provider Agent",
            "role": "Reject a legacy invalid Provider credential reference.",
            "owner": "Platform Team",
            "model": "placeholder-model",
        },
        headers=csrf_headers(client),
    ).json()
    client.patch(
        workspace_url(workspace_id, f"/agents/{created['id']}"),
        json={"modelProviderId": provider["id"]},
        headers=csrf_headers(client),
    )

    published = client.post(
        workspace_url(workspace_id, f"/agents/{created['id']}/publish"),
        headers=csrf_headers(client),
    ).json()

    assert published["snapshot"]["modelProviderId"] == provider["id"]
    assert published["snapshot"]["modelSecretRef"] == ""
    assert submitted_value not in str(published["snapshot"])


def test_agent_publish_rejects_disabled_bound_model_provider(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'agents-provider-disabled.db'}"
    client, workspace_id = create_authenticated_client(database_url)
    provider = client.post(
        workspace_url(workspace_id, "/model-providers"),
        json={
            "name": "DeepSeek Disabled Before Publish",
            "providerType": "openai-compatible",
            "baseUrl": "https://api.deepseek.com",
            "defaultModel": "deepseek-v4-pro",
            "secretRef": "DEEPSEEK_API_KEY",
        },
        headers=csrf_headers(client),
    ).json()
    created = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": "Provider Disabled Agent",
            "role": "Should not publish with a disabled Provider.",
            "owner": "Platform Team",
            "model": "placeholder-model",
        },
        headers=csrf_headers(client),
    ).json()
    client.patch(
        workspace_url(workspace_id, f"/agents/{created['id']}"),
        json={"modelProviderId": provider["id"]},
        headers=csrf_headers(client),
    )
    client.post(
        workspace_url(workspace_id, f"/model-providers/{provider['id']}/deactivate"),
        headers=csrf_headers(client),
    )

    response = client.post(
        workspace_url(workspace_id, f"/agents/{created['id']}/publish"),
        headers=csrf_headers(client),
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "模型 Provider 已停用"


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
