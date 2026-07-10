from app.database import create_database
from app.models import AgentVersionRecord, Base, ModelProviderRecord
from app.runtime_security import purge_invalid_model_secret_refs


def test_purge_invalid_model_secret_refs_clears_legacy_values_and_is_idempotent(tmp_path):
    engine, session_factory = create_database(
        f"sqlite:///{tmp_path / 'runtime-security.db'}",
    )
    Base.metadata.create_all(engine)

    with session_factory() as session:
        session.add_all([
            ModelProviderRecord(
                id="provider-invalid",
                workspace_id="workspace-1",
                name="Legacy Inline Provider",
                provider_type="openai-compatible",
                base_url="https://api.deepseek.com",
                default_model="deepseek-v4-pro",
                secret_ref="inline-secret-value",
                created_by="user-1",
            ),
            ModelProviderRecord(
                id="provider-valid",
                workspace_id="workspace-1",
                name="Environment Provider",
                provider_type="openai-compatible",
                base_url="https://api.deepseek.com",
                default_model="deepseek-v4-pro",
                secret_ref="DEEPSEEK_API_KEY",
                created_by="user-1",
            ),
            AgentVersionRecord(
                id="version-invalid",
                workspace_id="workspace-1",
                agent_id="agent-invalid",
                version="v1.0.0",
                snapshot={"modelSecretRef": "inline-secret-value"},
            ),
            AgentVersionRecord(
                id="version-valid",
                workspace_id="workspace-1",
                agent_id="agent-valid",
                version="v1.0.0",
                snapshot={"modelSecretRef": "DEEPSEEK_API_KEY"},
            ),
        ])
        session.commit()

        assert purge_invalid_model_secret_refs(session) == 2
        session.commit()
        assert session.get(ModelProviderRecord, "provider-invalid").secret_ref == ""
        assert session.get(ModelProviderRecord, "provider-valid").secret_ref == "DEEPSEEK_API_KEY"
        assert session.get(AgentVersionRecord, "version-invalid").snapshot["modelSecretRef"] == ""
        assert (
            session.get(AgentVersionRecord, "version-valid").snapshot["modelSecretRef"]
            == "DEEPSEEK_API_KEY"
        )
        assert purge_invalid_model_secret_refs(session) == 0


def test_create_app_purges_invalid_model_secret_refs_before_serving_requests(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'runtime-security-startup.db'}"
    engine, session_factory = create_database(database_url)
    Base.metadata.create_all(engine)
    with session_factory() as session:
        session.add(ModelProviderRecord(
            id="provider-invalid-on-startup",
            workspace_id="workspace-1",
            name="Legacy Startup Provider",
            provider_type="openai-compatible",
            base_url="https://api.deepseek.com",
            default_model="deepseek-v4-pro",
            secret_ref="inline-secret-value",
            created_by="user-1",
        ))
        session.commit()

    from app.main import create_app

    app = create_app(database_url=database_url)
    with app.state.session_factory() as session:
        assert session.get(
            ModelProviderRecord,
            "provider-invalid-on-startup",
        ).secret_ref == ""
