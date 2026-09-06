import pytest
from fastapi import HTTPException
from app.agent_registration_policy import require_agent_references
from sqlalchemy import select

from api_test_support import create_authenticated_client, csrf_headers, workspace_url
from app.models import AgentRecord, AgentVersionRecord, AuditEventRecord, ModelProviderRecord, ToolSkillAssetRecord


@pytest.mark.parametrize("field", ["assetName", "status", "adapterType"])
@pytest.mark.parametrize("missing", [False, True])
def test_historical_reference_required_strings_fail_closed(agent_client, field, missing):
    client, workspace_id, agent = agent_client
    ref = {"assetId": "typed-tool", "assetType": "tool", "assetName": "Synthetic",
           "status": "active", "adapterType": "manual"}
    if missing:
        ref.pop(field)
    else:
        ref[field] = {"synthetic": "private"}
    with client.app.state.session_factory() as session:
        session.add(ToolSkillAssetRecord(id="typed-tool", workspace_id=workspace_id,
            asset_type="tool", name="Synthetic", created_by="synthetic"))
        session.commit()
        with pytest.raises(HTTPException) as error:
            require_agent_references(session, workspace_id, {"toolAssetRefs": [ref]})
        assert error.value.status_code == 409
        assert error.value.detail == "存在不符合当前安全规则的历史 Agent 或版本，需先完成治理"
        session.get(AgentRecord, agent["id"]).tool_asset_refs = [ref]
        session.commit()
    response = client.get(workspace_url(workspace_id, f"/agents/{agent['id']}"))
    assert response.status_code == 409
    assert "private" not in response.text


@pytest.fixture
def agent_client(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'agent-security.db'}")
    with client:
        path = workspace_url(workspace_id, "/agents")
        created = client.post(path, headers=csrf_headers(client), json={
            "name": "Synthetic", "role": "Test", "owner": "Test", "model": "test",
        })
        assert created.status_code == 201
        yield client, workspace_id, created.json()


@pytest.mark.parametrize("provider_id", ["", "   "])
def test_create_rejects_blank_provider_binding_without_persisting(agent_client, provider_id):
    client, workspace_id, agent = agent_client
    path = workspace_url(workspace_id, "/agents")
    response = client.post(path, headers=csrf_headers(client), json={
        "name": "Invalid binding", "role": "Test", "owner": "Test", "model": "test", "modelProviderId": provider_id,
    })
    assert response.status_code == 422
    assert response.json() == {"detail": "Agent 请求字段不符合要求"}
    assert client.get(path).json() == [agent]


def test_publish_rejects_existing_candidate_version_without_writes(agent_client):
    client, workspace_id, agent = agent_client
    path = workspace_url(workspace_id, f"/agents/{agent['id']}")
    published = client.post(f"{path}/publish", headers=csrf_headers(client))
    assert published.status_code == 201
    with client.app.state.session_factory() as session:
        session.get(AgentVersionRecord, published.json()["id"]).version = "v1.1.0"
        session.commit()
        audit_ids = list(session.scalars(select(AuditEventRecord.id)))
    before = client.get(path).json()
    versions = client.get(f"{path}/versions").json()
    response = client.post(f"{path}/publish", headers=csrf_headers(client))
    assert response.status_code == 409
    assert response.json() == {"detail": "Agent 版本号冲突，需先完成治理"}
    assert client.get(path).json() == before
    assert client.get(f"{path}/versions").json() == versions
    with client.app.state.session_factory() as session:
        assert list(session.scalars(select(AuditEventRecord.id))) == audit_ids


@pytest.mark.parametrize("field", ["name", "role", "owner", "model", "modelProvider", "modelBaseUrl",
                                  "temperature", "maxOutputTokens", "systemPrompt", "tools", "skills", "runtimeManifest"])
def test_nonnullable_agent_patch_is_fixed_422_and_does_not_write(agent_client, field):
    client, workspace_id, agent = agent_client
    path = workspace_url(workspace_id, f"/agents/{agent['id']}")
    response = client.patch(path, headers=csrf_headers(client), json={field: None})
    assert response.status_code == 422
    assert response.json() == {"detail": "Agent 请求字段不符合要求"}
    assert client.get(path).json() == agent


