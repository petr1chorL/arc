from datetime import datetime
from uuid import NAMESPACE_URL, uuid4, uuid5

from sqlalchemy import Connection, Engine, inspect, select, text

from app.models import (
    Base,
    OrganizationRecord,
    UserRecord,
    WorkspaceRecord,
    utc_now,
)


DEFAULT_ORGANIZATION_NAME = "安克创新"
DEFAULT_ORGANIZATION_SLUG = "anker-innovation"
DEFAULT_WORKSPACE_NAME = "AI 能力中心"
DEFAULT_WORKSPACE_SLUG = "ai-capability-center"

WORKSPACE_TABLES = (
    "agents",
    "agent_versions",
    "workflows",
    "workflow_versions",
    "workflow_runs",
    "execution_jobs",
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
    "notification_channels",
    "feedback_candidates",
    "golden_samples",
    "regression_sample_sets",
    "regression_samples",
    "regression_runs",
    "remediation_tasks",
    "remediation_task_activities",
    "rubrics",
    "rubric_versions",
    "evaluations",
    "human_reviews",
    "tool_skill_assets",
    "tool_skill_asset_invocations",
    "model_providers",
    "data_object_definitions",
    "data_object_versions",
)
DEFAULT_WORKSPACE_FALLBACK_TABLES = tuple(
    table_name
    for table_name in WORKSPACE_TABLES
    if table_name != "audit_events"
)
AUDIT_EVENT_PLATFORM_COLUMNS = {
    "organization_id": "VARCHAR(36)",
    "actor_user_id": "VARCHAR(36)",
    "session_id": "VARCHAR(36)",
    "action": "VARCHAR(120)",
    "target_type": "VARCHAR(80)",
    "target_id": "VARCHAR(120)",
    "outcome": "VARCHAR(32)",
    "request_id": "VARCHAR(120)",
    "ip_address": "VARCHAR(64)",
    "metadata": "JSON",
}
AUDIT_EVENT_REBUILD_COLUMNS = (
    "id",
    "workspace_id",
    "organization_id",
    "human_task_id",
    "actor_user_id",
    "session_id",
    "action",
    "target_type",
    "target_id",
    "outcome",
    "request_id",
    "ip_address",
    "metadata",
    "event_type",
    "actor_id",
    "reason",
    "before_status",
    "after_status",
    "payload",
    "created_at",
)
AUDIT_EVENT_REBUILD_COLUMN_DEFINITIONS = {
    "id": "VARCHAR(36) PRIMARY KEY",
    "workspace_id": "VARCHAR(36)",
    "organization_id": "VARCHAR(36)",
    "human_task_id": "VARCHAR(36)",
    "actor_user_id": "VARCHAR(36)",
    "session_id": "VARCHAR(36)",
    "action": "VARCHAR(120)",
    "target_type": "VARCHAR(80)",
    "target_id": "VARCHAR(120)",
    "outcome": "VARCHAR(32)",
    "request_id": "VARCHAR(120)",
    "ip_address": "VARCHAR(64)",
    "metadata": "JSON",
    "event_type": "VARCHAR(64)",
    "actor_id": "VARCHAR(80)",
    "reason": "TEXT",
    "before_status": "VARCHAR(32)",
    "after_status": "VARCHAR(32)",
    "payload": "JSON",
    "created_at": "DATETIME",
}
AUDIT_EVENT_LEGACY_NULLABLE_COLUMNS = (
    "human_task_id",
    "event_type",
    "actor_id",
)
AUDIT_EVENT_PLATFORM_INDEX_COLUMNS = (
    ("workspace_id", "ix_audit_events_workspace_id"),
    ("organization_id", "ix_audit_events_organization_id"),
    ("human_task_id", "ix_audit_events_human_task_id"),
    ("actor_user_id", "ix_audit_events_actor_user_id"),
    ("session_id", "ix_audit_events_session_id"),
    ("action", "ix_audit_events_action"),
    ("target_type", "ix_audit_events_target_type"),
    ("target_id", "ix_audit_events_target_id"),
    ("outcome", "ix_audit_events_outcome"),
    ("request_id", "ix_audit_events_request_id"),
)


def ensure_columns(
    engine: Engine,
    table_name: str,
    additions: dict[str, str],
) -> None:
    inspector = inspect(engine)
    if table_name not in inspector.get_table_names():
        return
    columns = {
        column["name"] for column in inspector.get_columns(table_name)
    }
    with engine.begin() as connection:
        for name, definition in additions.items():
            if name not in columns:
                connection.execute(
                    text(
                        f"ALTER TABLE {table_name} "
                        f"ADD COLUMN {name} {definition}"
                    ),
                )


