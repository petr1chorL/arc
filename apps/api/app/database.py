from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import Engine, create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker


def normalize_database_url(database_url: str) -> str:
    url = make_url(database_url)
    if url.drivername in {"postgres", "postgresql"}:
        return url.set(drivername="postgresql+psycopg").render_as_string(
            hide_password=False,
        )
    return database_url


def create_database(database_url: str) -> tuple[Engine, sessionmaker[Session]]:
    normalized_database_url = normalize_database_url(database_url)
    url = make_url(normalized_database_url)
    if url.drivername.startswith("sqlite") and url.database not in (None, "", ":memory:"):
        Path(url.database).parent.mkdir(parents=True, exist_ok=True)
    connect_args = {"check_same_thread": False} if normalized_database_url.startswith("sqlite") else {}
    engine = create_engine(normalized_database_url, connect_args=connect_args)
    return engine, sessionmaker(bind=engine, expire_on_commit=False)


def session_scope(session_factory: sessionmaker[Session]) -> Iterator[Session]:
    session = session_factory()
    try:
        yield session
    finally:
        session.close()
