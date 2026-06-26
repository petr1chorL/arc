from sqlalchemy import create_engine, func, inspect, select, text
from sqlalchemy.orm import Session

from app.bootstrap import (
    DEFAULT_ORGANIZATION_NAME,
    DEFAULT_ORGANIZATION_SLUG,
    DEFAULT_WORKSPACE_NAME,
    DEFAULT_WORKSPACE_SLUG,
    bootstrap_default_workspace,
)
from app.migrations import ensure_current_schema
from app.models import (
    AgentRecord,
    AgentVersionRecord,
    AuditEventRecord,
    Base,
    GoldenSampleRecord,
    OrganizationRecord,
    ReviewDecisionRecord,
    ReviewerRecord,
    UserRecord,
    WorkspaceMembershipRecord,
    WorkspaceRecord,
)


LEGACY_TABLES = [
    """
    CREATE TABLE agents (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        role VARCHAR(240) NOT NULL,
        owner VARCHAR(80) NOT NULL,
        model VARCHAR(80) NOT NULL,
        status VARCHAR(20) NOT NULL,
        version VARCHAR(20) NOT NULL,
        pass_rate FLOAT NOT NULL,
        runs INTEGER NOT NULL,
        tools JSON NOT NULL,
        skills TEXT NOT NULL DEFAULT '[]',
        system_prompt TEXT NOT NULL DEFAULT '',
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL
    )
    """,
    """
    CREATE TABLE agent_versions (
        id VARCHAR(36) PRIMARY KEY,
        agent_id VARCHAR(36) NOT NULL,
        version VARCHAR(20) NOT NULL,
        snapshot JSON NOT NULL,
        created_at DATETIME NOT NULL
    )
    """,
    """
    CREATE TABLE workflows (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        status VARCHAR(20) NOT NULL,
        version VARCHAR(20) NOT NULL,
        nodes JSON NOT NULL,
        edges JSON NOT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL
    )
    """,
    """
    CREATE TABLE workflow_versions (
        id VARCHAR(36) PRIMARY KEY,
        workflow_id VARCHAR(36) NOT NULL,
        version VARCHAR(20) NOT NULL,
        snapshot JSON NOT NULL,
        created_at DATETIME NOT NULL
    )
    """,
    """
    CREATE TABLE workflow_runs (
        id VARCHAR(36) PRIMARY KEY,
        kind VARCHAR(20) NOT NULL,
        name VARCHAR(160) NOT NULL,
        workflow_id VARCHAR(36),
        workflow_version VARCHAR(20),
        agent_id VARCHAR(36),
        agent_version VARCHAR(20),
        status VARCHAR(20) NOT NULL,
        input_text TEXT NOT NULL,
        output_text TEXT NOT NULL,
        score INTEGER,
        model VARCHAR(120) NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        cost_usd FLOAT NOT NULL,
        duration_ms INTEGER NOT NULL,
        current_node VARCHAR(160) NOT NULL,
        error TEXT NOT NULL,
        started_at DATETIME NOT NULL,
        completed_at DATETIME
    )
    """,
    """
    CREATE TABLE node_runs (
        id VARCHAR(36) PRIMARY KEY,
        run_id VARCHAR(36) NOT NULL,
        node_id VARCHAR(120) NOT NULL,
        node_type VARCHAR(40) NOT NULL,
        node_name VARCHAR(160) NOT NULL,
        agent_id VARCHAR(36),
        agent_version VARCHAR(20),
        status VARCHAR(20) NOT NULL,
        input_text TEXT NOT NULL,
        output_text TEXT NOT NULL,
        model VARCHAR(120) NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        cost_usd FLOAT NOT NULL,
        duration_ms INTEGER NOT NULL,
        attempts INTEGER NOT NULL,
        score INTEGER,
        error TEXT NOT NULL,
        started_at DATETIME NOT NULL,
        completed_at DATETIME
    )
    """,
    """
    CREATE TABLE artifacts (
        id VARCHAR(36) PRIMARY KEY,
        run_id VARCHAR(36) NOT NULL,
        source_node_run_id VARCHAR(36) NOT NULL,
        artifact_type VARCHAR(80) NOT NULL,
        content TEXT NOT NULL,
        score INTEGER,
        created_at DATETIME NOT NULL
    )
    """,
    """
    CREATE TABLE artifact_versions (
        id VARCHAR(36) PRIMARY KEY,
        artifact_id VARCHAR(36) NOT NULL,
        version INTEGER NOT NULL,
        parent_version_id VARCHAR(36),
        content TEXT NOT NULL,
        created_by VARCHAR(80) NOT NULL,
        created_at DATETIME NOT NULL
    )
    """,
    """
    CREATE TABLE artifact_diffs (
        id VARCHAR(36) PRIMARY KEY,
        human_task_id VARCHAR(36) NOT NULL,
        from_version_id VARCHAR(36) NOT NULL,
        to_version_id VARCHAR(36) NOT NULL,
        old_content TEXT NOT NULL,
        new_content TEXT NOT NULL,
        unified_diff TEXT NOT NULL,
        created_at DATETIME NOT NULL
    )
    """,
    """
    CREATE TABLE reviewers (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        role VARCHAR(80) NOT NULL,
        is_expert BOOLEAN NOT NULL,
        is_active BOOLEAN NOT NULL,
        created_at DATETIME NOT NULL
    )
    """,
    """
    CREATE TABLE review_groups (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        assignment_mode VARCHAR(32) NOT NULL,
        rotation_cursor INTEGER NOT NULL,
        is_escalation_group BOOLEAN NOT NULL,
        created_at DATETIME NOT NULL
    )
    """,
    """
    CREATE TABLE review_group_members (
        id VARCHAR(36) PRIMARY KEY,
        group_id VARCHAR(36) NOT NULL,
        reviewer_id VARCHAR(36) NOT NULL,
        role VARCHAR(80) NOT NULL
    )
    """,
    """
    CREATE TABLE human_tasks (
        id VARCHAR(36) PRIMARY KEY,
        workflow_run_id VARCHAR(36) NOT NULL,
        node_run_id VARCHAR(36) NOT NULL,
        human_node_id VARCHAR(120) NOT NULL,
        source_node_id VARCHAR(120) NOT NULL,
        artifact_version_id VARCHAR(36) NOT NULL,
        title VARCHAR(200) NOT NULL,
        status VARCHAR(32) NOT NULL,
        assignment_type VARCHAR(32) NOT NULL,
        review_policy VARCHAR(32) NOT NULL,
        required_approvals INTEGER NOT NULL,
        participant_snapshot JSON NOT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL
    )
    """,
    """
    CREATE TABLE review_decisions (
        id VARCHAR(36) PRIMARY KEY,
        human_task_id VARCHAR(36) NOT NULL,
        reviewer_id VARCHAR(36) NOT NULL,
        decision VARCHAR(32) NOT NULL,
        reason TEXT NOT NULL,
        artifact_version_id VARCHAR(36) NOT NULL,
        idempotency_key VARCHAR(160) NOT NULL,
        created_at DATETIME NOT NULL
    )
    """,
    """
    CREATE TABLE resume_requests (
        id VARCHAR(36) PRIMARY KEY,
        human_task_id VARCHAR(36) NOT NULL,
        decision_id VARCHAR(36) NOT NULL,
        action VARCHAR(32) NOT NULL,
        status VARCHAR(32) NOT NULL,
        error TEXT NOT NULL,
        created_at DATETIME NOT NULL,
        completed_at DATETIME
    )
    """,
    """
    CREATE TABLE audit_events (
        id VARCHAR(36) PRIMARY KEY,
        human_task_id VARCHAR(36),
        event_type VARCHAR(64) NOT NULL,
        actor_id VARCHAR(80) NOT NULL,
        reason TEXT NOT NULL,
        before_status VARCHAR(32) NOT NULL,
        after_status VARCHAR(32) NOT NULL,
        payload JSON NOT NULL,
        created_at DATETIME NOT NULL
    )
    """,
    """
    CREATE TABLE notification_outbox (
        id VARCHAR(36) PRIMARY KEY,
        event_key VARCHAR(160) NOT NULL,
        human_task_id VARCHAR(36) NOT NULL,
        event_type VARCHAR(64) NOT NULL,
        recipient_type VARCHAR(32) NOT NULL,
        recipient_id VARCHAR(80) NOT NULL,
        payload JSON NOT NULL,
        status VARCHAR(32) NOT NULL,
        created_at DATETIME NOT NULL
    )
    """,
    """
    CREATE TABLE feedback_candidates (
        id VARCHAR(36) PRIMARY KEY,
        human_task_id VARCHAR(36) NOT NULL,
        decision_id VARCHAR(36) NOT NULL,
        original_version_id VARCHAR(36) NOT NULL,
        modified_version_id VARCHAR(36) NOT NULL,
        diff_id VARCHAR(36) NOT NULL,
        reason TEXT NOT NULL,
        tags JSON NOT NULL,
        workflow_run_id VARCHAR(36) NOT NULL,
        workflow_id VARCHAR(36),
        agent_id VARCHAR(36),
        source_node_id VARCHAR(120) NOT NULL,
        created_by VARCHAR(36) NOT NULL,
        status VARCHAR(32) NOT NULL,
        created_at DATETIME NOT NULL,
        confirmed_at DATETIME
    )
    """,
    """
    CREATE TABLE golden_samples (
        id VARCHAR(36) PRIMARY KEY,
        candidate_id VARCHAR(36) NOT NULL,
        input_text TEXT NOT NULL,
        expected_output TEXT NOT NULL,
        reviewer_id VARCHAR(36) NOT NULL,
        reason TEXT NOT NULL,
        idempotency_key VARCHAR(160) NOT NULL,
        created_at DATETIME NOT NULL
    )
    """,
    """
    CREATE TABLE human_reviews (
        id VARCHAR(36) PRIMARY KEY,
        run_id VARCHAR(36) NOT NULL,
        node_run_id VARCHAR(36) NOT NULL,
        title VARCHAR(200) NOT NULL,
        status VARCHAR(20) NOT NULL,
        reason TEXT NOT NULL,
        score INTEGER NOT NULL,
        created_at DATETIME NOT NULL
    )
    """,
]