def _quote_audit_event_column(column_name: str) -> str:
    return f'"{column_name}"'


def _audit_events_need_nullable_rebuild(engine: Engine) -> bool:
    inspector = inspect(engine)
    if "audit_events" not in inspector.get_table_names():
        return False
    columns = {
        column["name"]: column
        for column in inspector.get_columns("audit_events")
    }
    return any(
        columns.get(column_name, {}).get("nullable") is False
        for column_name in AUDIT_EVENT_LEGACY_NULLABLE_COLUMNS
    )


def _rebuild_audit_events_for_platform_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    if "audit_events" not in inspector.get_table_names():
        return
    existing_columns = {
        column["name"]
        for column in inspector.get_columns("audit_events")
    }
    column_definitions = ",\n                    ".join(
        f"{_quote_audit_event_column(column_name)} "
        f"{AUDIT_EVENT_REBUILD_COLUMN_DEFINITIONS[column_name]}"
        for column_name in AUDIT_EVENT_REBUILD_COLUMNS
    )
    insert_columns = ", ".join(
        _quote_audit_event_column(column_name)
        for column_name in AUDIT_EVENT_REBUILD_COLUMNS
    )
    select_columns = ", ".join(
        _quote_audit_event_column(column_name)
        if column_name in existing_columns
        else f"NULL AS {_quote_audit_event_column(column_name)}"
        for column_name in AUDIT_EVENT_REBUILD_COLUMNS
    )

    with engine.begin() as connection:
        connection.execute(text("DROP TABLE IF EXISTS audit_events_v07a_rebuild"))
        connection.execute(
            text(
                f"""
                CREATE TABLE audit_events_v07a_rebuild (
                    {column_definitions}
                )
                """
            ),
        )
        connection.execute(
            text(
                f"""
                INSERT INTO audit_events_v07a_rebuild ({insert_columns})
                SELECT {select_columns}
                FROM audit_events
                """
            ),
        )
        connection.execute(text("DROP TABLE audit_events"))
        connection.execute(
            text(
                "ALTER TABLE audit_events_v07a_rebuild "
                "RENAME TO audit_events"
            ),
        )


def _restore_audit_event_platform_indexes(engine: Engine) -> None:
    inspector = inspect(engine)
    if "audit_events" not in inspector.get_table_names():
        return
    existing_indexes = {
        index["name"] for index in inspector.get_indexes("audit_events")
    }
    with engine.begin() as connection:
        for column_name, index_name in AUDIT_EVENT_PLATFORM_INDEX_COLUMNS:
            if index_name in existing_indexes:
                continue
            connection.execute(
                text(
                    f'CREATE INDEX "{index_name}" '
                    f'ON audit_events ("{column_name}")'
                ),
            )


def ensure_audit_event_platform_schema(engine: Engine) -> None:
    ensure_columns(engine, "audit_events", AUDIT_EVENT_PLATFORM_COLUMNS)
    if _audit_events_need_nullable_rebuild(engine):
        _rebuild_audit_events_for_platform_schema(engine)
    _restore_audit_event_platform_indexes(engine)


def ensure_default_workspace(
    connection: Connection,
    *,
    organization_name: str = DEFAULT_ORGANIZATION_NAME,
    organization_slug: str = DEFAULT_ORGANIZATION_SLUG,
    now: datetime | None = None,
) -> tuple[str, str]:
    timestamp = now or utc_now()
    organization_table = OrganizationRecord.__table__
    workspace_table = WorkspaceRecord.__table__
    organization_id = connection.scalar(
        select(organization_table.c.id).where(
            organization_table.c.slug == organization_slug,
        ),
    )
    if organization_id is None:
        organization_id = str(uuid4())
        connection.execute(
            organization_table.insert().values(
                id=organization_id,
                name=organization_name,
                slug=organization_slug,
                status="active",
                created_at=timestamp,
                updated_at=timestamp,
            ),
        )

    workspace_id = connection.scalar(
        select(workspace_table.c.id).where(
            workspace_table.c.organization_id == organization_id,
            workspace_table.c.slug == DEFAULT_WORKSPACE_SLUG,
        ),
    )
    if workspace_id is None:
        workspace_id = str(uuid4())
        connection.execute(
            workspace_table.insert().values(
                id=workspace_id,
                organization_id=organization_id,
                name=DEFAULT_WORKSPACE_NAME,
                slug=DEFAULT_WORKSPACE_SLUG,
                status="active",
                created_by=None,
                created_at=timestamp,
                updated_at=timestamp,
            ),
        )
    return organization_id, workspace_id


