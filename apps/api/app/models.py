from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import DateTime, Float, Integer, JSON, String, Text
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
    skills: Mapped[list[str]] = mapped_column(JSON, default=list)
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AgentVersionRecord(Base):
    __tablename__ = "agent_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    agent_id: Mapped[str] = mapped_column(String(36), index=True)
    version: Mapped[str] = mapped_column(String(20))
    snapshot: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WorkflowRecord(Base):
    __tablename__ = "workflows"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20), default="草稿")
    version: Mapped[str] = mapped_column(String(20), default="未发布")
    nodes: Mapped[list[dict]] = mapped_column(JSON, default=list)
    edges: Mapped[list[dict]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WorkflowVersionRecord(Base):
    __tablename__ = "workflow_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    workflow_id: Mapped[str] = mapped_column(String(36), index=True)
    version: Mapped[str] = mapped_column(String(20))
    snapshot: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WorkflowRunRecord(Base):
    __tablename__ = "workflow_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    kind: Mapped[str] = mapped_column(String(20), default="workflow")
    name: Mapped[str] = mapped_column(String(160))
    workflow_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    workflow_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    agent_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    agent_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="运行中")
    input_text: Mapped[str] = mapped_column(Text)
    output_text: Mapped[str] = mapped_column(Text, default="")
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    model: Mapped[str] = mapped_column(String(120), default="")
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    current_node: Mapped[str] = mapped_column(String(160), default="")
    error: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class NodeRunRecord(Base):
    __tablename__ = "node_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    run_id: Mapped[str] = mapped_column(String(36), index=True)
    node_id: Mapped[str] = mapped_column(String(120))
    node_type: Mapped[str] = mapped_column(String(40))
    node_name: Mapped[str] = mapped_column(String(160))
    agent_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    agent_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="运行中")
    input_text: Mapped[str] = mapped_column(Text)
    output_text: Mapped[str] = mapped_column(Text, default="")
    model: Mapped[str] = mapped_column(String(120), default="")
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    attempts: Mapped[int] = mapped_column(Integer, default=1)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ArtifactRecord(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    run_id: Mapped[str] = mapped_column(String(36), index=True)
    source_node_run_id: Mapped[str] = mapped_column(String(36))
    artifact_type: Mapped[str] = mapped_column(String(80), default="text")
    content: Mapped[str] = mapped_column(Text)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ArtifactVersionRecord(Base):
    __tablename__ = "artifact_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    artifact_id: Mapped[str] = mapped_column(String(36), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    parent_version_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    content: Mapped[str] = mapped_column(Text)
    created_by: Mapped[str] = mapped_column(String(80), default="system")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class HumanTaskRecord(Base):
    __tablename__ = "human_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    workflow_run_id: Mapped[str] = mapped_column(String(36), index=True)
    node_run_id: Mapped[str] = mapped_column(String(36), unique=True)
    human_node_id: Mapped[str] = mapped_column(String(120))
    source_node_id: Mapped[str] = mapped_column(String(120))
    artifact_version_id: Mapped[str] = mapped_column(String(36))
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(32), default="待认领")
    assignment_type: Mapped[str] = mapped_column(String(32), default="group_claim")
    review_policy: Mapped[str] = mapped_column(String(32), default="any_one")
    required_approvals: Mapped[int] = mapped_column(Integer, default=1)
    participant_snapshot: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class HumanReviewRecord(Base):
    __tablename__ = "human_reviews"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    run_id: Mapped[str] = mapped_column(String(36), index=True)
    node_run_id: Mapped[str] = mapped_column(String(36))
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="待处理")
    reason: Mapped[str] = mapped_column(Text)
    score: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
