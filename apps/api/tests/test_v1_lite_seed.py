import pytest
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


def bootstrap_seed_database(
    database_url: str,
    *,
    provider_status: str = "draft",
    provider_secret_ref: str = "DEEPSEEK_API_KEY",
    create_provider: bool = True,
):
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
        if create_provider:
            provider = ModelProviderRecord(
                workspace_id=admin.last_workspace_id,
                name="DeepSeek Pilot Provider",
                provider_type="openai-compatible",
                base_url="https://api.deepseek.com",
                default_model="deepseek-v4-pro",
                secret_ref=provider_secret_ref,
                status=provider_status,
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
        assert AGENT_VERSION == "v1.1.0"
        assert {agent["version"] for agent in result["agents"]} == {AGENT_VERSION}
        assert result["workflow"]["name"] == WORKFLOW_NAME
        assert result["workflow"]["version"] == WORKFLOW_VERSION
        assert WORKFLOW_VERSION == "v1.4.0"
        assert result["rubric"]["name"] == RUBRIC_NAME
        assert result["rubric"]["version"] == RUBRIC_VERSION
        assert RUBRIC_VERSION == "v1.1.0"
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
        rubric = session.scalar(
            select(RubricRecord).where(
                RubricRecord.workspace_id == workspace_id,
                RubricRecord.name == RUBRIC_NAME,
            ),
        )
        assert rubric is not None
        assert rubric.judge_type == "llm"
        assert rubric.judge_model == "deepseek-v4-pro"
        assert rubric.model_provider_id == result["modelProvider"]["id"]
        assert len({dimension["id"] for dimension in rubric.dimensions}) == 5
        assert all(dimension["criteria"].strip() for dimension in rubric.dimensions)

        rubric_version = session.scalar(
            select(RubricVersionRecord).where(
                RubricVersionRecord.workspace_id == workspace_id,
                RubricVersionRecord.rubric_id == rubric.id,
                RubricVersionRecord.version == RUBRIC_VERSION,
            ),
        )
        assert rubric_version is not None
        expected_rubric_ref = {
            "rubricId": rubric.id,
            "versionId": rubric_version.id,
            "version": RUBRIC_VERSION,
            "name": RUBRIC_NAME,
        }
        evaluation_node = next(
            node for node in workflow.nodes if node["type"] == "evaluation"
        )
        assert evaluation_node["data"]["rubricRef"] == expected_rubric_ref

        workflow_version = session.scalar(
            select(WorkflowVersionRecord).where(
                WorkflowVersionRecord.workspace_id == workspace_id,
                WorkflowVersionRecord.workflow_id == workflow.id,
                WorkflowVersionRecord.version == WORKFLOW_VERSION,
            ),
        )
        assert workflow_version is not None
        frozen_evaluation_node = next(
            node
            for node in workflow_version.snapshot["nodes"]
            if node["type"] == "evaluation"
        )
        assert frozen_evaluation_node["data"]["rubricRef"] == expected_rubric_ref
        review_edge = next(
            edge for edge in workflow.edges
            if (
                edge["source"] == "human-business-review"
                and edge["target"] == "agent-revision"
            )
        )
        assert review_edge["data"]["includeReviewContext"] is True
        assert any(
            edge["source"] == "agent-workflow-design"
            and edge["target"] == "human-business-review"
            for edge in workflow.edges
        )

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


@pytest.mark.parametrize(
    ("case", "create_provider", "provider_status", "provider_secret_ref"),
    [
        ("missing", False, "draft", "DEEPSEEK_API_KEY"),
        ("disabled", True, "disabled", "DEEPSEEK_API_KEY"),
        ("incomplete", True, "draft", ""),
    ],
)
def test_v1_lite_seed_requires_available_configured_provider(
    tmp_path,
    case,
    create_provider,
    provider_status,
    provider_secret_ref,
):
    session_factory = bootstrap_seed_database(
        f"sqlite:///{tmp_path / f'v1-lite-provider-{case}.db'}",
        create_provider=create_provider,
        provider_status=provider_status,
        provider_secret_ref=provider_secret_ref,
    )

    with session_factory() as session:
        with pytest.raises(RuntimeError, match="配置完整且未停用的模型 Provider"):
            seed_v1_lite_assets(session, workspace_slug=DEFAULT_WORKSPACE_SLUG)

        assert count_records(session, AgentRecord) == 0
        assert count_records(session, RubricRecord) == 0
        assert count_records(session, WorkflowRecord) == 0


def test_v1_lite_seed_publishes_new_versions_without_rewriting_legacy_snapshots(
    tmp_path,
):
    session_factory = bootstrap_seed_database(
        f"sqlite:///{tmp_path / 'v1-lite-seed-upgrade.db'}",
    )

    with session_factory() as session:
        provider = session.scalar(select(ModelProviderRecord))
        assert provider is not None
        workspace_id = provider.workspace_id
        assert workspace_id is not None
        legacy_agent = AgentRecord(
            workspace_id=workspace_id,
            name="信息抽取与问题建模",
            role="Legacy role",
            owner="Legacy owner",
            model="legacy-model",
            model_provider_id=None,
            model_provider="openai-compatible",
            model_base_url="",
            status="在线",
            version="v1.0.0",
        )
        session.add(legacy_agent)
        session.flush()
        legacy_agent_version = AgentVersionRecord(
            workspace_id=workspace_id,
            agent_id=legacy_agent.id,
            version="v1.0.0",
            snapshot={"marker": "legacy-agent-snapshot"},
        )
        session.add(legacy_agent_version)
        legacy_rubric = RubricRecord(
            workspace_id=workspace_id,
            name=RUBRIC_NAME,
            artifact="Legacy artifact",
            dimensions=[{"name": "Legacy", "weight": 100}],
            gate="Legacy deterministic gate",
            pass_score=80,
            judge_type="deterministic",
            judge_model="",
            version="v1.0.0",
            status="active",
            sort_order=1,
        )
        session.add(legacy_rubric)
        session.flush()
        legacy_rubric_version = RubricVersionRecord(
            workspace_id=workspace_id,
            rubric_id=legacy_rubric.id,
            version="v1.0.0",
            snapshot={"marker": "legacy-rubric-snapshot"},
        )
        legacy_workflow = WorkflowRecord(
            workspace_id=workspace_id,
            name=WORKFLOW_NAME,
            status="已发布",
            version="v1.3.0",
            nodes=[],
            edges=[],
        )
        session.add_all([legacy_rubric_version, legacy_workflow])
        session.flush()
        legacy_workflow_version = WorkflowVersionRecord(
            workspace_id=workspace_id,
            workflow_id=legacy_workflow.id,
            version="v1.3.0",
            snapshot={"marker": "legacy-workflow-snapshot"},
        )
        session.add(legacy_workflow_version)
        session.commit()

        first = seed_v1_lite_assets(session, workspace_slug=DEFAULT_WORKSPACE_SLUG)
        second = seed_v1_lite_assets(session, workspace_slug=DEFAULT_WORKSPACE_SLUG)

        assert second["rubric"]["id"] == first["rubric"]["id"] == legacy_rubric.id
        assert second["workflow"]["id"] == first["workflow"]["id"] == legacy_workflow.id
        assert session.get(AgentVersionRecord, legacy_agent_version.id).snapshot == {
            "marker": "legacy-agent-snapshot",
        }
        assert session.get(RubricVersionRecord, legacy_rubric_version.id).snapshot == {
            "marker": "legacy-rubric-snapshot",
        }
        assert session.get(WorkflowVersionRecord, legacy_workflow_version.id).snapshot == {
            "marker": "legacy-workflow-snapshot",
        }
        assert count_records(
            session,
            RubricVersionRecord,
            RubricVersionRecord.rubric_id == legacy_rubric.id,
        ) == 2
        assert count_records(
            session,
            WorkflowVersionRecord,
            WorkflowVersionRecord.workflow_id == legacy_workflow.id,
        ) == 2

        new_agent_version = session.scalar(
            select(AgentVersionRecord).where(
                AgentVersionRecord.agent_id == legacy_agent.id,
                AgentVersionRecord.version == AGENT_VERSION,
            ),
        )
        assert new_agent_version is not None
        assert new_agent_version.snapshot["modelProviderId"] == provider.id
        assert new_agent_version.snapshot["modelBaseUrl"] == provider.base_url
        assert count_records(
            session,
            AgentVersionRecord,
            AgentVersionRecord.agent_id == legacy_agent.id,
        ) == 2
        new_rubric_version = session.scalar(
            select(RubricVersionRecord).where(
                RubricVersionRecord.rubric_id == legacy_rubric.id,
                RubricVersionRecord.version == RUBRIC_VERSION,
            ),
        )
        new_workflow_version = session.scalar(
            select(WorkflowVersionRecord).where(
                WorkflowVersionRecord.workflow_id == legacy_workflow.id,
                WorkflowVersionRecord.version == WORKFLOW_VERSION,
            ),
        )
        assert new_rubric_version is not None
        assert new_rubric_version.snapshot["judge_type"] == "llm"
        assert new_workflow_version is not None
        frozen_agent_node = next(
            node for node in new_workflow_version.snapshot["nodes"]
            if node["id"] == "agent-problem-model"
        )
        assert frozen_agent_node["data"]["agentVersion"] == AGENT_VERSION
        frozen_evaluation_node = next(
            node
            for node in new_workflow_version.snapshot["nodes"]
            if node["type"] == "evaluation"
        )
        assert frozen_evaluation_node["data"]["rubricRef"]["versionId"] == (
            new_rubric_version.id
        )