def _inherit_workspace(
    connection: Connection,
    *,
    child_table: str,
    parent_table: str,
    child_parent_column: str,
) -> None:
    connection.execute(
        text(
            f"""
            UPDATE {child_table}
            SET workspace_id = (
                SELECT parent.workspace_id
                FROM {parent_table} AS parent
                WHERE parent.id = {child_table}.{child_parent_column}
            )
            WHERE workspace_id IS NULL
              AND EXISTS (
                SELECT 1
                FROM {parent_table} AS parent
                WHERE parent.id = {child_table}.{child_parent_column}
                  AND parent.workspace_id IS NOT NULL
              )
            """,
        ),
    )


def _fill_default_workspace(
    connection: Connection,
    table_name: str,
    workspace_id: str,
) -> None:
    connection.execute(
        text(
            f"""
            UPDATE {table_name}
            SET workspace_id = :workspace_id
            WHERE workspace_id IS NULL
            """,
        ),
        {"workspace_id": workspace_id},
    )


def _backfill_legacy_reviewer_users(
    connection: Connection,
    *,
    organization_id: str,
    now: datetime,
) -> None:
    reviewer_rows = connection.execute(
        text(
            """
            SELECT id, name
            FROM reviewers
            WHERE user_id IS NULL
            ORDER BY id
            """,
        ),
    ).mappings()
    user_table = UserRecord.__table__
    for reviewer in reviewer_rows:
        user_id = str(
            uuid5(
                NAMESPACE_URL,
                f"arc.one:legacy-reviewer:{reviewer['id']}",
            ),
        )
        existing_user_id = connection.scalar(
            select(user_table.c.id).where(user_table.c.id == user_id),
        )
        if existing_user_id is None:
            connection.execute(
                user_table.insert().values(
                    id=user_id,
                    organization_id=organization_id,
                    email=None,
                    normalized_email=None,
                    display_name=reviewer["name"],
                    password_hash=None,
                    status="pending_email",
                    is_organization_admin=False,
                    failed_login_count=0,
                    locked_until=None,
                    password_changed_at=None,
                    last_login_at=None,
                    last_workspace_id=None,
                    created_at=now,
                    updated_at=now,
                ),
            )
        connection.execute(
            text(
                """
                UPDATE reviewers
                SET user_id = :user_id
                WHERE id = :reviewer_id
                  AND user_id IS NULL
                """,
            ),
            {
                "reviewer_id": reviewer["id"],
                "user_id": user_id,
            },
        )


def _backfill_legacy_audit_events(
    connection: Connection,
    *,
    organization_id: str,
) -> None:
    connection.execute(
        text(
            """
            UPDATE audit_events
            SET organization_id = :organization_id
            WHERE organization_id IS NULL
              AND human_task_id IS NOT NULL
            """
        ),
        {"organization_id": organization_id},
    )
    connection.execute(
        text(
            """
            UPDATE audit_events
            SET actor_user_id = (
                SELECT reviewers.user_id
                FROM reviewers
                WHERE reviewers.id = audit_events.actor_id
            )
            WHERE actor_user_id IS NULL
              AND human_task_id IS NOT NULL
              AND actor_id IS NOT NULL
            """
        ),
    )


