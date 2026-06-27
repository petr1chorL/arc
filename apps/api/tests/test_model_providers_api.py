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
