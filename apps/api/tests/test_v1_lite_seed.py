from sqlalchemy import func, select

from api_test_support import ADMIN_EMAIL, ADMIN_PASSWORD, FIXED_NOW
from app.bootstrap import bootstrap_organization_admin
from app.database import create_database
from app.domain import validate_workflow
from app.migrations import DEFAULT_WORKSPACE_SLUG, ensure_current_schema
from app.models import (
    AgentRecord,
    AgentVersionRecord,
    Base,
    ModelProviderRecord,
    NotificationChannelRecord,
    RegressionSampleRecord,
    RegressionSampleSetRecord,
    ReviewerRecord,
    RubricRecord,
    RubricVersionRecord,
    WorkflowRecord,
    WorkflowVersionRecord,
)
from app.security import SecurityService
from app.v1_lite_seed import (
    AGENT_VERSION,
    CHANNEL_NAME,
    REVIEWER_NAME,
    RUBRIC_NAME,
    RUBRIC_VERSION,
    SAMPLE_SET_NAME,
    WORKFLOW_NAME,
    WORKFLOW_VERSION,
    seed_v1_lite_assets,
)


def count_records(session, model, *criteria) -> int:
    statement = select(func.count()).select_from(model)
    if criteria:
        statement = statement.where(*criteria)
    return session.scalar(statement) or 0


def bootstrap_seed_database(database_url: str):
    engine, session_factory = create_database(database_url)
    Base.metadata.create_all(engine)
    ensure_current_schema(engine)
    with session_factory() as session:
        admin = bootstrap_organization_admin(
            session,
            SecurityService(),
            organization_name="ARC.ONE",
            organization_slug="arc-one",
            email=ADMIN_EMAIL,
            display_name="Organization Admin",
            password=ADMIN_PASSWORD,
            clock=lambda: FIXED_NOW,
        )
        provider = ModelProviderRecord(
            workspace_id=admin.last_workspace_id,
            name="DeepSeek Pilot Provider",
            provider_type="openai-compatible",
            base_url="https://api.deepseek.com",
            default_model="deepseek-v4-pro",
            secret_ref="DEEPSEEK_API_KEY",
            status="active",
            created_by=admin.id,
        )
        session.add(provider)
        session.commit()
    return session_factory


def test_v1_lite_seed_creates_published_pilot_assets(tmp_path):
    session_factory = bootstrap_seed_database(f"sqlite:///{tmp_path / 'v1-lite-seed.db'}")

    with session_factory() as session:
        result = seed_v1_lite_assets(session, workspace_slug=DEFAULT_WORKSPACE_SLUG)
        workspace_id = result["workspace"]["id"]

        assert result["workspace"]["slug"] == DEFAULT_WORKSPACE_SLUG
        assert result["modelProvider"]["model"] == "deepseek-v4-pro"
        assert result["reviewer"]["name"] == REVIEWER_NAME
        assert len(result["agents"]) == 4
        assert {agent["version"] for agent in result["agents"]} == {AGENT_VERSION}
        assert result["workflow"]["name"] == WORKFLOW_NAME
        assert result["workflow"]["version"] == WORKFLOW_VERSION
        assert result["rubric"]["name"] == RUBRIC_NAME
        assert result["rubric"]["version"] == RUBRIC_VERSION
        assert result["sampleSet"]["name"] == SAMPLE_SET_NAME
        assert result["sampleSet"]["activeSamples"] == 3
        assert result["notificationChannel"]["name"] == CHANNEL_NAME

        workflow = session.scalar(
            select(WorkflowRecord).where(
                WorkflowRecord.workspace_id == workspace_id,
                WorkflowRecord.name == WORKFLOW_NAME,
            ),
        )
        assert workflow is not None
        assert workflow.status == "已发布"
        assert workflow.version == WORKFLOW_VERSION
        assert [node["type"] for node in workflow.nodes] == [
            "trigger",
            "agent",
            "agent",
            "agent",
            "human",
            "agent",
            "evaluation",
            "end",
        ]
        assert validate_workflow(workflow.nodes, workflow.edges, session, workspace_id) == []

        assert count_records(session, AgentRecord, AgentRecord.workspace_id == workspace_id) == 4
        assert count_records(session, AgentVersionRecord, AgentVersionRecord.workspace_id == workspace_id) == 4
        assert count_records(session, WorkflowVersionRecord, WorkflowVersionRecord.workspace_id == workspace_id) == 1
        assert count_records(session, RubricRecord, RubricRecord.workspace_id == workspace_id) == 1
        assert count_records(session, RubricVersionRecord, RubricVersionRecord.workspace_id == workspace_id) == 1
        assert count_records(session, RegressionSampleSetRecord, RegressionSampleSetRecord.workspace_id == workspace_id) == 1
        assert count_records(session, RegressionSampleRecord, RegressionSampleRecord.workspace_id == workspace_id) == 3
        assert count_records(session, NotificationChannelRecord, NotificationChannelRecord.workspace_id == workspace_id) == 1

        reviewer = session.scalar(
            select(ReviewerRecord).where(
                ReviewerRecord.workspace_id == workspace_id,
                ReviewerRecord.name == REVIEWER_NAME,
            ),
        )
        assert reviewer is not None
        assert reviewer.user_id == result["admin"]["id"]
        assert reviewer.is_active is True


def test_v1_lite_seed_is_idempotent(tmp_path):
    session_factory = bootstrap_seed_database(f"sqlite:///{tmp_path / 'v1-lite-idempotent.db'}")

    with session_factory() as session:
        first = seed_v1_lite_assets(session, workspace_slug=DEFAULT_WORKSPACE_SLUG)
        second = seed_v1_lite_assets(session, workspace_slug=DEFAULT_WORKSPACE_SLUG)
        workspace_id = second["workspace"]["id"]

        assert second["workflow"]["id"] == first["workflow"]["id"]
        assert second["rubric"]["id"] == first["rubric"]["id"]
        assert second["sampleSet"]["id"] == first["sampleSet"]["id"]
        assert [agent["id"] for agent in second["agents"]] == [
            agent["id"] for agent in first["agents"]
        ]
        assert count_records(session, AgentRecord, AgentRecord.workspace_id == workspace_id) == 4
        assert count_records(session, AgentVersionRecord, AgentVersionRecord.workspace_id == workspace_id) == 4
        assert count_records(session, WorkflowVersionRecord, WorkflowVersionRecord.workspace_id == workspace_id) == 1
        assert count_records(session, RubricVersionRecord, RubricVersionRecord.workspace_id == workspace_id) == 1
        assert count_records(session, RegressionSampleRecord, RegressionSampleRecord.workspace_id == workspace_id) == 3
        assert count_records(session, NotificationChannelRecord, NotificationChannelRecord.workspace_id == workspace_id) == 1
