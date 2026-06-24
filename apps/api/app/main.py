from collections.abc import Iterator

from fastapi import Depends, FastAPI, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.database import create_database, session_scope
from app.models import AgentRecord, Base, utc_now
from app.schemas import AgentCreate, AgentRead


def create_app(database_url: str | None = None) -> FastAPI:
    resolved_database_url = database_url or Settings().database_url
    engine, session_factory = create_database(resolved_database_url)
    Base.metadata.create_all(engine)
    app = FastAPI(title="ARC.ONE API")

    def get_session() -> Iterator[Session]:
        yield from session_scope(session_factory)

    @app.get("/api/agents", response_model=list[AgentRead])
    def list_agents(session: Session = Depends(get_session)) -> list[AgentRecord]:
        statement = select(AgentRecord).order_by(AgentRecord.created_at.desc())
        return list(session.scalars(statement))

    @app.post(
        "/api/agents",
        response_model=AgentRead,
        status_code=status.HTTP_201_CREATED,
    )
    def create_agent(
        agent: AgentCreate,
        session: Session = Depends(get_session),
    ) -> AgentRecord:
        now = utc_now()
        record = AgentRecord(
            **agent.model_dump(),
            created_at=now,
            updated_at=now,
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return record

    return app


app = create_app()