def backfill_v07a_workspace(engine: Engine) -> None:
    with engine.begin() as connection:
        now = utc_now()
        organization_id, workspace_id = ensure_default_workspace(
            connection,
            now=now,
        )

        for root_table in ("agents", "workflows", "reviewers", "review_groups"):
            _fill_default_workspace(connection, root_table, workspace_id)

        _inherit_workspace(
            connection,
            child_table="agent_versions",
            parent_table="agents",
            child_parent_column="agent_id",
        )
        _inherit_workspace(
            connection,
            child_table="workflow_versions",
            parent_table="workflows",
            child_parent_column="workflow_id",
        )

        _inherit_workspace(
            connection,
            child_table="workflow_runs",
            parent_table="workflows",
            child_parent_column="workflow_id",
        )
        _inherit_workspace(
            connection,
            child_table="workflow_runs",
            parent_table="agents",
            child_parent_column="agent_id",
        )
        _fill_default_workspace(connection, "workflow_runs", workspace_id)

        _inherit_workspace(
            connection,
            child_table="node_runs",
            parent_table="workflow_runs",
            child_parent_column="run_id",
        )
        _inherit_workspace(
            connection,
            child_table="artifacts",
            parent_table="workflow_runs",
            child_parent_column="run_id",
        )
        _inherit_workspace(
            connection,
            child_table="artifacts",
            parent_table="node_runs",
            child_parent_column="source_node_run_id",
        )
        _inherit_workspace(
            connection,
            child_table="artifact_versions",
            parent_table="artifacts",
            child_parent_column="artifact_id",
        )

        _inherit_workspace(
            connection,
            child_table="human_tasks",
            parent_table="workflow_runs",
            child_parent_column="workflow_run_id",
        )
        _inherit_workspace(
            connection,
            child_table="human_tasks",
            parent_table="node_runs",
            child_parent_column="node_run_id",
        )
        _inherit_workspace(
            connection,
            child_table="human_tasks",
            parent_table="artifact_versions",
            child_parent_column="artifact_version_id",
        )
        _inherit_workspace(
            connection,
            child_table="artifact_diffs",
            parent_table="human_tasks",
            child_parent_column="human_task_id",
        )
        _inherit_workspace(
            connection,
            child_table="artifact_diffs",
            parent_table="artifact_versions",
            child_parent_column="to_version_id",
        )

        _inherit_workspace(
            connection,
            child_table="review_group_members",
            parent_table="review_groups",
            child_parent_column="group_id",
        )
        _inherit_workspace(
            connection,
            child_table="review_group_members",
            parent_table="reviewers",
            child_parent_column="reviewer_id",
        )

        for child_table in (
            "review_decisions",
            "resume_requests",
            "audit_events",
            "notification_outbox",
        ):
            _inherit_workspace(
                connection,
                child_table=child_table,
                parent_table="human_tasks",
                child_parent_column="human_task_id",
            )

        _inherit_workspace(
            connection,
            child_table="feedback_candidates",
            parent_table="workflow_runs",
            child_parent_column="workflow_run_id",
        )
        _inherit_workspace(
            connection,
            child_table="feedback_candidates",
            parent_table="workflows",
            child_parent_column="workflow_id",
        )
        _inherit_workspace(
            connection,
            child_table="feedback_candidates",
            parent_table="agents",
            child_parent_column="agent_id",
        )
        _inherit_workspace(
            connection,
            child_table="feedback_candidates",
            parent_table="human_tasks",
            child_parent_column="human_task_id",
        )
        _inherit_workspace(
            connection,
            child_table="golden_samples",
            parent_table="feedback_candidates",
            child_parent_column="candidate_id",
        )

        _inherit_workspace(
            connection,
            child_table="human_reviews",
            parent_table="workflow_runs",
            child_parent_column="run_id",
        )
        _inherit_workspace(
            connection,
            child_table="human_reviews",
            parent_table="node_runs",
            child_parent_column="node_run_id",
        )

        # V0.7A upgrades one legacy organization. Orphans cannot be assigned
        # through a trustworthy parent, so they fall back to its default space.
        for table_name in DEFAULT_WORKSPACE_FALLBACK_TABLES:
            _fill_default_workspace(connection, table_name, workspace_id)
        connection.execute(
            text(
                """
                UPDATE audit_events
                SET workspace_id = :workspace_id
                WHERE workspace_id IS NULL
                  AND human_task_id IS NOT NULL
                """
            ),
            {"workspace_id": workspace_id},
        )

        _backfill_legacy_reviewer_users(
            connection,
            organization_id=organization_id,
            now=now,
        )
        _backfill_legacy_audit_events(
            connection,
            organization_id=organization_id,
        )


