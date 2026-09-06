import pytest
from sqlalchemy import select

from api_test_support import csrf_headers, create_authenticated_client, workspace_url
from app.models import AgentRecord, AgentVersionRecord, AuditEventRecord, ModelProviderRecord, ToolSkillAssetInvocationRecord, ToolSkillAssetRecord, WorkspaceRecord


@pytest.fixture
def asset_client(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'assets.db'}")
    with client:
        yield client, workspace_id


@pytest.mark.parametrize("resource", ["model-providers", "asset-library"])
@pytest.mark.parametrize("problem", ["missing", "cross-workspace", "mismatched-snapshot"])
def test_impact_rejects_invalid_historical_agent_reference(asset_client, resource, problem):
    client, workspace_id = asset_client
    path = workspace_url(workspace_id, f"/{resource}")
    payload = ({"name": "provider", "baseUrl": "https://example.test", "defaultModel": "test", "secretRef": "MODEL_KEY"}
               if resource == "model-providers" else {"assetType": "tool", "name": "tool"})
    asset = client.post(path, headers=csrf_headers(client), json=payload).json()
    with client.app.state.session_factory() as session:
        agent_id = "missing-agent"
        if problem != "missing":
            agent = AgentRecord(workspace_id=workspace_id if problem == "mismatched-snapshot" else "other-workspace",
                                name="private-agent", role="", owner="", model="test")
            session.add(agent)
            session.flush()
            agent_id = agent.id
        snapshot = {"id": "wrong-agent" if problem == "mismatched-snapshot" else agent_id, "name": "private-name"}
        snapshot.update({"modelProviderId": asset["id"]} if resource == "model-providers"
                        else {"toolAssetRefs": [{"assetId": asset["id"]}]})
        session.add(AgentVersionRecord(workspace_id=workspace_id, agent_id=agent_id, version="v1", snapshot=snapshot))
        session.commit()
    response = client.get(f"{path}/{asset['id']}/impact")
    assert response.status_code == 409
    assert "private-name" not in response.text


@pytest.mark.parametrize("resource", ["model-providers", "asset-library"])
@pytest.mark.parametrize("snapshot", [[], None, "synthetic-private-snapshot"])
def test_impact_rejects_nonobject_snapshot_with_fixed_error(asset_client, resource, snapshot):
    client, workspace_id = asset_client
    path = workspace_url(workspace_id, f"/{resource}")
    payload = ({"name": "provider", "baseUrl": "https://example.test", "defaultModel": "test", "secretRef": "MODEL_KEY"}
               if resource == "model-providers" else {"assetType": "tool", "name": "tool"})
    asset = client.post(path, headers=csrf_headers(client), json=payload).json()
    with client.app.state.session_factory() as session:
        session.add(AgentVersionRecord(workspace_id=workspace_id, agent_id="missing-agent", version="v1", snapshot=snapshot))
        session.commit()
    response = client.get(f"{path}/{asset['id']}/impact")
    assert response.status_code == 409
    assert response.json() == {"detail": "存在不符合当前安全规则的历史资产或记录，需先完成治理"}


def test_create_rejects_inline_config_without_persisting(asset_client):
    client, workspace_id = asset_client
    response = client.post(workspace_url(workspace_id, "/asset-library"), headers=csrf_headers(client),
                           json={"assetType": "tool", "name": "unsafe", "adapterConfig": {"token": "synthetic-marker"}})
    assert response.status_code == 422
    assert "synthetic-marker" not in response.text
    assert client.get(workspace_url(workspace_id, "/asset-library")).json() == []


def test_type_only_patch_validates_final_config_and_rolls_back(asset_client):
    client, workspace_id = asset_client
    path = workspace_url(workspace_id, "/asset-library")
    created = client.post(path, headers=csrf_headers(client), json={
        "assetType": "tool", "name": "safe", "adapterType": "http",
        "adapterConfig": {"url": "https://example.test/tool"},
    })
    assert created.status_code == 201
    asset = created.json()
    response = client.patch(f"{path}/{asset['id']}", headers=csrf_headers(client),
                            json={"name": "changed", "adapterType": "manual"})
    assert response.status_code == 422
    assert client.get(path).json()[0] == asset


def test_legacy_unsafe_configuration_is_not_echoed_or_modified(asset_client):
    client, workspace_id = asset_client
    path = workspace_url(workspace_id, "/asset-library")
    created = client.post(path, headers=csrf_headers(client), json={"assetType": "tool", "name": "legacy"}).json()
    with client.app.state.session_factory() as session:
        asset = session.get(ToolSkillAssetRecord, created["id"])
        asset.adapter_config = {"token": "synthetic-marker"}
        session.commit()
    response = client.get(path)
    assert response.status_code == 409
    assert "synthetic-marker" not in response.text
    with client.app.state.session_factory() as session:
        assert session.scalar(select(ToolSkillAssetRecord)).adapter_config == {"token": "synthetic-marker"}


