from sqlalchemy import Engine, inspect, text


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


def ensure_current_schema(engine: Engine) -> None:
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
