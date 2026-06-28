from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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


class ReviewerQualificationUpdate(BaseModel):
    role: str = Field(min_length=1, max_length=80)
    is_expert: bool = Field(default=False, alias="isExpert")

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("role")
    @classmethod
    def reject_blank_role(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("role cannot be blank")
        return normalized


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


class PermissionCapabilityRead(BaseModel):
    key: str
    label: str
    required_role: WorkspaceRole = Field(alias="requiredRole")

    model_config = ConfigDict(populate_by_name=True)


class RolePermissionRead(BaseModel):
    role: WorkspaceRole
    capabilities: dict[str, bool]


class WorkspacePermissionMatrixRead(BaseModel):
    roles: list[WorkspaceRole]
    capabilities: list[PermissionCapabilityRead]
    matrix: list[RolePermissionRead]
    reviewer_qualification_note: str = Field(alias="reviewerQualificationNote")

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
    model_provider_id: str | None = Field(default=None, alias="modelProviderId", max_length=36)
    model_provider: str = Field(
        default="openai-compatible",
        alias="modelProvider",
        max_length=80,
    )
    model_base_url: str = Field(default="", alias="modelBaseUrl", max_length=500)
    temperature: float = Field(default=0.2, ge=0, le=2)
    max_output_tokens: int = Field(default=2000, alias="maxOutputTokens", ge=1, le=200000)

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("name", "role", "owner", "model", "model_provider")
    @classmethod
    def reject_blank_values(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("字段不能为空")
        return normalized

    @field_validator("model_base_url")
    @classmethod
    def strip_optional_model_base_url(cls, value: str) -> str:
        return value.strip()


class AgentUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    role: str | None = Field(default=None, max_length=240)
    owner: str | None = Field(default=None, max_length=80)
    model: str | None = Field(default=None, max_length=80)
    model_provider_id: str | None = Field(default=None, alias="modelProviderId", max_length=36)
    model_provider: str | None = Field(default=None, alias="modelProvider", max_length=80)
    model_base_url: str | None = Field(default=None, alias="modelBaseUrl", max_length=500)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_output_tokens: int | None = Field(
        default=None,
        alias="maxOutputTokens",
        ge=1,
        le=200000,
    )
    system_prompt: str | None = Field(default=None, alias="systemPrompt", max_length=20000)
    tools: list[str] | None = None
    skills: list[str] | None = None

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("name", "role", "owner", "model", "model_provider", "model_provider_id")
    @classmethod
    def reject_blank_values(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = value.strip()
        if not normalized:
            raise ValueError("字段不能为空")
        return normalized

    @field_validator("model_base_url")
    @classmethod
    def strip_optional_model_base_url(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return value.strip()


class AgentAssetRefRead(BaseModel):
    asset_id: str = Field(validation_alias="assetId", serialization_alias="assetId")
    asset_type: str = Field(validation_alias="assetType", serialization_alias="assetType")
    asset_name: str = Field(validation_alias="assetName", serialization_alias="assetName")
    status: str
    adapter_type: str = Field(validation_alias="adapterType", serialization_alias="adapterType")

    model_config = ConfigDict(populate_by_name=True)


class AgentRead(BaseModel):
    id: str
    name: str
    role: str
    owner: str
    model: str
    model_provider_id: str | None = Field(serialization_alias="modelProviderId")
    model_provider: str = Field(serialization_alias="modelProvider")
    model_base_url: str = Field(serialization_alias="modelBaseUrl")
    temperature: float
    max_output_tokens: int = Field(serialization_alias="maxOutputTokens")
    status: str
    version: str
    pass_rate: float = Field(serialization_alias="passRate")
    runs: int
    tools: list[str]
    skills: list[str]
    tool_asset_refs: list[AgentAssetRefRead] = Field(
        default_factory=list,
        serialization_alias="toolAssetRefs",
    )
    skill_asset_refs: list[AgentAssetRefRead] = Field(
        default_factory=list,
        serialization_alias="skillAssetRefs",
    )
    system_prompt: str = Field(serialization_alias="systemPrompt")
    created_at: datetime = Field(serialization_alias="createdAt")
    updated_at: datetime = Field(serialization_alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


ToolSkillAssetType = Literal["tool", "skill"]
ToolSkillAdapterType = Literal["manual", "http", "mcp"]


class ToolSkillAssetCreate(BaseModel):
    asset_type: ToolSkillAssetType = Field(alias="assetType")
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    parameter_schema: dict = Field(default_factory=dict, alias="parameterSchema")
    adapter_type: ToolSkillAdapterType = Field(default="manual", alias="adapterType")
    adapter_config: dict = Field(default_factory=dict, alias="adapterConfig")

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("name")
    @classmethod
    def reject_blank_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("资产名称不能为空")
        return normalized


class ToolSkillAssetUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    parameter_schema: dict | None = Field(default=None, alias="parameterSchema")
    adapter_type: ToolSkillAdapterType | None = Field(default=None, alias="adapterType")
    adapter_config: dict | None = Field(default=None, alias="adapterConfig")

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("name")
    @classmethod
    def reject_blank_update_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = value.strip()
        if not normalized:
            raise ValueError("资产名称不能为空")
        return normalized


class ToolSkillAssetRead(BaseModel):
    id: str
    asset_type: ToolSkillAssetType = Field(serialization_alias="assetType")
    name: str
    description: str
    parameter_schema: dict = Field(serialization_alias="parameterSchema")
    adapter_type: ToolSkillAdapterType = Field(serialization_alias="adapterType")
    adapter_config: dict = Field(serialization_alias="adapterConfig")
    status: str
    created_by: str = Field(serialization_alias="createdBy")
    created_at: datetime = Field(serialization_alias="createdAt")
    updated_at: datetime = Field(serialization_alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ToolSkillAssetDraftAgentImpactRead(BaseModel):
    agent_id: str = Field(serialization_alias="agentId")
    agent_name: str = Field(serialization_alias="agentName")
    status: str
    version: str

    model_config = ConfigDict(populate_by_name=True)


class ToolSkillAssetVersionImpactRead(BaseModel):
    agent_id: str = Field(serialization_alias="agentId")
    agent_name: str = Field(serialization_alias="agentName")
    version_id: str = Field(serialization_alias="versionId")
    version: str

    model_config = ConfigDict(populate_by_name=True)


class ToolSkillAssetImpactTotalsRead(BaseModel):
    draft_agents: int = Field(serialization_alias="draftAgents")
    published_versions: int = Field(serialization_alias="publishedVersions")

    model_config = ConfigDict(populate_by_name=True)


class ToolSkillAssetImpactRead(BaseModel):
    asset_id: str = Field(serialization_alias="assetId")
    asset_type: ToolSkillAssetType = Field(serialization_alias="assetType")
    asset_name: str = Field(serialization_alias="assetName")
    totals: ToolSkillAssetImpactTotalsRead
    draft_agents: list[ToolSkillAssetDraftAgentImpactRead] = Field(serialization_alias="draftAgents")
    published_versions: list[ToolSkillAssetVersionImpactRead] = Field(serialization_alias="publishedVersions")

    model_config = ConfigDict(populate_by_name=True)


class ToolSkillTestInvocationCreate(BaseModel):
    parameters: dict = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")


class ToolSkillAssetInvocationRead(BaseModel):
    id: str
    asset_id: str = Field(serialization_alias="assetId")
    asset_type: ToolSkillAssetType = Field(serialization_alias="assetType")
    asset_name: str = Field(serialization_alias="assetName")
    agent_id: str | None = Field(serialization_alias="agentId")
    agent_version: str = Field(serialization_alias="agentVersion")
    run_id: str | None = Field(serialization_alias="runId")
    node_run_id: str | None = Field(serialization_alias="nodeRunId")
    status: str
    input_summary: str = Field(serialization_alias="inputSummary")
    output_summary: str = Field(serialization_alias="outputSummary")
    error: str
    duration_ms: int = Field(serialization_alias="durationMs")
    created_at: datetime = Field(serialization_alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ToolSkillAssetAuditEventRead(BaseModel):
    id: str
    event_type: str = Field(serialization_alias="eventType")
    target_type: str = Field(serialization_alias="targetType")
    target_id: str = Field(serialization_alias="targetId")
    outcome: str
    reason: str
    actor_id: str | None = Field(serialization_alias="actorId")
    created_at: datetime = Field(serialization_alias="createdAt")
    metadata: dict

    model_config = ConfigDict(populate_by_name=True)


class WorkspaceAuditEventRead(BaseModel):
    id: str
    action: str
    target_type: str | None = Field(serialization_alias="targetType")
    target_id: str | None = Field(serialization_alias="targetId")
    outcome: str
    reason: str
    actor_id: str | None = Field(serialization_alias="actorId")
    request_id: str | None = Field(serialization_alias="requestId")
    trace_id: str = Field(serialization_alias="traceId")
    span_id: str | None = Field(serialization_alias="spanId")
    created_at: datetime = Field(serialization_alias="createdAt")
    metadata: dict

    model_config = ConfigDict(populate_by_name=True)


class ModelProviderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    provider_type: Literal["openai-compatible", "anthropic-compatible"] = Field(
        default="openai-compatible",
        alias="providerType",
    )
    base_url: str = Field(alias="baseUrl", min_length=1, max_length=500)
    default_model: str = Field(alias="defaultModel", min_length=1, max_length=120)
    secret_ref: str = Field(alias="secretRef", min_length=1, max_length=160)

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    @field_validator("name", "base_url", "default_model", "secret_ref")
    @classmethod
    def reject_blank_provider_values(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("字段不能为空")
        return normalized


class ModelProviderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    provider_type: Literal["openai-compatible", "anthropic-compatible"] | None = Field(
        default=None,
        alias="providerType",
    )
    base_url: str | None = Field(default=None, alias="baseUrl", min_length=1, max_length=500)
    default_model: str | None = Field(default=None, alias="defaultModel", min_length=1, max_length=120)
    secret_ref: str | None = Field(default=None, alias="secretRef", min_length=1, max_length=160)

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    @field_validator("name", "base_url", "default_model", "secret_ref")
    @classmethod
    def reject_blank_provider_values(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = value.strip()
        if not normalized:
            raise ValueError("字段不能为空")
        return normalized


class ModelProviderRead(BaseModel):
    id: str
    name: str
    provider_type: str = Field(serialization_alias="providerType")
    base_url: str = Field(serialization_alias="baseUrl")
    default_model: str = Field(serialization_alias="defaultModel")
    secret_ref: str = Field(serialization_alias="secretRef")
    status: str
    created_by: str = Field(serialization_alias="createdBy")
    created_at: datetime = Field(serialization_alias="createdAt")
    updated_at: datetime = Field(serialization_alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ModelProviderConnectivityRead(BaseModel):
    provider_id: str = Field(serialization_alias="providerId")
    status: Literal["ready", "missing_secret"]
    message: str

    model_config = ConfigDict(populate_by_name=True)


class ModelProviderDraftAgentImpactRead(BaseModel):
    agent_id: str = Field(serialization_alias="agentId")
    agent_name: str = Field(serialization_alias="agentName")
    status: str
    version: str

    model_config = ConfigDict(populate_by_name=True)


class ModelProviderVersionImpactRead(BaseModel):
    agent_id: str = Field(serialization_alias="agentId")
    agent_name: str = Field(serialization_alias="agentName")
    version_id: str = Field(serialization_alias="versionId")
    version: str
    model_secret_ref: str = Field(serialization_alias="modelSecretRef")

    model_config = ConfigDict(populate_by_name=True)


class ModelProviderImpactTotalsRead(BaseModel):
    draft_agents: int = Field(serialization_alias="draftAgents")
    published_versions: int = Field(serialization_alias="publishedVersions")

    model_config = ConfigDict(populate_by_name=True)


class ModelProviderImpactRead(BaseModel):
    provider_id: str = Field(serialization_alias="providerId")
    totals: ModelProviderImpactTotalsRead
    draft_agents: list[ModelProviderDraftAgentImpactRead] = Field(serialization_alias="draftAgents")
    published_versions: list[ModelProviderVersionImpactRead] = Field(serialization_alias="publishedVersions")

    model_config = ConfigDict(populate_by_name=True)


class ModelProviderDraftMigrationCreate(BaseModel):
    target_provider_id: str = Field(alias="targetProviderId", min_length=1, max_length=36)
    reason: str = Field(min_length=1, max_length=1000)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("target_provider_id", "reason")
    @classmethod
    def reject_blank_migration_values(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("字段不能为空")
        return normalized


class ModelProviderMigratedAgentRead(BaseModel):
    agent_id: str = Field(serialization_alias="agentId")
    agent_name: str = Field(serialization_alias="agentName")
    previous_model: str = Field(serialization_alias="previousModel")
    next_model: str = Field(serialization_alias="nextModel")

    model_config = ConfigDict(populate_by_name=True)


class ModelProviderDraftMigrationRead(BaseModel):
    source_provider_id: str = Field(serialization_alias="sourceProviderId")
    target_provider_id: str = Field(serialization_alias="targetProviderId")
    migrated_count: int = Field(serialization_alias="migratedCount")
    migrated_agents: list[ModelProviderMigratedAgentRead] = Field(serialization_alias="migratedAgents")

    model_config = ConfigDict(populate_by_name=True)


class ModelProviderAuditEventRead(BaseModel):
    id: str
    event_type: str = Field(serialization_alias="eventType")
    target_type: str = Field(serialization_alias="targetType")
    target_id: str = Field(serialization_alias="targetId")
    outcome: str
    reason: str
    actor_id: str | None = Field(serialization_alias="actorId")
    created_at: datetime = Field(serialization_alias="createdAt")
    metadata: dict

    model_config = ConfigDict(populate_by_name=True)


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
    async_mode: bool = Field(default=False, alias="asyncMode")

    model_config = ConfigDict(populate_by_name=True)


class RunRerunRequest(BaseModel):
    input: str | None = Field(default=None, max_length=50000)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("input")
    @classmethod
    def reject_blank_input(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = value.strip()
        if not normalized:
            raise ValueError("重跑输入不能为空")
        return normalized


class RunBatchRerunRequest(BaseModel):
    run_ids: list[str] = Field(alias="runIds", min_length=1, max_length=20)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("run_ids")
    @classmethod
    def reject_duplicate_run_ids(cls, value: list[str]) -> list[str]:
        normalized = [run_id.strip() for run_id in value]
        if any(not run_id for run_id in normalized):
            raise ValueError("runIds 不能为空")
        if len(set(normalized)) != len(normalized):
            raise ValueError("runIds 不能重复")
        return normalized


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


class RunBatchRerunFailureRead(BaseModel):
    source_run_id: str = Field(serialization_alias="sourceRunId")
    reason: str

    model_config = ConfigDict(populate_by_name=True)


class RunBatchRerunRead(BaseModel):
    created_runs: list[RunRead] = Field(serialization_alias="createdRuns")
    failures: list[RunBatchRerunFailureRead] = Field(default_factory=list)

    model_config = ConfigDict(populate_by_name=True)


class RunBatchResumeRequest(BaseModel):
    run_ids: list[str] = Field(alias="runIds", min_length=1, max_length=20)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("run_ids")
    @classmethod
    def reject_duplicate_run_ids(cls, value: list[str]) -> list[str]:
        normalized = [run_id.strip() for run_id in value]
        if any(not run_id for run_id in normalized):
            raise ValueError("runIds 涓嶈兘涓虹┖")
        if len(set(normalized)) != len(normalized):
            raise ValueError("runIds 涓嶈兘閲嶅")
        return normalized


class RunBatchResumeFailureRead(BaseModel):
    source_run_id: str = Field(serialization_alias="sourceRunId")
    reason: str

    model_config = ConfigDict(populate_by_name=True)


class RunBatchResumeRead(BaseModel):
    resumed_runs: list[RunRead] = Field(serialization_alias="resumedRuns")
    failures: list[RunBatchResumeFailureRead] = Field(default_factory=list)

    model_config = ConfigDict(populate_by_name=True)


class RunOperationHistoryEventRead(BaseModel):
    id: str
    action: str
    target_type: str | None = Field(serialization_alias="targetType")
    target_id: str | None = Field(serialization_alias="targetId")
    outcome: str
    reason: str
    actor_id: str | None = Field(serialization_alias="actorId")
    request_id: str | None = Field(serialization_alias="requestId")
    created_at: datetime = Field(serialization_alias="createdAt")
    metadata: dict

    model_config = ConfigDict(populate_by_name=True)


class ExecutionJobRead(BaseModel):
    id: str
    workspace_id: str | None = Field(serialization_alias="workspaceId")
    run_id: str = Field(serialization_alias="runId")
    workflow_id: str | None = Field(serialization_alias="workflowId")
    workflow_version: str | None = Field(serialization_alias="workflowVersion")
    job_type: str = Field(serialization_alias="jobType")
    status: str
    input_text: str = Field(serialization_alias="input")
    attempts: int
    max_attempts: int = Field(serialization_alias="maxAttempts")
    error: str
    created_by: str = Field(serialization_alias="createdBy")
    locked_by: str = Field(serialization_alias="lockedBy")
    locked_until: datetime | None = Field(serialization_alias="lockedUntil")
    last_heartbeat_at: datetime | None = Field(serialization_alias="lastHeartbeatAt")
    next_attempt_at: datetime | None = Field(serialization_alias="nextAttemptAt")
    created_at: datetime = Field(serialization_alias="createdAt")
    started_at: datetime | None = Field(serialization_alias="startedAt")
    completed_at: datetime | None = Field(serialization_alias="completedAt")
    dead_lettered_at: datetime | None = Field(serialization_alias="deadLetteredAt")
    canceled_at: datetime | None = Field(serialization_alias="canceledAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ExecutionJobOperationRequest(BaseModel):
    reason: str = Field(default="", max_length=1000)

    model_config = ConfigDict(extra="forbid")

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str) -> str:
        return value.strip()


class ExecutionJobAuditEventRead(BaseModel):
    id: str
    action: str | None
    outcome: str | None
    reason: str
    before_status: str = Field(serialization_alias="beforeStatus")
    after_status: str = Field(serialization_alias="afterStatus")
    payload: dict
    actor_user_id: str | None = Field(serialization_alias="actorUserId")
    request_id: str | None = Field(serialization_alias="requestId")
    created_at: datetime = Field(serialization_alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ExecutionJobDetailRead(ExecutionJobRead):
    audit_events: list[ExecutionJobAuditEventRead] = Field(serialization_alias="auditEvents")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ObservabilityTotalsRead(BaseModel):
    runs: int
    succeeded: int
    failed: int
    waiting_for_human: int = Field(serialization_alias="waitingForHuman")
    resume_failed: int = Field(serialization_alias="resumeFailed")
    average_duration_ms: int | None = Field(serialization_alias="averageDurationMs")
    total_prompt_tokens: int = Field(serialization_alias="totalPromptTokens")
    total_completion_tokens: int = Field(serialization_alias="totalCompletionTokens")
    total_cost_usd: float = Field(serialization_alias="totalCostUsd")

    model_config = ConfigDict(populate_by_name=True)


class ObservabilityRunSummaryRead(BaseModel):
    id: str
    trace_id: str = Field(serialization_alias="traceId")
    workflow_name: str = Field(serialization_alias="workflowName")
    status: str
    current_node: str = Field(serialization_alias="currentNode")
    started_at: datetime = Field(serialization_alias="startedAt")
    completed_at: datetime | None = Field(serialization_alias="completedAt")
    duration_ms: int | None = Field(serialization_alias="durationMs")
    score: int | None
    cost_usd: float = Field(serialization_alias="costUsd")
    prompt_tokens: int = Field(serialization_alias="promptTokens")
    completion_tokens: int = Field(serialization_alias="completionTokens")
    priority: Literal["critical", "warning", "normal"]
    next_action: str = Field(serialization_alias="nextAction")
    failure_category: str = Field(serialization_alias="failureCategory")
    failure_category_label: str = Field(serialization_alias="failureCategoryLabel")
    troubleshooting_hint: str = Field(serialization_alias="troubleshootingHint")

    model_config = ConfigDict(populate_by_name=True)


class ObservabilityRiskRead(BaseModel):
    run_id: str = Field(serialization_alias="runId")
    title: str
    severity: Literal["critical", "warning"]
    message: str
    next_action: str = Field(serialization_alias="nextAction")

    model_config = ConfigDict(populate_by_name=True)


class ObservabilityAlertRead(BaseModel):
    id: str
    event_key: str = Field(serialization_alias="eventKey")
    event_type: str = Field(serialization_alias="eventType")
    severity: Literal["critical", "warning"]
    channel: str
    status: str
    title: str
    message: str
    run_id: str | None = Field(serialization_alias="runId")
    human_task_id: str | None = Field(serialization_alias="humanTaskId")
    next_action: str = Field(serialization_alias="nextAction")
    created_at: datetime = Field(serialization_alias="createdAt")

    model_config = ConfigDict(populate_by_name=True)


class ObservabilityOverviewRead(BaseModel):
    totals: ObservabilityTotalsRead
    risks: list[ObservabilityRiskRead]
    alerts: list[ObservabilityAlertRead]
    recent_runs: list[ObservabilityRunSummaryRead] = Field(serialization_alias="recentRuns")

    model_config = ConfigDict(populate_by_name=True)


class ObservabilityNodeRunRead(BaseModel):
    id: str
    trace_id: str = Field(serialization_alias="traceId")
    span_id: str = Field(serialization_alias="spanId")
    parent_span_id: str | None = Field(serialization_alias="parentSpanId")
    node_id: str = Field(serialization_alias="nodeId")
    node_type: str = Field(serialization_alias="nodeType")
    node_name: str = Field(serialization_alias="nodeName")
    status: str
    duration_ms: int = Field(serialization_alias="durationMs")
    attempts: int
    score: int | None
    model: str
    prompt_tokens: int = Field(serialization_alias="promptTokens")
    completion_tokens: int = Field(serialization_alias="completionTokens")
    cost_usd: float = Field(serialization_alias="costUsd")
    error: str
    started_at: datetime = Field(serialization_alias="startedAt")
    completed_at: datetime | None = Field(serialization_alias="completedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ObservabilityHumanTaskRead(BaseModel):
    id: str
    title: str
    status: str
    sla_status: str = Field(serialization_alias="slaStatus")
    assignee_reviewer_id: str | None = Field(serialization_alias="assigneeReviewerId")
    assignee_group_id: str | None = Field(serialization_alias="assigneeGroupId")
    due_at: datetime = Field(serialization_alias="dueAt")
    escalation_at: datetime = Field(serialization_alias="escalationAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ObservabilityAuditEventRead(BaseModel):
    id: str
    trace_id: str = Field(serialization_alias="traceId")
    span_id: str | None = Field(serialization_alias="spanId")
    event_type: str | None = Field(serialization_alias="eventType")
    actor_id: str | None = Field(serialization_alias="actorId")
    outcome: str | None
    reason: str
    created_at: datetime = Field(serialization_alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ObservabilityExecutionEventRead(BaseModel):
    id: str
    type: str
    title: str
    status: str | None
    trace_id: str = Field(serialization_alias="traceId")
    span_id: str | None = Field(serialization_alias="spanId")
    source_type: Literal[
        "workflow_run",
        "node_run",
        "human_task",
        "audit_event",
        "tool_skill_invocation",
        "remediation_task",
        "remediation_activity",
        "regression_run",
    ] = Field(
        serialization_alias="sourceType",
    )
    source_id: str = Field(serialization_alias="sourceId")
    occurred_at: datetime = Field(serialization_alias="occurredAt")
    summary: str

    model_config = ConfigDict(populate_by_name=True)


class ObservabilityRunDetailRead(ObservabilityRunSummaryRead):
    nodes: list[ObservabilityNodeRunRead]
    human_tasks: list[ObservabilityHumanTaskRead] = Field(serialization_alias="humanTasks")
    audit_events: list[ObservabilityAuditEventRead] = Field(serialization_alias="auditEvents")
    execution_events: list[ObservabilityExecutionEventRead] = Field(serialization_alias="executionEvents")

    model_config = ConfigDict(populate_by_name=True)


class ObservabilityHumanSlaTotalsRead(BaseModel):
    active_tasks: int = Field(serialization_alias="activeTasks")
    unclaimed: int
    in_review: int = Field(serialization_alias="inReview")
    due_soon: int = Field(serialization_alias="dueSoon")
    overdue: int
    escalated: int
    resume_failed: int = Field(serialization_alias="resumeFailed")

    model_config = ConfigDict(populate_by_name=True)


class ObservabilityHumanSlaRiskRead(BaseModel):
    task_id: str = Field(serialization_alias="taskId")
    run_id: str = Field(serialization_alias="runId")
    title: str
    status: str
    sla_status: str = Field(serialization_alias="slaStatus")
    severity: Literal["critical", "warning"]
    assignee_reviewer_id: str | None = Field(serialization_alias="assigneeReviewerId")
    assignee_group_id: str | None = Field(serialization_alias="assigneeGroupId")
    due_at: datetime = Field(serialization_alias="dueAt")
    escalation_at: datetime = Field(serialization_alias="escalationAt")
    next_action: str = Field(serialization_alias="nextAction")

    model_config = ConfigDict(populate_by_name=True)


class ObservabilityHumanSlaReviewerRead(BaseModel):
    id: str
    name: str


class ObservabilityHumanSlaGroupRead(BaseModel):
    id: str
    name: str


class ObservabilityHumanSlaOverviewRead(BaseModel):
    totals: ObservabilityHumanSlaTotalsRead
    risks: list[ObservabilityHumanSlaRiskRead]
    reviewers: list[ObservabilityHumanSlaReviewerRead]
    groups: list[ObservabilityHumanSlaGroupRead]

    model_config = ConfigDict(populate_by_name=True)


class ObservabilityCostUsageTotalsRead(BaseModel):
    runs: int
    total_prompt_tokens: int = Field(serialization_alias="totalPromptTokens")
    total_completion_tokens: int = Field(serialization_alias="totalCompletionTokens")
    total_tokens: int = Field(serialization_alias="totalTokens")
    total_cost_usd: float = Field(serialization_alias="totalCostUsd")

    model_config = ConfigDict(populate_by_name=True)


class ObservabilityCostUsageGroupRead(BaseModel):
    name: str
    runs: int
    prompt_tokens: int = Field(serialization_alias="promptTokens")
    completion_tokens: int = Field(serialization_alias="completionTokens")
    total_tokens: int = Field(serialization_alias="totalTokens")
    cost_usd: float = Field(serialization_alias="costUsd")
    average_score: int | None = Field(serialization_alias="averageScore")

    model_config = ConfigDict(populate_by_name=True)


class ObservabilityCostUsageRead(BaseModel):
    cost_configured: bool = Field(serialization_alias="costConfigured")
    totals: ObservabilityCostUsageTotalsRead
    by_workflow: list[ObservabilityCostUsageGroupRead] = Field(serialization_alias="byWorkflow")
    by_model: list[ObservabilityCostUsageGroupRead] = Field(serialization_alias="byModel")

    model_config = ConfigDict(populate_by_name=True)


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
    user_id: str | None = Field(default=None, serialization_alias="userId")
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
    model_config = ConfigDict(extra="forbid")


class HumanTaskTransfer(BaseModel):
    target_reviewer_id: str | None = Field(default=None, alias="targetReviewerId")
    group_id: str | None = Field(default=None, alias="groupId")
    reason: str = Field(min_length=1, max_length=1000)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class HumanTaskDecisionCreate(BaseModel):
    decision: Literal["approve", "reject", "modify_and_approve", "return_for_rerun"]
    reason: str = Field(min_length=1, max_length=4000)
    artifact_version_id: str = Field(alias="artifactVersionId")
    idempotency_key: str = Field(alias="idempotencyKey", min_length=1, max_length=160)
    modified_content: str | None = Field(default=None, alias="modifiedContent")
    tags: list[str] = Field(default_factory=list)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


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
    reason: str = Field(min_length=1, max_length=4000)
    idempotency_key: str = Field(alias="idempotencyKey", min_length=1, max_length=160)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class GoldenSampleRead(BaseModel):
    id: str
    candidate_id: str = Field(serialization_alias="candidateId")
    input_text: str = Field(serialization_alias="input")
    expected_output: str = Field(serialization_alias="expectedOutput")
    reviewer_id: str = Field(serialization_alias="reviewerId")
    reason: str
    created_at: datetime = Field(serialization_alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class RegressionSampleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    input_text: str = Field(alias="input", min_length=1, max_length=20000)
    expected_output: str = Field(alias="expectedOutput", min_length=1, max_length=20000)
    tags: list[str] = Field(default_factory=list, max_length=20)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("name", "input_text", "expected_output")
    @classmethod
    def reject_blank_sample_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("field cannot be blank")
        return normalized

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        for tag in value:
            cleaned = tag.strip()
            if cleaned and cleaned not in normalized:
                normalized.append(cleaned[:40])
        return normalized


class RegressionSampleRead(BaseModel):
    id: str
    sample_set_id: str = Field(serialization_alias="sampleSetId")
    name: str
    input_text: str = Field(serialization_alias="input")
    expected_output: str = Field(serialization_alias="expectedOutput")
    tags: list[str]
    source_type: str = Field(serialization_alias="sourceType")
    source_id: str | None = Field(serialization_alias="sourceId")
    status: str
    created_by: str = Field(serialization_alias="createdBy")
    created_at: datetime = Field(serialization_alias="createdAt")
    updated_at: datetime = Field(serialization_alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class RegressionSampleSetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=4000)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("name")
    @classmethod
    def reject_blank_set_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("name cannot be blank")
        return normalized

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str) -> str:
        return value.strip()


class RegressionSampleSetRead(BaseModel):
    id: str
    name: str
    description: str
    status: str
    sample_count: int = Field(serialization_alias="sampleCount")
    active_sample_count: int = Field(serialization_alias="activeSampleCount")
    samples: list[RegressionSampleRead]
    created_by: str = Field(serialization_alias="createdBy")
    created_at: datetime = Field(serialization_alias="createdAt")
    updated_at: datetime = Field(serialization_alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class RegressionRunSampleCreate(BaseModel):
    input_text: str = Field(alias="input", min_length=1, max_length=20000)
    sample_id: str | None = Field(default=None, alias="sampleId", max_length=120)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("input_text")
    @classmethod
    def reject_blank_run_sample(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("sample input cannot be blank")
        return normalized

    @field_validator("sample_id")
    @classmethod
    def normalize_run_sample_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class RegressionRunCreate(BaseModel):
    rubric_id: str = Field(alias="rubricId", min_length=1, max_length=36)
    sample_set_id: str | None = Field(default=None, alias="sampleSetId", max_length=36)
    samples: list[RegressionRunSampleCreate] = Field(default_factory=list, max_length=200)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @model_validator(mode="after")
    def require_samples_or_sample_set(self) -> "RegressionRunCreate":
        if self.sample_set_id is None and len(self.samples) == 0:
            raise ValueError("sampleSetId or samples is required")
        return self


class RegressionRunRead(BaseModel):
    id: str
    sample_set_id: str | None = Field(serialization_alias="sampleSetId")
    sample_set_name: str = Field(serialization_alias="sampleSetName")
    rubric_id: str = Field(serialization_alias="rubricId")
    rubric_name: str = Field(serialization_alias="rubricName")
    rubric_version: str = Field(serialization_alias="rubricVersion")
    status: str
    total_samples: int = Field(serialization_alias="totalSamples")
    passed_samples: int = Field(serialization_alias="passedSamples")
    failed_samples: int = Field(serialization_alias="failedSamples")
    pass_rate: int = Field(serialization_alias="passRate")
    evaluation_ids: list[str] = Field(serialization_alias="evaluationIds")
    records: list["EvaluationRecordRead"] = Field(default_factory=list)
    created_by: str = Field(serialization_alias="createdBy")
    created_at: datetime = Field(serialization_alias="createdAt")
    completed_at: datetime = Field(serialization_alias="completedAt")

    model_config = ConfigDict(populate_by_name=True)


class RemediationTaskCreate(BaseModel):
    source_run_id: str = Field(alias="sourceRunId", min_length=1, max_length=36)
    cluster_key: str = Field(alias="clusterKey", min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=200)
    priority: str = Field(pattern="^P[0-2]$")
    sample_ids: list[str] = Field(alias="sampleIds", min_length=1, max_length=20)
    action: str = Field(min_length=1, max_length=4000)
    owner: str | None = Field(default=None, max_length=120)
    due_date: datetime | None = Field(default=None, alias="dueDate")

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("source_run_id", "cluster_key", "title", "action")
    @classmethod
    def reject_blank_remediation_fields(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("field cannot be blank")
        return normalized

    @field_validator("owner")
    @classmethod
    def normalize_owner(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("sample_ids")
    @classmethod
    def normalize_sample_ids(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        for sample_id in value:
            cleaned = sample_id.strip()
            if cleaned and cleaned not in normalized:
                normalized.append(cleaned[:120])
        if not normalized:
            raise ValueError("sampleIds cannot be blank")
        return normalized


class RemediationTaskUpdate(BaseModel):
    status: str = Field(pattern="^(open|in_progress|done)$")

    model_config = ConfigDict(extra="forbid")


class RemediationTaskActivityCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    attachment_refs: list[str] = Field(default_factory=list, alias="attachmentRefs", max_length=10)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("body")
    @classmethod
    def reject_blank_body(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("body cannot be blank")
        return normalized

    @field_validator("attachment_refs")
    @classmethod
    def normalize_attachment_refs(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        for attachment_ref in value:
            cleaned = attachment_ref.strip()
            if cleaned and cleaned not in normalized:
                normalized.append(cleaned[:500])
        return normalized


class RemediationTaskActivityRead(BaseModel):
    id: str
    task_id: str = Field(serialization_alias="taskId")
    kind: str
    body: str
    attachment_refs: list[str] = Field(serialization_alias="attachmentRefs")
    actor_user_id: str = Field(serialization_alias="actorUserId")
    actor_display_name: str = Field(serialization_alias="actorDisplayName")
    created_at: datetime = Field(serialization_alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class RemediationTaskRead(BaseModel):
    id: str
    source_run_id: str = Field(serialization_alias="sourceRunId")
    cluster_key: str = Field(serialization_alias="clusterKey")
    title: str
    priority: str
    sample_ids: list[str] = Field(serialization_alias="sampleIds")
    action: str
    status: str
    owner: str | None = None
    due_date: datetime | None = Field(default=None, serialization_alias="dueDate")
    is_overdue: bool = Field(serialization_alias="isOverdue")
    retest_run_id: str | None = Field(default=None, serialization_alias="retestRunId")
    retest_run: RegressionRunRead | None = Field(default=None, serialization_alias="retestRun")
    activities: list[RemediationTaskActivityRead] = Field(default_factory=list)
    created_by: str = Field(serialization_alias="createdBy")
    updated_by: str = Field(serialization_alias="updatedBy")
    created_at: datetime = Field(serialization_alias="createdAt")
    updated_at: datetime = Field(serialization_alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class EvaluationOverviewTotalsRead(BaseModel):
    feedback_candidates: int = Field(serialization_alias="feedbackCandidates")
    pending_candidates: int = Field(serialization_alias="pendingCandidates")
    confirmed_candidates: int = Field(serialization_alias="confirmedCandidates")
    golden_samples: int = Field(serialization_alias="goldenSamples")
    covered_workflows: int = Field(serialization_alias="coveredWorkflows")
    covered_agents: int = Field(serialization_alias="coveredAgents")

    model_config = ConfigDict(populate_by_name=True)


class EvaluationFeedbackCandidateSummaryRead(BaseModel):
    id: str
    reason: str
    tags: list[str]
    workflow_id: str | None = Field(serialization_alias="workflowId")
    agent_id: str | None = Field(serialization_alias="agentId")
    source_node_id: str = Field(serialization_alias="sourceNodeId")
    created_by: str = Field(serialization_alias="createdBy")
    status: str
    created_at: datetime = Field(serialization_alias="createdAt")
    confirmed_at: datetime | None = Field(serialization_alias="confirmedAt")

    model_config = ConfigDict(populate_by_name=True)


class EvaluationOverviewRead(BaseModel):
    totals: EvaluationOverviewTotalsRead
    recent_candidates: list[EvaluationFeedbackCandidateSummaryRead] = Field(
        serialization_alias="recentCandidates",
    )

    model_config = ConfigDict(populate_by_name=True)


class RubricDimensionRead(BaseModel):
    name: str
    weight: int


class RubricDimensionWrite(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    weight: int = Field(ge=1, le=100)

    @field_validator("name")
    @classmethod
    def reject_blank_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("维度名称不能为空")
        return normalized


class RubricWrite(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    artifact: str = Field(min_length=1, max_length=160)
    dimensions: list[RubricDimensionWrite] = Field(min_length=1)
    gate: str = Field(min_length=1, max_length=4000)
    pass_score: int = Field(alias="passScore", ge=0, le=100)
    judge_type: Literal["deterministic", "llm"] = Field(default="deterministic", alias="judgeType")
    judge_model: str = Field(default="", alias="judgeModel", max_length=120)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("name", "artifact", "gate")
    @classmethod
    def reject_blank_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("字段不能为空")
        return normalized

    @model_validator(mode="after")
    def require_weight_total(self) -> "RubricWrite":
        total = sum(dimension.weight for dimension in self.dimensions)
        if total != 100:
            raise ValueError("维度权重合计必须等于 100")
        return self


class RubricRead(BaseModel):
    id: str
    name: str
    artifact: str
    dimensions: list[RubricDimensionRead]
    gate: str
    pass_score: int = Field(serialization_alias="passScore")
    judge_type: Literal["deterministic", "llm"] = Field(serialization_alias="judgeType")
    judge_model: str = Field(serialization_alias="judgeModel")
    version: str
    status: str

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class RubricVersionRead(BaseModel):
    id: str
    version: str
    snapshot: RubricRead
    created_at: datetime = Field(serialization_alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class EvaluationRunCreate(BaseModel):
    artifact_text: str = Field(alias="artifactText", min_length=1, max_length=20000)
    subject_type: str = Field(alias="subjectType", min_length=1, max_length=80)
    subject_id: str | None = Field(default=None, alias="subjectId", max_length=120)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("artifact_text", "subject_type")
    @classmethod
    def reject_blank_evaluation_fields(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("字段不能为空")
        return normalized

    @field_validator("subject_id")
    @classmethod
    def normalize_subject_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class EvaluationDimensionScoreRead(BaseModel):
    name: str
    weight: int
    score: int


class EvaluationRecordRead(BaseModel):
    id: str
    rubric_id: str = Field(serialization_alias="rubricId")
    rubric_version: str = Field(serialization_alias="rubricVersion")
    rubric_snapshot: RubricRead = Field(serialization_alias="rubricSnapshot")
    subject_type: str = Field(serialization_alias="subjectType")
    subject_id: str | None = Field(serialization_alias="subjectId")
    artifact_text: str = Field(serialization_alias="artifactText")
    dimension_scores: list[EvaluationDimensionScoreRead] = Field(serialization_alias="dimensionScores")
    score: int
    status: str
    rationale: str
    evaluator_type: str = Field(serialization_alias="evaluatorType")
    evaluator_model: str = Field(serialization_alias="evaluatorModel")
    evaluator_input: dict = Field(serialization_alias="evaluatorInput")
    created_at: datetime = Field(serialization_alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
