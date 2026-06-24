from sqlalchemy import Engine, inspect, text


def ensure_current_schema(engine: Engine) -> None:
    if engine.dialect.name != "sqlite":
        return
    inspector = inspect(engine)
    if "agents" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("agents")}
    additions = {
        "skills": "TEXT NOT NULL DEFAULT '[]'",
        "system_prompt": "TEXT NOT NULL DEFAULT ''",
    }
    with engine.begin() as connection:
        for name, definition in additions.items():
            if name not in columns:
                connection.execute(text(f"ALTER TABLE agents ADD COLUMN {name} {definition}"))
