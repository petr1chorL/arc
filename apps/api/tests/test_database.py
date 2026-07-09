from app.database import normalize_database_url


def test_normalize_database_url_uses_installed_psycopg_driver_for_postgresql():
    assert normalize_database_url("postgresql://user:pass@db.example/app") == (
        "postgresql+psycopg://user:pass@db.example/app"
    )


def test_normalize_database_url_accepts_postgres_scheme_alias():
    assert normalize_database_url("postgres://user:pass@db.example/app") == (
        "postgresql+psycopg://user:pass@db.example/app"
    )


def test_normalize_database_url_preserves_sqlite_urls():
    database_url = "sqlite:///tmp/app.db"

    assert normalize_database_url(database_url) == database_url
