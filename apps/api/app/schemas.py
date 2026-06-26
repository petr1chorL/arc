from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class LoginCreate(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=12, max_length=1024)

    @field_validator("email")
    @classmethod
    def reject_blank_email(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("邮箱不能为空")
        return normalized


class AuthUserRead(BaseModel):
    id: str
    email: str
    display_name: str = Field(serialization_alias="displayName")
    is_organization_admin: bool = Field(
        serialization_alias="isOrganizationAdmin",
    )

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class AuthSessionRead(BaseModel):
    user: AuthUserRead


class ChangePasswordCreate(BaseModel):
    current_password: str = Field(
        alias="currentPassword",
        min_length=12,
        max_length=1024,
    )
    new_password: str = Field(
        alias="newPassword",
        min_length=12,
        max_length=1024,
    )

    model_config = ConfigDict(populate_by_name=True)


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    slug: str = Field(min_length=1, max_length=120)

    @field_validator("name", "slug")
    @classmethod
    def reject_blank_workspace_values(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("字段不能为空")
        return normalized


class WorkspaceRead(BaseModel):
    id: str
    organization_id: str = Field(serialization_alias="organizationId")
    name: str
    slug: str
    status: str
    created_by: str | None = Field(serialization_alias="createdBy")
    created_at: datetime = Field(serialization_alias="createdAt")
    updated_at: datetime = Field(serialization_alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


WorkspaceRole = Literal["viewer", "operator", "builder", "workspace_admin"]


class InvitationCreate(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    role: WorkspaceRole

    @field_validator("email")
    @classmethod
    def reject_blank_email(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("邮箱不能为空")
        return normalized


class ReviewerQualificationRead(BaseModel):
    role: str
    is_expert: bool = Field(serialization_alias="isExpert")
    is_active: bool = Field(serialization_alias="isActive")

    model_config = ConfigDict(populate_by_name=True)


class WorkspaceMemberRead(BaseModel):
    user_id: str = Field(serialization_alias="userId")
    invitation_id: str | None = Field(default=None, serialization_alias="invitationId")
    email: str
    display_name: str = Field(serialization_alias="displayName")
    role: WorkspaceRole
    user_status: str = Field(serialization_alias="userStatus")
    membership_status: str = Field(serialization_alias="membershipStatus")
    reviewer: ReviewerQualificationRead | None = None
    last_login_at: datetime | None = Field(default=None, serialization_alias="lastLoginAt")

    model_config = ConfigDict(populate_by_name=True)


class InvitationLinkRead(BaseModel):
    invitation_id: str = Field(serialization_alias="invitationId")
    email: str
    role: WorkspaceRole
    expires_at: datetime = Field(serialization_alias="expiresAt")
    activation_url: str | None = Field(serialization_alias="activationUrl")

    model_config = ConfigDict(populate_by_name=True)


class InvitationPreviewRead(BaseModel):
    email: str
    workspace_name: str = Field(serialization_alias="workspaceName")
    role: WorkspaceRole
    expires_at: datetime = Field(serialization_alias="expiresAt")

    model_config = ConfigDict(populate_by_name=True)


class InvitationActivateCreate(BaseModel):
    display_name: str = Field(alias="displayName", min_length=1, max_length=160)
    password: str = Field(min_length=12, max_length=1024)

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("display_name")
    @classmethod
    def reject_blank_display_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("显示名称不能为空")
        return normalized


class MembershipRoleUpdate(BaseModel):
    role: WorkspaceRole


class AgentCreate(BaseModel):
    name: str = Field(max_length=80)
    role: str = Field(max_length=240)
    owner: str = Field(max_length=80)
    model: str = Field(max_length=80)

    @field_validator("name", "role", "owner", "model")
    @classmethod
    def reject_blank_values(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("字段不能为空")
        return normalized


class AgentUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    role: str | None = Field(default=None, max_length=240)
    owner: str | None = Field(default=None, max_length=80)
    model: str | None = Field(default=None, max_length=80)
    system_prompt: str | None = Field(default=None, alias="systemPrompt", max_length=20000)
    tools: list[str] | None = None
    skills: list[str] | None = None

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("name", "role", "owner", "model")
    @classmethod
    def reject_blank_values(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = value.strip()
        if not normalized:
            raise ValueError("字段不能为空")
        return normalized


class AgentRead(BaseModel):
    id: str
    name: str
    role: str
    owner: str
    model: str
    status: str
    version: str
    pass_rate: float = Field(serialization_alias="passRate")
    runs: int
    tools: list[str]
    skills: list[str]
    system_prompt: str = Field(serialization_alias="systemPrompt")
    created_at: datetime = Field(serialization_alias="createdAt")
    updated_at: datetime = Field(serialization_alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class VersionRead(BaseModel):
    id: str
    version: str
    snapshot: dict
    created_at: datetime = Field(serialization_alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class WorkflowNode(BaseModel):
    id: str
    type: str
    position: dict[str, float]
    data: dict


class WorkflowEdge(BaseModel):
    id: str
    source: str
    target: str
    label: str | None = None


class WorkflowCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    nodes: list[WorkflowNode] = Field(default_factory=list)
    edges: list[WorkflowEdge] = Field(default_factory=list)


class WorkflowUpdate(WorkflowCreate):
    pass


class WorkflowRead(BaseModel):
    id: str
    name: str
    status: str
    version: str
    nodes: list[dict]
    edges: list[dict]
    created_at: datetime = Field(serialization_alias="createdAt")
    updated_at: datetime = Field(serialization_alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ValidationResult(BaseModel):
    valid: bool
    errors: list[str]


class RunCreate(BaseModel):
    input: str = Field(min_length=1, max_length=50000)
    version: str | None = None


class ReviewDecision(BaseModel):
    decision: Literal["approve", "reject"]


class NodeRunRead(BaseModel):
    id: str
    node_id: str = Field(serialization_alias="nodeId")
    node_type: str = Field(serialization_alias="nodeType")
    node_name: str = Field(serialization_alias="nodeName")
    status: str
    input_text: str = Field(serialization_alias="input")
    output_text: str = Field(serialization_alias="output")
    model: str
    prompt_tokens: int = Field(serialization_alias="promptTokens")
    completion_tokens: int = Field(serialization_alias="completionTokens")
    total_tokens: int = Field(serialization_alias="totalTokens")
    cost_usd: float = Field(serialization_alias="costUsd")
    duration_ms: int = Field(serialization_alias="durationMs")
    attempts: int
    score: int | None
    error: str
    started_at: datetime = Field(serialization_alias="startedAt")
    completed_at: datetime | None = Field(serialization_alias="completedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class RunRead(BaseModel):
    id: str
    kind: str
    name: str
    workflow_id: str | None = Field(serialization_alias="workflowId")
    workflow_version: str | None = Field(serialization_alias="workflowVersion")
    agent_id: str | None = Field(serialization_alias="agentId")
    agent_version: str | None = Field(serialization_alias="agentVersion")
    status: str
    input_text: str = Field(serialization_alias="input")
    output_text: str = Field(serialization_alias="output")
    score: int | None
    model: str
    prompt_tokens: int = Field(serialization_alias="promptTokens")
    completion_tokens: int = Field(serialization_alias="completionTokens")
    total_tokens: int = Field(serialization_alias="totalTokens")
    cost_usd: float = Field(serialization_alias="costUsd")
    duration_ms: int = Field(serialization_alias="durationMs")
    current_node: str = Field(serialization_alias="currentNode")
    error: str
    started_at: datetime = Field(serialization_alias="startedAt")
    completed_at: datetime | None = Field(serialization_alias="completedAt")
    nodes: list[NodeRunRead] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class HumanReviewRead(BaseModel):
    id: str
    run_id: str = Field(serialization_alias="runId")
    node_run_id: str = Field(serialization_alias="nodeRunId")
    title: str
    status: str
    reason: str
    score: int
    created_at: datetime = Field(serialization_alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class HumanTaskRead(BaseModel):
    id: str
    workflow_run_id: str = Field(serialization_alias="workflowRunId")
    node_run_id: str = Field(serialization_alias="nodeRunId")
    human_node_id: str = Field(serialization_alias="humanNodeId")
    source_node_id: str = Field(serialization_alias="sourceNodeId")
    artifact_version_id: str = Field(serialization_alias="artifactVersionId")
    title: str
    status: str
    assignment_type: str = Field(serialization_alias="assignmentType")
    assignee_reviewer_id: str | None = Field(serialization_alias="assigneeReviewerId")
    assignee_group_id: str | None = Field(serialization_alias="assigneeGroupId")
    review_policy: str = Field(serialization_alias="reviewPolicy")
    required_approvals: int = Field(serialization_alias="requiredApprovals")
    participant_snapshot: list[str] = Field(serialization_alias="participantSnapshot")
    due_at: datetime = Field(serialization_alias="dueAt")
    escalation_at: datetime = Field(serialization_alias="escalationAt")
    sla_status: str = Field(serialization_alias="slaStatus")
    escalation_group_id: str | None = Field(serialization_alias="escalationGroupId")
    created_at: datetime = Field(serialization_alias="createdAt")
    updated_at: datetime = Field(serialization_alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ArtifactVersionSummary(BaseModel):
    id: str
    version: int
    content: str
    created_by: str = Field(serialization_alias="createdBy")
    created_at: datetime = Field(serialization_alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class HumanTaskRunSummary(BaseModel):
    id: str
    name: str
    status: str
    current_node: str = Field(serialization_alias="currentNode")
    score: int | None

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ApprovalProgress(BaseModel):
    required: int
    received: int


class AuditEventRead(BaseModel):
    id: str
    event_type: str = Field(serialization_alias="eventType")
    actor_id: str = Field(serialization_alias="actorId")
    reason: str
    before_status: str = Field(serialization_alias="beforeStatus")
    after_status: str = Field(serialization_alias="afterStatus")
    payload: dict
    created_at: datetime = Field(serialization_alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class NotificationOutboxRead(BaseModel):
    id: str
    event_type: str = Field(serialization_alias="eventType")
    recipient_type: str = Field(serialization_alias="recipientType")
    recipient_id: str = Field(serialization_alias="recipientId")
    payload: dict
    status: str
    created_at: datetime = Field(serialization_alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class HumanTaskDetailRead(HumanTaskRead):
    artifact: ArtifactVersionSummary
    run: HumanTaskRunSummary
    approval_progress: ApprovalProgress = Field(serialization_alias="approvalProgress")
    audit_events: list[AuditEventRead] = Field(serialization_alias="auditEvents")
    notifications: list[NotificationOutboxRead]


class ReviewerRead(BaseModel):
    id: str
    name: str
    role: str
    is_expert: bool = Field(serialization_alias="isExpert")
    is_active: bool = Field(serialization_alias="isActive")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ReviewGroupRead(BaseModel):
    id: str
    name: str
    assignment_mode: str = Field(serialization_alias="assignmentMode")
    is_escalation_group: bool = Field(serialization_alias="isEscalationGroup")
    members: list[ReviewerRead]

    model_config = ConfigDict(populate_by_name=True)


class HumanTaskClaim(BaseModel):
    reviewer_id: str = Field(alias="reviewerId")

    model_config = ConfigDict(populate_by_name=True)


class HumanTaskTransfer(BaseModel):
    actor_id: str = Field(alias="actorId")
    reviewer_id: str | None = Field(default=None, alias="reviewerId")
    group_id: str | None = Field(default=None, alias="groupId")
    reason: str = Field(min_length=1, max_length=1000)

    model_config = ConfigDict(populate_by_name=True)


class HumanTaskDecisionCreate(BaseModel):
    reviewer_id: str = Field(alias="reviewerId")
    decision: Literal["approve", "reject", "modify_and_approve", "return_for_rerun"]
    reason: str = Field(min_length=1, max_length=4000)
    artifact_version_id: str = Field(alias="artifactVersionId")
    idempotency_key: str = Field(alias="idempotencyKey", min_length=1, max_length=160)
    modified_content: str | None = Field(default=None, alias="modifiedContent")
    tags: list[str] = Field(default_factory=list)

    model_config = ConfigDict(populate_by_name=True)


class FeedbackCandidateRead(BaseModel):
    id: str
    human_task_id: str = Field(serialization_alias="humanTaskId")
    original_version_id: str = Field(serialization_alias="originalVersionId")
    modified_version_id: str = Field(serialization_alias="modifiedVersionId")
    original_content: str = Field(serialization_alias="originalContent")
    modified_content: str = Field(serialization_alias="modifiedContent")
    unified_diff: str = Field(serialization_alias="unifiedDiff")
    reason: str
    tags: list[str]
    workflow_run_id: str = Field(serialization_alias="workflowRunId")
    workflow_id: str | None = Field(serialization_alias="workflowId")
    agent_id: str | None = Field(serialization_alias="agentId")
    source_node_id: str = Field(serialization_alias="sourceNodeId")
    created_by: str = Field(serialization_alias="createdBy")
    status: str
    created_at: datetime = Field(serialization_alias="createdAt")
    confirmed_at: datetime | None = Field(serialization_alias="confirmedAt")

    model_config = ConfigDict(populate_by_name=True)


class GoldenSampleConfirm(BaseModel):
    reviewer_id: str = Field(alias="reviewerId")
    reason: str = Field(min_length=1, max_length=4000)
    idempotency_key: str = Field(alias="idempotencyKey", min_length=1, max_length=160)

    model_config = ConfigDict(populate_by_name=True)


class GoldenSampleRead(BaseModel):
    id: str
    candidate_id: str = Field(serialization_alias="candidateId")
    input_text: str = Field(serialization_alias="input")
    expected_output: str = Field(serialization_alias="expectedOutput")
    reviewer_id: str = Field(serialization_alias="reviewerId")
    reason: str
    created_at: datetime = Field(serialization_alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