def create_legacy_schema(engine) -> None:
    with engine.begin() as connection:
        for statement in LEGACY_TABLES:
            connection.execute(text(statement))


def seed_legacy_data(engine) -> None:
    statements = [
        """
        INSERT INTO agents VALUES (
            'agent-1', 'Legacy Agent', 'legacy role', 'owner', 'model',
            '在线', 'v1.0.0', 95, 8, '[]', '[]', '', CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        )
        """,
        """
        INSERT INTO agent_versions VALUES (
            'agent-version-1', 'agent-1', 'v1.0.0', '{}', CURRENT_TIMESTAMP
        )
        """,
        """
        INSERT INTO workflows VALUES (
            'workflow-1', 'Legacy Workflow', '已发布', 'v1.0.0', '[]', '[]',
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        """,
        """
        INSERT INTO workflow_versions VALUES (
            'workflow-version-1', 'workflow-1', 'v1.0.0', '{}',
            CURRENT_TIMESTAMP
        )
        """,
        """
        INSERT INTO workflow_runs VALUES (
            'run-1', 'workflow', 'Legacy Run', 'workflow-1', 'v1.0.0',
            NULL, NULL, '等待人工审核', 'input', 'output', 90, 'model',
            1, 1, 2, 0, 10, 'human-1', '', CURRENT_TIMESTAMP, NULL
        )
        """,
        """
        INSERT INTO node_runs VALUES (
            'node-run-1', 'run-1', 'node-1', 'agent', 'Agent Node',
            'agent-1', 'v1.0.0', '已完成', 'input', 'output', 'model',
            1, 1, 2, 0, 10, 1, 90, '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        """,
        """
        INSERT INTO artifacts VALUES (
            'artifact-1', 'run-1', 'node-run-1', 'text', 'original', 90,
            CURRENT_TIMESTAMP
        )
        """,
        """
        INSERT INTO artifact_versions VALUES (
            'artifact-version-1', 'artifact-1', 1, NULL, 'original', 'system',
            CURRENT_TIMESTAMP
        )
        """,
        """
        INSERT INTO artifact_versions VALUES (
            'artifact-version-2', 'artifact-1', 2, 'artifact-version-1',
            'modified', 'reviewer-1', CURRENT_TIMESTAMP
        )
        """,
        """
        INSERT INTO reviewers VALUES (
            'reviewer-1', 'Legacy Reviewer', '质量专家', 1, 1,
            CURRENT_TIMESTAMP
        )
        """,
        """
        INSERT INTO review_groups VALUES (
            'group-1', 'Legacy Group', 'group_claim', 0, 0, CURRENT_TIMESTAMP
        )
        """,
        """
        INSERT INTO review_group_members VALUES (
            'member-1', 'group-1', 'reviewer-1', '审核人'
        )
        """,
        """
        INSERT INTO human_tasks VALUES (
            'task-1', 'run-1', 'node-run-1', 'human-1', 'node-1',
            'artifact-version-2', 'Legacy Task', '已通过', 'direct',
            'any_one', 1, '["reviewer-1"]', CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        )
        """,
        """
        INSERT INTO review_decisions VALUES (
            'decision-1', 'task-1', 'reviewer-1', 'approve', 'approved',
            'artifact-version-2', 'decision-key', CURRENT_TIMESTAMP
        )
        """,
        """
        INSERT INTO artifact_diffs VALUES (
            'diff-1', 'task-1', 'artifact-version-1', 'artifact-version-2',
            'original', 'modified', '-original\n+modified', CURRENT_TIMESTAMP
        )
        """,
        """
        INSERT INTO resume_requests VALUES (
            'resume-1', 'task-1', 'decision-1', 'continue', 'completed', '',
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        """,
        """
        INSERT INTO audit_events VALUES (
            'audit-1', 'task-1', 'decision_recorded', 'reviewer-1', 'approved',
            '审核中', '已通过', '{}', CURRENT_TIMESTAMP
        )
        """,
        """
        INSERT INTO notification_outbox VALUES (
            'notification-1', 'task-1-reminder', 'task-1', 'due_reminder',
            'reviewer', 'reviewer-1', '{}', 'pending', CURRENT_TIMESTAMP
        )
        """,
        """
        INSERT INTO feedback_candidates VALUES (
            'candidate-1', 'task-1', 'decision-1', 'artifact-version-1',
            'artifact-version-2', 'diff-1', 'useful correction', '[]', 'run-1',
            'workflow-1', 'agent-1', 'node-1', 'reviewer-1', '已确认',
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        """,
        """
        INSERT INTO golden_samples VALUES (
            'golden-1', 'candidate-1', 'input', 'modified', 'reviewer-1',
            'confirmed', 'golden-key', CURRENT_TIMESTAMP
        )
        """,
        """
        INSERT INTO human_reviews VALUES (
            'human-review-1', 'run-1', 'node-run-1', 'Legacy Review',
            '已完成', 'approved', 90, CURRENT_TIMESTAMP
        )
        """,
    ]
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def migrate_twice(engine) -> None:
    Base.metadata.create_all(engine)
    ensure_current_schema(engine)
    with Session(engine) as session:
        bootstrap_default_workspace(session)
        session.commit()
    ensure_current_schema(engine)
    with Session(engine) as session:
        bootstrap_default_workspace(session)
        session.commit()


