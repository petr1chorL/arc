from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import DateTime, Float, Integer, JSON, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class AgentRecord(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(80))
    role: Mapped[str] = mapped_column(String(240))
    owner: Mapped[str] = mapped_column(String(80))
    model: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(20), default="调试中")
    version: Mapped[str] = mapped_column(String(20), default="v0.1.0")
    pass_rate: Mapped[float] = mapped_column(Float, default=0)
    runs: Mapped[int] = mapped_column(Integer, default=0)
    tools: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