def test_provider_null_detaches_but_preserves_copied_config(agent_client):
    client, workspace_id, agent = agent_client
    provider = client.post(workspace_url(workspace_id, "/model-providers"), headers=csrf_headers(client), json={
        "name": "Synthetic Provider", "baseUrl": "https://models.example.invalid/v1",
        "defaultModel": "bound-model", "secretRef": "SYNTHETIC_KEY",
    })
    assert provider.status_code == 201
    path = workspace_url(workspace_id, f"/agents/{agent['id']}")
    bound = client.patch(path, headers=csrf_headers(client), json={"modelProviderId": provider.json()["id"]})
    assert bound.status_code == 200
    omitted = client.patch(path, headers=csrf_headers(client), json={"name": "Renamed"})
    assert omitted.json()["modelProviderId"] == provider.json()["id"]
    detached = client.patch(path, headers=csrf_headers(client), json={"modelProviderId": None})
    assert detached.status_code == 200
    assert detached.json()["modelProviderId"] is None
    for field in ["modelProvider", "modelBaseUrl", "model"]:
        assert detached.json()[field] == bound.json()[field]


def test_agent_validation_does_not_echo_input(agent_client):
    client, workspace_id, agent = agent_client
    response = client.patch(workspace_url(workspace_id, f"/agents/{agent['id']}"), headers=csrf_headers(client),
                            json={"temperature": "synthetic-private-marker"})
    assert response.status_code == 422
    assert response.json() == {"detail": "Agent 请求字段不符合要求"}
    assert "synthetic-private-marker" not in response.text


@pytest.mark.parametrize("url", ["https://2130706433/run", "https://agent.example.invalid/run?",
                                "https://agent.example.invalid/run#", "https://user:synthetic-private@agent.example.invalid/run"])
@pytest.mark.parametrize("remote", [False, True])
def test_agent_registration_rejects_unsafe_url_structure(agent_client, url, remote):
    client, workspace_id, agent = agent_client
    body = {"runtimeManifest": {"runtime": "remote_http", "sourceType": "remote_api",
        "protocolVersion": "arc-agent-v1", "endpointUrl": url, "secretRef": "SYNTHETIC_KEY", "timeoutSeconds": 30}}
    if not remote:
        body = {"modelBaseUrl": url}
    path = workspace_url(workspace_id, f"/agents/{agent['id']}")
    response = client.patch(path, headers=csrf_headers(client), json=body)
    assert response.status_code == 422
    assert response.json() == {"detail": "Agent 请求字段不符合要求"}
    assert client.get(path).json() == agent


@pytest.mark.parametrize("version", [False, True])
@pytest.mark.parametrize("field,value", [
    ("modelBaseUrl", "https://user:synthetic-private@agent.example.invalid"),
    ("runtimeManifest", {"token": "synthetic-private"}),
])
def test_unsafe_historical_agent_configuration_is_not_returned_or_modified(agent_client, version, field, value):
    client, workspace_id, agent = agent_client
    base = workspace_url(workspace_id, "/agents")
    path = f"{base}/{agent['id']}"
    published = client.post(f"{path}/publish", headers=csrf_headers(client)).json()
    with client.app.state.session_factory() as session:
        if version:
            row = session.get(AgentVersionRecord, published["id"])
            row.snapshot = {**row.snapshot, field: value}
        else:
            row = session.get(AgentRecord, agent["id"])
            setattr(row, "model_base_url" if field == "modelBaseUrl" else "runtime_manifest", value)
        session.commit()
    paths = [f"{path}/versions"] if version else [base, path]
    for target in paths:
        response = client.get(target)
        assert response.status_code == 409
        assert response.json() == {"detail": "存在不符合当前安全规则的历史 Agent 或版本，需先完成治理"}
        assert "synthetic-private" not in response.text
    with client.app.state.session_factory() as session:
        if version:
            assert session.get(AgentVersionRecord, published["id"]).snapshot[field] == value
        else:
            assert getattr(session.get(AgentRecord, agent["id"]),
                           "model_base_url" if field == "modelBaseUrl" else "runtime_manifest") == value


@pytest.mark.parametrize("operation", ["update", "deactivate", "activate", "publish"])
def test_governance_write_cannot_echo_unsafe_history_or_commit_partial_change(agent_client, operation):
    client, workspace_id, agent = agent_client
    with client.app.state.session_factory() as session:
        session.get(AgentRecord, agent["id"]).model_base_url = "https://user:synthetic-private@agent.example.invalid"
        session.commit()
    path = workspace_url(workspace_id, f"/agents/{agent['id']}")
    response = (client.patch(path, headers=csrf_headers(client), json={"name": "Must roll back"})
                if operation == "update" else client.post(f"{path}/{operation}", headers=csrf_headers(client)))
    assert response.status_code == 409
    assert "synthetic-private" not in response.text
    with client.app.state.session_factory() as session:
        stored = session.get(AgentRecord, agent["id"])
        assert stored.name == agent["name"]
        assert stored.status == agent["status"]
        assert stored.version == agent["version"]