def test_v06_records_are_migrated_into_one_default_workspace(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy-assets.db'}")
    create_legacy_schema(engine)
    seed_legacy_data(engine)

    migrate_twice(engine)

    with Session(engine) as session:
        organization = session.scalar(select(OrganizationRecord))
        workspace = session.scalar(select(WorkspaceRecord))
        assert organization is not None
        assert organization.name == DEFAULT_ORGANIZATION_NAME
        assert organization.slug == DEFAULT_ORGANIZATION_SLUG
        assert workspace is not None
        assert workspace.name == DEFAULT_WORKSPACE_NAME
        assert workspace.slug == DEFAULT_WORKSPACE_SLUG
        assert session.scalar(
            select(func.count()).select_from(OrganizationRecord),
        ) == 1
        assert session.scalar(
            select(func.count()).select_from(WorkspaceRecord),
        ) == 1

        table_names = [
            "agents",
            "agent_versions",
            "workflows",
            "workflow_versions",
            "workflow_runs",
            "node_runs",
            "artifacts",
            "artifact_versions",
            "artifact_diffs",
            "reviewers",
            "review_groups",
            "review_group_members",
            "human_tasks",
            "review_decisions",
            "resume_requests",
            "audit_events",
            "notification_outbox",
            "feedback_candidates",
            "golden_samples",
            "human_reviews",
        ]
        for table_name in table_names:
            workspace_ids = session.execute(
                text(f"SELECT DISTINCT workspace_id FROM {table_name}"),
            ).scalars().all()
            assert workspace_ids == [workspace.id], table_name

        assert session.get(AgentRecord, "agent-1").name == "Legacy Agent"
        assert session.get(
            AgentVersionRecord,
            "agent-version-1",
        ).agent_id == "agent-1"
        assert session.get(
            ReviewDecisionRecord,
            "decision-1",
        ).reviewer_id == "reviewer-1"
        assert session.get(
            GoldenSampleRecord,
            "golden-1",
        ).reviewer_id == "reviewer-1"


def test_legacy_reviewer_gets_one_pending_user_without_membership(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy-reviewer.db'}")
    create_legacy_schema(engine)
    seed_legacy_data(engine)

    migrate_twice(engine)

    with Session(engine) as session:
        reviewer = session.get(ReviewerRecord, "reviewer-1")
        assert reviewer is not None
        assert reviewer.id == "reviewer-1"
        assert reviewer.user_id is not None
        user = session.get(UserRecord, reviewer.user_id)
        assert user is not None
        assert user.display_name == "Legacy Reviewer"
        assert user.status == "pending_email"
        assert user.email is None
        assert user.normalized_email is None
        assert user.password_hash is None
        assert session.scalar(
            select(func.count()).select_from(UserRecord),
        ) == 1
        assert session.scalar(
            select(func.count()).select_from(WorkspaceMembershipRecord),
        ) == 0
        assert session.get(
            ReviewDecisionRecord,
            "decision-1",
        ).reviewer_id == reviewer.id
        assert session.execute(
            text(
                "SELECT reviewer_id FROM review_group_members "
                "WHERE id = 'member-1'"
            ),
        ).scalar_one() == reviewer.id


def test_existing_workspace_is_preserved_and_children_follow_their_parent(
    tmp_path,
):
    engine = create_engine(f"sqlite:///{tmp_path / 'partial-migration.db'}")
    create_legacy_schema(engine)
    seed_legacy_data(engine)
    migrate_twice(engine)

    with Session(engine) as session:
        organization = session.scalar(select(OrganizationRecord))
        default_workspace = session.scalar(select(WorkspaceRecord))
        assert organization is not None
        assert default_workspace is not None
        other_workspace = WorkspaceRecord(
            organization_id=organization.id,
            name="Other Workspace",
            slug="other-workspace",
            status="active",
        )
        session.add(other_workspace)
        session.flush()
        session.execute(
            text(
                "UPDATE agents SET workspace_id = :workspace_id "
                "WHERE id = 'agent-1'"
            ),
            {"workspace_id": other_workspace.id},
        )
        session.execute(
            text(
                "UPDATE agent_versions SET workspace_id = NULL "
                "WHERE id = 'agent-version-1'"
            ),
        )
        session.commit()
        other_workspace_id = other_workspace.id

    ensure_current_schema(engine)

    with Session(engine) as session:
        agent_workspace_id = session.execute(
            text("SELECT workspace_id FROM agents WHERE id = 'agent-1'"),
        ).scalar_one()
        version_workspace_id = session.execute(
            text(
                "SELECT workspace_id FROM agent_versions "
                "WHERE id = 'agent-version-1'"
            ),
        ).scalar_one()
        workflow_workspace_id = session.execute(
            text(
                "SELECT workspace_id FROM workflows "
                "WHERE id = 'workflow-1'"
            ),
        ).scalar_one()
        assert agent_workspace_id == other_workspace_id
        assert version_workspace_id == other_workspace_id
        assert workflow_workspace_id != other_workspace_id


def test_pre_authentication_audit_event_can_remain_without_workspace(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'pre-auth-audit.db'}")
    create_legacy_schema(engine)
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO audit_events VALUES (
                    'audit-login-failed', NULL, 'login_failed', 'anonymous',
                    'invalid credentials', '', '', '{}', CURRENT_TIMESTAMP
                )
                """
            ),
        )

    migrate_twice(engine)

    with Session(engine) as session:
        workspace_id = session.execute(
            text(
                "SELECT workspace_id FROM audit_events "
                "WHERE id = 'audit-login-failed'"
            ),
        ).scalar_one()
        assert workspace_id is None


def test_platform_audit_events_support_nullable_task_and_platform_columns(
    tmp_path,
):
    engine = create_engine(f"sqlite:///{tmp_path / 'platform-audit.db'}")

    Base.metadata.create_all(engine)
    ensure_current_schema(engine)

    with Session(engine) as session:
        platform_event = AuditEventRecord(
            human_task_id=None,
            organization_id="org-1",
            actor_user_id=None,
            session_id=None,
            action="auth.login_failed",
            target_type="session",
            target_id=None,
            outcome="failure",
            request_id="request-1",
            ip_address="127.0.0.1",
            event_metadata={"reason": "invalid_credentials"},
        )
        session.add(platform_event)
        session.commit()
        event_id = platform_event.id

    with Session(engine) as session:
        event = session.get(AuditEventRecord, event_id)
        assert event is not None
        assert event.human_task_id is None
        assert event.action == "auth.login_failed"
        assert event.event_metadata == {"reason": "invalid_credentials"}


def test_legacy_audit_events_become_platform_compatible(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy-audit.db'}")
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE human_tasks (
                    id VARCHAR(36) PRIMARY KEY,
                    workflow_run_id VARCHAR(36) NOT NULL,
                    node_run_id VARCHAR(36) NOT NULL,
                    human_node_id VARCHAR(120) NOT NULL,
                    source_node_id VARCHAR(120) NOT NULL,
                    artifact_version_id VARCHAR(36) NOT NULL,
                    title VARCHAR(200) NOT NULL,
                    status VARCHAR(32) NOT NULL,
                    assignment_type VARCHAR(32) NOT NULL,
                    review_policy VARCHAR(32) NOT NULL,
                    required_approvals INTEGER NOT NULL,
                    participant_snapshot JSON NOT NULL,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
                """
            ),
        )
        connection.execute(
            text(
                """
                INSERT INTO human_tasks VALUES (
                    'task-1', 'run-1', 'node-run-1', 'human-1', 'node-1',
                    'artifact-version-1', 'Legacy Task', 'pending',
                    'group_claim', 'any_one', 1, '[]',
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                """
            ),
        )
        connection.execute(
            text(
                """
                CREATE TABLE audit_events (
                    id VARCHAR(36) PRIMARY KEY,
                    human_task_id VARCHAR(36) NOT NULL,
                    event_type VARCHAR(64) NOT NULL,
                    actor_id VARCHAR(80) NOT NULL,
                    reason TEXT NOT NULL,
                    before_status VARCHAR(32) NOT NULL,
                    after_status VARCHAR(32) NOT NULL,
                    payload JSON NOT NULL,
                    created_at DATETIME NOT NULL
                )
                """
            ),
        )
        connection.execute(
            text(
                """
                INSERT INTO audit_events VALUES (
                    'audit-task', 'task-1', 'task_created', 'system', '',
                    '', 'pending', '{}', CURRENT_TIMESTAMP
                )
                """
            ),
        )

    ensure_current_schema(engine)
    ensure_current_schema(engine)

    audit_columns = {
        column["name"]: column
        for column in inspect(engine).get_columns("audit_events")
    }
    assert audit_columns["human_task_id"]["nullable"] is True
    assert {
        "organization_id",
        "workspace_id",
        "actor_user_id",
        "session_id",
        "action",
        "target_type",
        "target_id",
        "outcome",
        "request_id",
        "ip_address",
        "metadata",
    } <= audit_columns.keys()

    with Session(engine) as session:
        old_event = session.get(AuditEventRecord, "audit-task")
        assert old_event is not None
        assert old_event.human_task_id == "task-1"
        assert old_event.event_type == "task_created"
        assert old_event.workspace_id is not None

        platform_event = AuditEventRecord(
            human_task_id=None,
            organization_id=None,
            workspace_id=None,
            actor_user_id=None,
            session_id="session-1",
            action="auth.login_failed",
            target_type="session",
            target_id="session-1",
            outcome="failure",
            request_id="request-2",
            ip_address="127.0.0.1",
            event_metadata={"method": "password"},
        )
        session.add(platform_event)
        session.commit()
        event_id = platform_event.id

    with Session(engine) as session:
        platform_event = session.get(AuditEventRecord, event_id)
        old_event = session.get(AuditEventRecord, "audit-task")
        assert platform_event is not None
        assert platform_event.human_task_id is None
        assert platform_event.workspace_id is None
        assert platform_event.action == "auth.login_failed"
        assert platform_event.event_metadata == {"method": "password"}
        assert old_event is not None
        assert old_event.human_task_id == "task-1"
