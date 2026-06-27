from api_test_support import csrf_headers, create_authenticated_client, workspace_url


def test_model_provider_assets_store_secret_references_without_api_keys(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'model-providers.db'}",
    )

    create_response = client.post(
        workspace_url(workspace_id, "/model-providers"),
        json={
            "name": "DeepSeek 生产",
            "providerType": "openai-compatible",
            "baseUrl": "https://api.deepseek.com",
            "defaultModel": "deepseek-v4-pro",
            "secretRef": "DEEPSEEK_API_KEY",
            "apiKey": "must-not-be-accepted",
        },
        headers=csrf_headers(client),
    )

    assert create_response.status_code == 201
    provider = create_response.json()
    assert provider["name"] == "DeepSeek 生产"
    assert provider["providerType"] == "openai-compatible"
    assert provider["baseUrl"] == "https://api.deepseek.com"
    assert provider["defaultModel"] == "deepseek-v4-pro"
    assert provider["secretRef"] == "DEEPSEEK_API_KEY"
    assert provider["status"] == "draft"
    assert "apiKey" not in provider

    list_response = client.get(workspace_url(workspace_id, "/model-providers"))
    assert list_response.status_code == 200
    assert list_response.json() == [provider]
    assert "must-not-be-accepted" not in list_response.text

    test_response = client.post(
        workspace_url(workspace_id, f"/model-providers/{provider['id']}/test"),
        headers=csrf_headers(client),
    )

    assert test_response.status_code == 200
    connectivity = test_response.json()
    assert connectivity["status"] == "missing_secret"
    assert connectivity["providerId"] == provider["id"]
    assert connectivity["message"] == "密钥引用 DEEPSEEK_API_KEY 未在后端环境变量中配置"
    assert "must-not-be-accepted" not in test_response.text


def test_model_provider_can_be_updated_deactivated_and_rejected_for_agent_binding(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'model-providers.db'}",
    )
    provider = client.post(
        workspace_url(workspace_id, "/model-providers"),
        json={
            "name": "DeepSeek 草稿",
            "providerType": "openai-compatible",
            "baseUrl": "https://api.deepseek.com",
            "defaultModel": "deepseek-v4-pro",
            "secretRef": "DEEPSEEK_API_KEY",
        },
        headers=csrf_headers(client),
    ).json()

    update_response = client.patch(
        workspace_url(workspace_id, f"/model-providers/{provider['id']}"),
        json={
            "name": "DeepSeek 生产",
            "baseUrl": "https://api.deepseek.com/v1",
            "defaultModel": "deepseek-chat",
            "secretRef": "DEEPSEEK_RUNTIME_KEY",
            "apiKey": "must-not-be-accepted",
        },
        headers=csrf_headers(client),
    )

    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["name"] == "DeepSeek 生产"
    assert updated["baseUrl"] == "https://api.deepseek.com/v1"
    assert updated["defaultModel"] == "deepseek-chat"
    assert updated["secretRef"] == "DEEPSEEK_RUNTIME_KEY"
    assert updated["status"] == "draft"
    assert "apiKey" not in updated
    assert "must-not-be-accepted" not in update_response.text

    deactivate_response = client.post(
        workspace_url(workspace_id, f"/model-providers/{provider['id']}/deactivate"),
        headers=csrf_headers(client),
    )

    assert deactivate_response.status_code == 200
    disabled = deactivate_response.json()
    assert disabled["status"] == "disabled"

    agent = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": "Provider Bound Agent",
            "role": "Use a Provider asset.",
            "owner": "Platform Team",
            "model": "placeholder-model",
        },
        headers=csrf_headers(client),
    ).json()
    bind_response = client.patch(
        workspace_url(workspace_id, f"/agents/{agent['id']}"),
        json={"modelProviderId": provider["id"]},
        headers=csrf_headers(client),
    )

    assert bind_response.status_code == 422
    assert bind_response.json()["detail"] == "模型 Provider 已停用"