@pytest.mark.parametrize("suffix,body", [
    ("/asset-library", {"assetType": "tool", "name": "bad", "adapterConfig": "synthetic-marker"}),
    ("/model-providers", {"name": "bad", "baseUrl": {"token": "synthetic-marker"}}),
])
def test_schema_errors_do_not_echo_asset_input(asset_client, suffix, body):
    client, workspace_id = asset_client
    response = client.post(workspace_url(workspace_id, suffix), headers=csrf_headers(client), json=body)
    assert response.status_code == 422
    assert "synthetic-marker" not in response.text


def test_provider_url_and_null_patch_are_rejected_without_changes(asset_client):
    client, workspace_id = asset_client
    path = workspace_url(workspace_id, "/model-providers")
    body = {"name": "safe", "baseUrl": "https://example.test/v1", "defaultModel": "synthetic", "secretRef": "MODEL_KEY"}
    unsafe = client.post(path, headers=csrf_headers(client), json={**body, "baseUrl": "https://example.test?token=synthetic-marker"})
    assert unsafe.status_code == 422
    assert "synthetic-marker" not in unsafe.text
    created = client.post(path, headers=csrf_headers(client), json=body)
    assert created.status_code == 201
    provider = created.json()
    response = client.patch(f"{path}/{provider['id']}", headers=csrf_headers(client), json={"baseUrl": None})
    assert response.status_code == 422
    assert client.get(path).json() == [provider]


@pytest.mark.parametrize("resource", ["asset-library", "model-providers"])
def test_unsafe_history_cannot_leak_through_deactivation(asset_client, resource):
    client, workspace_id = asset_client
    path = workspace_url(workspace_id, f"/{resource}")
    body = {"assetType": "tool", "name": "legacy"} if resource == "asset-library" else {
        "name": "legacy", "baseUrl": "https://example.test", "secretRef": "MODEL_KEY", "defaultModel": "test",
    }
    created = client.post(path, headers=csrf_headers(client), json=body).json()
    record_type = ToolSkillAssetRecord if resource == "asset-library" else ModelProviderRecord
    with client.app.state.session_factory() as session:
        row = session.get(record_type, created["id"])
        if resource == "asset-library":
            row.adapter_config = {"token": "synthetic-marker"}
        else:
            row.base_url = "https://example.test?token=synthetic-marker"
        session.commit()
    for response in [client.get(path), client.post(f"{path}/{created['id']}/deactivate", headers=csrf_headers(client))]:
        assert response.status_code == 409
        assert "synthetic-marker" not in response.text
    with client.app.state.session_factory() as session:
        assert session.get(record_type, created["id"]).status == created["status"]


def test_invocation_summaries_are_hidden_in_list_and_audit_without_changing_storage(asset_client):
    client, workspace_id = asset_client
    path = workspace_url(workspace_id, "/asset-library")
    asset = client.post(path, headers=csrf_headers(client), json={"assetType": "tool", "name": "safe"}).json()
    with client.app.state.session_factory() as session:
        record = ToolSkillAssetInvocationRecord(workspace_id=workspace_id, asset_id=asset["id"],
            asset_type="tool", asset_name="synthetic-marker", agent_version="synthetic-marker",
            status="failed", input_summary="synthetic-marker", output_summary="synthetic-marker",
            error="synthetic-marker", duration_ms=12)
        session.add(record)
        session.commit()
        record_id = record.id
    listed = client.get(f"{path}/invocations")
    audited = client.get(f"{path}/{asset['id']}/audit-events")
    for response in [listed, audited]:
        assert response.status_code == 200
        assert "synthetic-marker" not in response.text
    assert listed.json()[0]["status"] == "failed"
    assert listed.json()[0]["inputSummary"] == "内容已隐藏（迁移安全策略）"
    assert any(event["id"] == record_id for event in audited.json())
    with client.app.state.session_factory() as session:
        assert session.get(ToolSkillAssetInvocationRecord, record_id).input_summary == "synthetic-marker"


