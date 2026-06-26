from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Float, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class OrganizationRecord(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(160))
    slug: Mapped[str] = mapped_column(String(120), unique=True)
    status: Mapped[str] = mapped_column(String(32), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class UserRecord(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "normalized_email",
            name="uq_user_org_email",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    organization_id: Mapped[str] = mapped_column(String(36), index=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    normalized_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    display_name: Mapped[str] = mapped_column(String(160))
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending_email")
    is_organization_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    password_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_workspace_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WorkspaceRecord(Base):
    __tablename__ = "workspaces"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "slug",
            name="uq_workspace_org_slug",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    organization_id: Mapped[str] = mapped_column(String(36), index=True)
    name: Mapped[str] = mapped_column(String(160))
    slug: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(32), default="active")
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WorkspaceMembershipRecord(Base):
    __tablename__ = "workspace_memberships"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "user_id",
            name="uq_workspace_membership",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str] = mapped_column(String(36), index=True)
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    role: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="invited")
    invited_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    activated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class SessionRecord(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        UniqueConstraint("token_digest", name="uq_session_token_digest"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    token_digest: Mapped[str] = mapped_column(String(64))
    csrf_digest: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    idle_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    absolute_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    revoked_reason: Mapped[str | None] = mapped_column(
        String(120),
        nullable=True,
    )
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)


class InvitationRecord(Base):
    __tablename__ = "invitations"
    __table_args__ = (
        UniqueConstraint("token_digest", name="uq_invitation_token_digest"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    organization_id: Mapped[str] = mapped_column(String(36), index=True)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True)
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    role: Mapped[str] = mapped_column(String(32))
    token_digest: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AgentRecord(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
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
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    agent_id: Mapped[str] = mapped_column(String(36), index=True)
    version: Mapped[str] = mapped_column(String(20))
    snapshot: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WorkflowRecord(Base):
    __tablename__ = "workflows"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
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
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    workflow_id: Mapped[str] = mapped_column(String(36), index=True)
    version: Mapped[str] = mapped_column(String(20))
    snapshot: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WorkflowRunRecord(Base):
    __tablename__ = "workflow_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
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
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
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
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    run_id: Mapped[str] = mapped_column(String(36), index=True)
    source_node_run_id: Mapped[str] = mapped_column(String(36))
    artifact_type: Mapped[str] = mapped_column(String(80), default="text")
    content: Mapped[str] = mapped_column(Text)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ArtifactVersionRecord(Base):
    __tablename__ = "artifact_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    artifact_id: Mapped[str] = mapped_column(String(36), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    parent_version_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    content: Mapped[str] = mapped_column(Text)
    created_by: Mapped[str] = mapped_column(String(80), default="system")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ArtifactDiffRecord(Base):
    __tablename__ = "artifact_diffs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    human_task_id: Mapped[str] = mapped_column(String(36), index=True)
    from_version_id: Mapped[str] = mapped_column(String(36))
    to_version_id: Mapped[str] = mapped_column(String(36), unique=True)
    old_content: Mapped[str] = mapped_column(Text)
    new_content: Mapped[str] = mapped_column(Text)
    unified_diff: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ReviewerRecord(Base):
    __tablename__ = "reviewers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(80))
    role: Mapped[str] = mapped_column(String(80))
    is_expert: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ReviewGroupRecord(Base):
    __tablename__ = "review_groups"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    assignment_mode: Mapped[str] = mapped_column(String(32), default="group_claim")
    rotation_cursor: Mapped[int] = mapped_column(Integer, default=0)
    is_escalation_group: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ReviewGroupMemberRecord(Base):
    __tablename__ = "review_group_members"
    __table_args__ = (
        UniqueConstraint("group_id", "reviewer_id", name="uq_review_group_member"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    group_id: Mapped[str] = mapped_column(String(36), index=True)
    reviewer_id: Mapped[str] = mapped_column(String(36), index=True)
    role: Mapped[str] = mapped_column(String(80), default="审核人")


class HumanTaskRecord(Base):
    __tablename__ = "human_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    workflow_run_id: Mapped[str] = mapped_column(String(36), index=True)
    node_run_id: Mapped[str] = mapped_column(String(36), unique=True)
    human_node_id: Mapped[str] = mapped_column(String(120))
    source_node_id: Mapped[str] = mapped_column(String(120))
    artifact_version_id: Mapped[str] = mapped_column(String(36))
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(32), default="待认领")
    assignment_type: Mapped[str] = mapped_column(String(32), default="group_claim")
    assignee_reviewer_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    assignee_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    review_policy: Mapped[str] = mapped_column(String(32), default="any_one")
    required_approvals: Mapped[int] = mapped_column(Integer, default=1)
    participant_snapshot: Mapped[list[str]] = mapped_column(JSON, default=list)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    escalation_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    sla_status: Mapped[str] = mapped_column(String(32), default="正常")
    escalation_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    due_reminder_sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    overdue_recorded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    escalated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ReviewDecisionRecord(Base):
    __tablename__ = "review_decisions"
    __table_args__ = (
        UniqueConstraint("human_task_id", "reviewer_id", name="uq_task_reviewer_decision"),
        UniqueConstraint("idempotency_key", name="uq_review_decision_idempotency"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    human_task_id: Mapped[str] = mapped_column(String(36), index=True)
    reviewer_id: Mapped[str] = mapped_column(String(36), index=True)
    decision: Mapped[str] = mapped_column(String(32))
    reason: Mapped[str] = mapped_column(Text)
    artifact_version_id: Mapped[str] = mapped_column(String(36))
    idempotency_key: Mapped[str] = mapped_column(String(160))
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ResumeRequestRecord(Base):
    __tablename__ = "resume_requests"
    __table_args__ = (
        UniqueConstraint("human_task_id", "decision_id", name="uq_task_decision_resume"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    human_task_id: Mapped[str] = mapped_column(String(36), index=True)
    decision_id: Mapped[str] = mapped_column(String(36))
    action: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="pending")
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuditEventRecord(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    organization_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    human_task_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    actor_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    session_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    action: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    target_type: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    target_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    outcome: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    request_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    event_metadata: Mapped[dict | None] = mapped_column(
        "metadata",
        JSON,
        nullable=True,
        default=dict,
    )
    event_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    actor_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    before_status: Mapped[str] = mapped_column(String(32), default="")
    after_status: Mapped[str] = mapped_column(String(32), default="")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class NotificationOutboxRecord(Base):
    __tablename__ = "notification_outbox"
    __table_args__ = (
        UniqueConstraint("event_key", name="uq_notification_event_key"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    event_key: Mapped[str] = mapped_column(String(160))
    human_task_id: Mapped[str] = mapped_column(String(36), index=True)
    event_type: Mapped[str] = mapped_column(String(64))
    recipient_type: Mapped[str] = mapped_column(String(32))
    recipient_id: Mapped[str] = mapped_column(String(80))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class FeedbackCandidateRecord(Base):
    __tablename__ = "feedback_candidates"
    __table_args__ = (
        UniqueConstraint("decision_id", name="uq_feedback_candidate_decision"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    human_task_id: Mapped[str] = mapped_column(String(36), index=True)
    decision_id: Mapped[str] = mapped_column(String(36))
    original_version_id: Mapped[str] = mapped_column(String(36))
    modified_version_id: Mapped[str] = mapped_column(String(36))
    diff_id: Mapped[str] = mapped_column(String(36))
    reason: Mapped[str] = mapped_column(Text)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    workflow_run_id: Mapped[str] = mapped_column(String(36), index=True)
    workflow_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    agent_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    source_node_id: Mapped[str] = mapped_column(String(120))
    created_by: Mapped[str] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(32), default="待确认")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class GoldenSampleRecord(Base):
    __tablename__ = "golden_samples"
    __table_args__ = (
        UniqueConstraint("candidate_id", name="uq_golden_sample_candidate"),
        UniqueConstraint("idempotency_key", name="uq_golden_sample_idempotency"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    candidate_id: Mapped[str] = mapped_column(String(36), index=True)
    input_text: Mapped[str] = mapped_column(Text)
    expected_output: Mapped[str] = mapped_column(Text)
    reviewer_id: Mapped[str] = mapped_column(String(36))
    reason: Mapped[str] = mapped_column(Text)
    idempotency_key: Mapped[str] = mapped_column(String(160))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class HumanReviewRecord(Base):
    __tablename__ = "human_reviews"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    run_id: Mapped[str] = mapped_column(String(36), index=True)
    node_run_id: Mapped[str] = mapped_column(String(36))
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="待处理")
    reason: Mapped[str] = mapped_column(Text)
    score: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
