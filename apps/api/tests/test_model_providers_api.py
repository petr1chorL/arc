from api_test_support import csrf_headers, create_authenticated_client, workspace_url


def test_model_provider_rejects_inline_secret_without_echoing_or_persisting_it(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'model-provider-inline-secret.db'}",
    )
    submitted_value = "inline-secret-value"

    response = client.post(
        workspace_url(workspace_id, "/model-providers"),
        json={
            "name": "Unsafe Inline Provider",
            "providerType": "openai-compatible",
            "baseUrl": "https://api.deepseek.com",
            "defaultModel": "deepseek-v4-pro",
            "secretRef": submitted_value,
        },
        headers=csrf_headers(client),
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "Secret Ref 只能填写后端环境变量名"}
    assert submitted_value not in response.text
    assert client.get(workspace_url(workspace_id, "/model-providers")).json() == []


def test_model_provider_rejects_inline_secret_on_update_without_changing_the_reference(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'model-provider-inline-update.db'}",
    )
    provider = client.post(
        workspace_url(workspace_id, "/model-providers"),
        json={
            "name": "Safe Environment Provider",
            "providerType": "openai-compatible",
            "baseUrl": "https://api.deepseek.com",
            "defaultModel": "deepseek-v4-pro",
            "secretRef": "DEEPSEEK_API_KEY",
        },
        headers=csrf_headers(client),
    ).json()
    submitted_value = "inline-secret-value"

    response = client.patch(
        workspace_url(workspace_id, f"/model-providers/{provider['id']}"),
        json={"secretRef": submitted_value},
        headers=csrf_headers(client),
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "Secret Ref 只能填写后端环境变量名"}
    assert submitted_value not in response.text
    stored = client.get(workspace_url(workspace_id, "/model-providers")).json()[0]
    assert stored["secretRef"] == "DEEPSEEK_API_KEY"


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


def test_model_provider_impact_lists_bound_drafts_and_published_versions(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'model-provider-impact.db'}"
    client, workspace_id = create_authenticated_client(database_url)
    provider = client.post(
        workspace_url(workspace_id, "/model-providers"),
        json={
            "name": "DeepSeek Impact",
            "providerType": "openai-compatible",
            "baseUrl": "https://api.deepseek.com",
            "defaultModel": "deepseek-v4-pro",
            "secretRef": "DEEPSEEK_IMPACT_KEY",
        },
        headers=csrf_headers(client),
    ).json()
    draft_agent = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": "草稿依赖 Agent",
            "role": "Still bound to the Provider draft.",
            "owner": "Platform Team",
            "model": "placeholder-model",
        },
        headers=csrf_headers(client),
    ).json()
    client.patch(
        workspace_url(workspace_id, f"/agents/{draft_agent['id']}"),
        json={"modelProviderId": provider["id"]},
        headers=csrf_headers(client),
    )
    versioned_agent = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": "版本依赖 Agent",
            "role": "Published with the Provider snapshot.",
            "owner": "Platform Team",
            "model": "placeholder-model",
        },
        headers=csrf_headers(client),
    ).json()
    client.patch(
        workspace_url(workspace_id, f"/agents/{versioned_agent['id']}"),
        json={"modelProviderId": provider["id"]},
        headers=csrf_headers(client),
    )
    published = client.post(
        workspace_url(workspace_id, f"/agents/{versioned_agent['id']}/publish"),
        headers=csrf_headers(client),
    ).json()

    response = client.get(workspace_url(workspace_id, f"/model-providers/{provider['id']}/impact"))

    assert response.status_code == 200
    impact = response.json()
    assert impact["providerId"] == provider["id"]
    assert impact["totals"] == {"draftAgents": 2, "publishedVersions": 1}
    assert {item["agentName"] for item in impact["draftAgents"]} == {"草稿依赖 Agent", "版本依赖 Agent"}
    assert impact["publishedVersions"] == [
        {
            "agentId": versioned_agent["id"],
            "agentName": "版本依赖 Agent",
            "versionId": published["id"],
            "version": published["version"],
            "modelSecretRef": "DEEPSEEK_IMPACT_KEY",
        },
    ]
    assert "apiKey" not in response.text