def test_audit_metadata_and_reason_are_not_arbitrary_text_outputs(asset_client):
    client, workspace_id = asset_client
    path = workspace_url(workspace_id, "/asset-library")
    asset = client.post(path, headers=csrf_headers(client), json={"assetType": "tool", "name": "safe"}).json()
    with client.app.state.session_factory() as session:
        event = session.scalar(select(AuditEventRecord).where(AuditEventRecord.target_id == asset["id"]))
        event.event_metadata = {"token": "synthetic-marker", "reason": "synthetic-marker"}
        event.reason = "synthetic-marker"
        session.commit()
        event_id = event.id
    response = client.get(f"{path}/{asset['id']}/audit-events")
    assert response.status_code == 200
    assert "synthetic-marker" not in response.text
    assert response.json()[0]["metadata"] == {}
    assert response.json()[0]["reason"] == "内容已隐藏（迁移安全策略）"
    with client.app.state.session_factory() as session:
        assert session.get(AuditEventRecord, event_id).event_metadata["token"] == "synthetic-marker"


@pytest.mark.parametrize("field,value", [
    ("outcome", "synthetic-private-state"),
    ("target_type", "synthetic-private-type"),
    ("target_id", "synthetic-missing-target"),
    ("event_metadata", []),
    ("event_metadata", False),
    ("event_metadata", 0),
])
def test_provider_audit_rejects_invalid_envelope_without_mutation(asset_client, field, value):
    client, workspace_id = asset_client
    path = workspace_url(workspace_id, "/model-providers")
    provider = client.post(path, headers=csrf_headers(client), json={
        "name": "safe", "baseUrl": "https://example.test", "defaultModel": "test", "secretRef": "MODEL_KEY",
    }).json()
    with client.app.state.session_factory() as session:
        event = session.scalar(select(AuditEventRecord).where(AuditEventRecord.target_id == provider["id"]))
        # Keep the event in the existing relevance window even when its target is corrupt.
        event.event_metadata = {"sourceProviderId": provider["id"]}
        setattr(event, field, value)
        session.commit()
        event_id = event.id
    response = client.get(f"{path}/{provider['id']}/audit-events")
    assert response.status_code == 409
    assert response.json() == {"detail": "存在不符合当前安全规则的历史资产或记录，需先完成治理"}
    with client.app.state.session_factory() as session:
        assert getattr(session.get(AuditEventRecord, event_id), field) == value


def test_audit_rejects_provider_migration_reference_from_another_workspace(asset_client):
    client, workspace_id = asset_client
    path = workspace_url(workspace_id, "/model-providers")
    provider = client.post(path, headers=csrf_headers(client), json={
        "name": "safe", "baseUrl": "https://example.test", "defaultModel": "test", "secretRef": "MODEL_KEY",
    }).json()
    with client.app.state.session_factory() as session:
        workspace = session.get(WorkspaceRecord, workspace_id)
        other = WorkspaceRecord(organization_id=workspace.organization_id, name="other", slug="other")
        session.add(other)
        session.flush()
        target = ModelProviderRecord(workspace_id=other.id, name="private", provider_type="openai-compatible",
            base_url="https://example.test", default_model="test", secret_ref="MODEL_KEY", created_by=provider["createdBy"])
        session.add(target)
        session.flush()
        event = session.scalar(select(AuditEventRecord).where(AuditEventRecord.target_id == provider["id"]))
        event.action = "model_provider.migrate_drafts"
        event.event_metadata = {"sourceProviderId": provider["id"], "targetProviderId": target.id,
                                "migratedAgentIds": [], "reason": "synthetic-marker"}
        private_id = target.id
        session.commit()
    response = client.get(f"{path}/{provider['id']}/audit-events")
    assert response.status_code == 409
    assert private_id not in response.text
    assert "synthetic-marker" not in response.text


def test_invocation_with_missing_asset_reference_is_not_returned(asset_client):
    client, workspace_id = asset_client
    with client.app.state.session_factory() as session:
        session.add(ToolSkillAssetInvocationRecord(workspace_id=workspace_id, asset_id="unknown-private-id",
            asset_type="tool", asset_name="legacy", status="failed", duration_ms=0))
        session.commit()
    response = client.get(workspace_url(workspace_id, "/asset-library/invocations"))
    assert response.status_code == 409
    assert "unknown-private-id" not in response.text


def test_provider_impact_does_not_echo_legacy_inline_secret_reference(asset_client):
    client, workspace_id = asset_client
    path = workspace_url(workspace_id, "/model-providers")
    provider = client.post(path, headers=csrf_headers(client), json={
        "name": "safe", "baseUrl": "https://example.test", "defaultModel": "test", "secretRef": "MODEL_KEY",
    }).json()
    with client.app.state.session_factory() as session:
        session.add(AgentVersionRecord(workspace_id=workspace_id, agent_id="synthetic-agent", version="v1.0.0",
            snapshot={"modelProviderId": provider["id"], "modelSecretRef": "synthetic-marker"}))
        session.commit()
    response = client.get(f"{path}/{provider['id']}/impact")
    assert response.status_code == 409
    assert "synthetic-marker" not in response.text