def ensure_current_schema(engine: Engine) -> None:
    if engine.dialect.name != "sqlite":
        return
    Base.metadata.create_all(engine)
    ensure_columns(
        engine,
        "agents",
        {
            "skills": "TEXT NOT NULL DEFAULT '[]'",
            "system_prompt": "TEXT NOT NULL DEFAULT ''",
            "model_provider_id": "VARCHAR(36)",
            "model_provider": "VARCHAR(80) NOT NULL DEFAULT 'openai-compatible'",
            "model_base_url": "VARCHAR(500) NOT NULL DEFAULT ''",
            "temperature": "FLOAT NOT NULL DEFAULT 0.2",
            "max_output_tokens": "INTEGER NOT NULL DEFAULT 2000",
            "runtime_manifest": "JSON NOT NULL DEFAULT '{}'",
        },
    )
    ensure_columns(
        engine,
        "human_tasks",
        {
            "assignee_reviewer_id": "VARCHAR(36)",
            "assignee_group_id": "VARCHAR(36)",
            "due_at": (
                "DATETIME NOT NULL DEFAULT '9999-12-31 23:59:59'"
            ),
            "escalation_at": (
                "DATETIME NOT NULL DEFAULT '9999-12-31 23:59:59'"
            ),
            "sla_status": "VARCHAR(32) NOT NULL DEFAULT '正常'",
            "escalation_group_id": "VARCHAR(36)",
            "due_reminder_sent_at": "DATETIME",
            "overdue_recorded_at": "DATETIME",
            "escalated_at": "DATETIME",
        },
    )
    ensure_columns(
        engine,
        "review_decisions",
        {
            "tags": "TEXT NOT NULL DEFAULT '[]'",
        },
    )
    ensure_columns(
        engine,
        "workflow_runs",
        {
            "trace_id": "VARCHAR(80) NOT NULL DEFAULT ''",
        },
    )
    ensure_columns(
        engine,
        "workflows",
        {
            "input_schema": "JSON NOT NULL DEFAULT '{\"type\":\"object\",\"properties\":{}}'",
            "output_schema": "JSON NOT NULL DEFAULT '{\"type\":\"object\",\"properties\":{}}'",
        },
    )
    ensure_columns(
        engine,
        "agent_versions",
        {
            "note": "TEXT NOT NULL DEFAULT ''",
        },
    )
    ensure_columns(
        engine,
        "workflow_versions",
        {
            "note": "TEXT NOT NULL DEFAULT ''",
        },
    )
    ensure_columns(
        engine,
        "node_runs",
        {
            "trace_id": "VARCHAR(80) NOT NULL DEFAULT ''",
            "span_id": "VARCHAR(80) NOT NULL DEFAULT ''",
            "parent_span_id": "VARCHAR(80)",
        },
    )
    ensure_columns(
        engine,
        "artifact_versions",
        {
            "data_object_definition_id": "VARCHAR(36)",
            "data_object_version_id": "VARCHAR(36)",
            "data_object_snapshot": "JSON",
        },
    )
    ensure_columns(
        engine,
        "audit_events",
        {
            "trace_id": "VARCHAR(80) NOT NULL DEFAULT ''",
            "span_id": "VARCHAR(80)",
        },
    )
    for table_name in WORKSPACE_TABLES:
        ensure_columns(
            engine,
            table_name,
            {"workspace_id": "VARCHAR(36)"},
        )
    ensure_columns(
        engine,
        "execution_jobs",
        {
            "max_attempts": "INTEGER NOT NULL DEFAULT 3",
            "locked_by": "VARCHAR(120) NOT NULL DEFAULT ''",
            "locked_until": "DATETIME",
            "last_heartbeat_at": "DATETIME",
            "next_attempt_at": "DATETIME",
            "dead_lettered_at": "DATETIME",
            "canceled_at": "DATETIME",
        },
    )
    ensure_columns(
        engine,
        "reviewers",
        {"user_id": "VARCHAR(36)"},
    )
    ensure_columns(
        engine,
        "rubrics",
        {
            "sort_order": "INTEGER NOT NULL DEFAULT 0",
            "judge_type": "VARCHAR(32) NOT NULL DEFAULT 'deterministic'",
            "judge_model": "VARCHAR(120) NOT NULL DEFAULT ''",
        },
    )
    ensure_columns(
        engine,
        "evaluations",
        {
            "evaluator_type": "VARCHAR(32) NOT NULL DEFAULT 'deterministic'",
            "evaluator_model": "VARCHAR(120) NOT NULL DEFAULT ''",
            "evaluator_input": "JSON NOT NULL DEFAULT '{}'",
        },
    )
    ensure_columns(
        engine,
        "remediation_tasks",
        {
            "owner": "VARCHAR(120)",
            "due_date": "DATETIME",
            "retest_run_id": "VARCHAR(36)",
        },
    )
    ensure_columns(
        engine,
        "tool_skill_assets",
        {
            "adapter_type": "VARCHAR(20) NOT NULL DEFAULT 'manual'",
            "adapter_config": "JSON NOT NULL DEFAULT '{}'",
        },
    )
    ensure_columns(
        engine,
        "agents",
        {
            "tool_asset_refs": "JSON NOT NULL DEFAULT '[]'",
            "skill_asset_refs": "JSON NOT NULL DEFAULT '[]'",
        },
    )
    ensure_audit_event_platform_schema(engine)
    backfill_v07a_workspace(engine)