def test_explicit_valid_repair_of_old_draft_does_not_require_reading_unsafe_value(agent_client):
    client, workspace_id, agent = agent_client
    with client.app.state.session_factory() as session:
        session.get(AgentRecord, agent["id"]).model_base_url = "https://user:synthetic-private@agent.example.invalid"
        session.commit()
    path = workspace_url(workspace_id, f"/agents/{agent['id']}")
    response = client.patch(path, headers=csrf_headers(client), json={"modelBaseUrl": "https://models.example.invalid/v1"})
    assert response.status_code == 200
    assert response.json()["modelBaseUrl"] == "https://models.example.invalid/v1"


@pytest.mark.parametrize("version", [False, True])
@pytest.mark.parametrize("kind", ["provider", "tool", "skill"])
@pytest.mark.parametrize("invalid", ["missing", "foreign", "disabled"])
def test_historical_references_require_same_workspace(agent_client, version, kind, invalid):
    client, workspace_id, agent = agent_client
    base = workspace_url(workspace_id, "/agents")
    path = f"{base}/{agent['id']}"
    published = client.post(f"{path}/publish", headers=csrf_headers(client)).json()
    reference_id = "synthetic-reference"
    with client.app.state.session_factory() as session:
        if invalid != "missing":
            asset_workspace = "foreign-workspace" if invalid == "foreign" else workspace_id
            if kind == "provider":
                session.add(ModelProviderRecord(id=reference_id, workspace_id=asset_workspace, status="disabled",
                    name="Foreign", provider_type="openai-compatible", base_url="https://models.example.invalid",
                    default_model="test", secret_ref="SYNTHETIC_KEY", created_by="synthetic-user"))
            else:
                session.add(ToolSkillAssetRecord(id=reference_id, workspace_id=asset_workspace, status="disabled",
                    asset_type=kind, name="Foreign", created_by="synthetic-user"))
        field = "modelProviderId" if kind == "provider" else f"{kind}AssetRefs"
        value = reference_id if kind == "provider" else [{"assetId": reference_id,
            "assetType": kind, "assetName": "Synthetic", "status": "active", "adapterType": "manual"}]
        if version:
            row = session.get(AgentVersionRecord, published["id"])
            row.snapshot = {**row.snapshot, field: value}
        else:
            row = session.get(AgentRecord, agent["id"])
            setattr(row, "model_provider_id" if kind == "provider" else f"{kind}_asset_refs", value)
        session.commit()
    for target in ([f"{path}/versions"] if version else [base, path]):
        response = client.get(target)
        if invalid == "disabled":
            assert response.status_code == 200
        else:
            assert response.status_code == 409
            assert response.json() == {"detail": "存在不符合当前安全规则的历史 Agent 或版本，需先完成治理"}
    with client.app.state.session_factory() as session:
        if version:
            assert session.get(AgentVersionRecord, published["id"]).snapshot[field] == value
        else:
            assert getattr(session.get(AgentRecord, agent["id"]),
                           "model_provider_id" if kind == "provider" else f"{kind}_asset_refs") == value


@pytest.mark.parametrize("operation", ["update", "deactivate", "activate", "publish"])
def test_writes_reject_invalid_historical_provider_without_changes(agent_client, operation):
    client, workspace_id, agent = agent_client
    with client.app.state.session_factory() as session:
        audit_ids = set(session.scalars(select(AuditEventRecord.id)))
        version_ids = set(session.scalars(select(AgentVersionRecord.id)))
        session.get(AgentRecord, agent["id"]).model_provider_id = "missing-provider"
        session.commit()
    path = workspace_url(workspace_id, f"/agents/{agent['id']}")
    response = (client.patch(path, headers=csrf_headers(client), json={"name": "Must roll back"})
                if operation == "update" else client.post(f"{path}/{operation}", headers=csrf_headers(client)))
    assert response.status_code == 409
    assert response.json() == {"detail": "存在不符合当前安全规则的历史 Agent 或版本，需先完成治理"}
    with client.app.state.session_factory() as session:
        stored = session.get(AgentRecord, agent["id"])
        assert (stored.name, stored.status, stored.version) == (agent["name"], agent["status"], agent["version"])
        assert stored.model_provider_id == "missing-provider"
        assert set(session.scalars(select(AuditEventRecord.id))) == audit_ids
        assert set(session.scalars(select(AgentVersionRecord.id))) == version_ids
