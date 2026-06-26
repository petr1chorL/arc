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
)
DEFAULT_WORKSPACE_FALLBACK_TABLES = tuple(
    table_name
    for table_name in WORKSPACE_TABLES
    if table_name != "audit_events"
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


def ensure_current_schema(engine: Engine) -> None:
    Base.metadata.create_all(engine)
    if engine.dialect.name != "sqlite":
        return
    ensure_columns(
        engine,
        "agents",
        {
            "skills": "TEXT NOT NULL DEFAULT '[]'",
            "system_prompt": "TEXT NOT NULL DEFAULT ''",
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
    for table_name in WORKSPACE_TABLES:
        ensure_columns(
            engine,
            table_name,
            {"workspace_id": "VARCHAR(36)"},
        )
    ensure_columns(
        engine,
        "reviewers",
        {"user_id": "VARCHAR(36)"},
    )
    backfill_v07a_workspace(engine)