def test_model_provider_migrates_draft_agents_without_rewriting_published_versions(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'model-provider-migration.db'}"
    client, workspace_id = create_authenticated_client(database_url)
    source_provider = client.post(
        workspace_url(workspace_id, "/model-providers"),
        json={
            "name": "DeepSeek Legacy",
            "providerType": "openai-compatible",
            "baseUrl": "https://api.legacy.example.com",
            "defaultModel": "legacy-model",
            "secretRef": "LEGACY_PROVIDER_KEY",
        },
        headers=csrf_headers(client),
    ).json()
    target_provider = client.post(
        workspace_url(workspace_id, "/model-providers"),
        json={
            "name": "DeepSeek Target",
            "providerType": "openai-compatible",
            "baseUrl": "https://api.deepseek.com",
            "defaultModel": "deepseek-v4-pro",
            "secretRef": "TARGET_PROVIDER_KEY",
        },
        headers=csrf_headers(client),
    ).json()
    draft_agent = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": "待迁移草稿 Agent",
            "role": "Mutable draft bound to the legacy Provider.",
            "owner": "Platform Team",
            "model": "placeholder-model",
        },
        headers=csrf_headers(client),
    ).json()
    client.patch(
        workspace_url(workspace_id, f"/agents/{draft_agent['id']}"),
        json={"modelProviderId": source_provider["id"]},
        headers=csrf_headers(client),
    )
    versioned_agent = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": "已发布迁移 Agent",
            "role": "Mutable draft has a published source snapshot.",
            "owner": "Platform Team",
            "model": "placeholder-model",
        },
        headers=csrf_headers(client),
    ).json()
    client.patch(
        workspace_url(workspace_id, f"/agents/{versioned_agent['id']}"),
        json={"modelProviderId": source_provider["id"]},
        headers=csrf_headers(client),
    )
    published = client.post(
        workspace_url(workspace_id, f"/agents/{versioned_agent['id']}/publish"),
        headers=csrf_headers(client),
    ).json()

    response = client.post(
        workspace_url(workspace_id, f"/model-providers/{source_provider['id']}/migrate-drafts"),
        json={
            "targetProviderId": target_provider["id"],
            "reason": "V0.15C test migration before Provider retirement.",
        },
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    result = response.json()
    assert result["sourceProviderId"] == source_provider["id"]
    assert result["targetProviderId"] == target_provider["id"]
    assert result["migratedCount"] == 2
    assert {item["agentName"] for item in result["migratedAgents"]} == {"待迁移草稿 Agent", "已发布迁移 Agent"}
    assert "apiKey" not in response.text

    updated_agent = client.get(workspace_url(workspace_id, f"/agents/{draft_agent['id']}")).json()
    assert updated_agent["modelProviderId"] == target_provider["id"]
    assert updated_agent["modelBaseUrl"] == "https://api.deepseek.com"
    assert updated_agent["model"] == "deepseek-v4-pro"

    source_impact = client.get(
        workspace_url(workspace_id, f"/model-providers/{source_provider['id']}/impact"),
    ).json()
    target_impact = client.get(
        workspace_url(workspace_id, f"/model-providers/{target_provider['id']}/impact"),
    ).json()
    assert source_impact["totals"] == {"draftAgents": 0, "publishedVersions": 1}
    assert target_impact["totals"]["draftAgents"] == 2
    assert published["snapshot"]["modelProviderId"] == source_provider["id"]
    assert source_impact["publishedVersions"][0]["versionId"] == published["id"]


def test_model_provider_migration_rejects_disabled_target_provider(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'model-provider-migration-disabled.db'}"
    client, workspace_id = create_authenticated_client(database_url)
    source_provider = client.post(
        workspace_url(workspace_id, "/model-providers"),
        json={
            "name": "DeepSeek Source",
            "providerType": "openai-compatible",
            "baseUrl": "https://api.source.example.com",
            "defaultModel": "source-model",
            "secretRef": "SOURCE_PROVIDER_KEY",
        },
        headers=csrf_headers(client),
    ).json()
    disabled_target = client.post(
        workspace_url(workspace_id, "/model-providers"),
        json={
            "name": "DeepSeek Disabled Target",
            "providerType": "openai-compatible",
            "baseUrl": "https://api.disabled.example.com",
            "defaultModel": "disabled-model",
            "secretRef": "DISABLED_PROVIDER_KEY",
        },
        headers=csrf_headers(client),
    ).json()
    client.post(
        workspace_url(workspace_id, f"/model-providers/{disabled_target['id']}/deactivate"),
        headers=csrf_headers(client),
    )

    response = client.post(
        workspace_url(workspace_id, f"/model-providers/{source_provider['id']}/migrate-drafts"),
        json={
            "targetProviderId": disabled_target["id"],
            "reason": "Disabled target must be rejected.",
        },
        headers=csrf_headers(client),
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "模型 Provider 已停用"


def test_model_provider_audit_events_show_lifecycle_and_migration_metadata(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'model-provider-audit.db'}"
    client, workspace_id = create_authenticated_client(database_url)
    source_provider = client.post(
        workspace_url(workspace_id, "/model-providers"),
        json={
            "name": "DeepSeek Audit Source",
            "providerType": "openai-compatible",
            "baseUrl": "https://api.source.example.com",
            "defaultModel": "source-model",
            "secretRef": "SOURCE_PROVIDER_KEY",
        },
        headers=csrf_headers(client),
    ).json()
    target_provider = client.post(
        workspace_url(workspace_id, "/model-providers"),
        json={
            "name": "DeepSeek Audit Target",
            "providerType": "openai-compatible",
            "baseUrl": "https://api.target.example.com",
            "defaultModel": "target-model",
            "secretRef": "TARGET_PROVIDER_KEY",
        },
        headers=csrf_headers(client),
    ).json()
    client.patch(
        workspace_url(workspace_id, f"/model-providers/{source_provider['id']}"),
        json={
            "name": "DeepSeek Audit Source Updated",
            "baseUrl": "https://api.source.example.com/v1",
            "defaultModel": "source-model-v2",
            "secretRef": "SOURCE_PROVIDER_KEY_V2",
        },
        headers=csrf_headers(client),
    )
    draft_agent = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": "Provider Audit Agent",
            "role": "Bound to the audited Provider.",
            "owner": "Platform Team",
            "model": "placeholder-model",
        },
        headers=csrf_headers(client),
    ).json()
    client.patch(
        workspace_url(workspace_id, f"/agents/{draft_agent['id']}"),
        json={"modelProviderId": source_provider["id"]},
        headers=csrf_headers(client),
    )
    client.post(
        workspace_url(workspace_id, f"/model-providers/{source_provider['id']}/migrate-drafts"),
        json={
            "targetProviderId": target_provider["id"],
            "reason": "Prepare Provider rollback evidence.",
        },
        headers=csrf_headers(client),
    )

    response = client.get(
        workspace_url(workspace_id, f"/model-providers/{source_provider['id']}/audit-events"),
    )

    assert response.status_code == 200
    audit_events = response.json()
    assert len(audit_events) >= 3
    assert [event["eventType"] for event in audit_events[:3]] == [
        "model_provider.migrate_drafts",
        "model_provider.update",
        "model_provider.create",
    ]
    migration_event = audit_events[0]
    assert migration_event["outcome"] == "success"
    assert migration_event["targetType"] == "model_provider"
    assert migration_event["targetId"] == source_provider["id"]
    assert migration_event["reason"] == "Prepare Provider rollback evidence."
    assert migration_event["metadata"]["sourceProviderId"] == source_provider["id"]
    assert migration_event["metadata"]["targetProviderId"] == target_provider["id"]
    assert migration_event["metadata"]["migratedAgentIds"] == [draft_agent["id"]]
    assert "apiKey" not in response.text
