from app.database import normalize_database_url


def test_render_postgres_url_uses_psycopg_driver():
    normalized = normalize_database_url(
        "postgres://user:password@db.internal:5432/arc_one",
    )

    assert normalized.startswith("postgresql+psycopg://")
    assert "db.internal:5432/arc_one" in normalized


def test_plain_postgresql_url_uses_psycopg_driver():
    normalized = normalize_database_url(
        "postgresql://user:password@db.internal:5432/arc_one",
    )

    assert normalized.startswith("postgresql+psycopg://")


def test_sqlite_url_is_unchanged():
    assert normalize_database_url("sqlite:///:memory:") == "sqlite:///:memory:"
