from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import Engine, create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker


def create_database(database_url: str) -> tuple[Engine, sessionmaker[Session]]:
    url = make_url(database_url)
    if url.drivername.startswith("sqlite") and url.database not in (None, "", ":memory:"):
        Path(url.database).parent.mkdir(parents=True, exist_ok=True)
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    engine = create_engine(database_url, connect_args=connect_args)
    return engine, sessionmaker(bind=engine, expire_on_commit=False)


def session_scope(session_factory: sessionmaker[Session]) -> Iterator[Session]:
    session = session_factory()
    try:
        yield session
    finally:
        session.close()
