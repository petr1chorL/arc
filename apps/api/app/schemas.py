from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


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

    model_config = ConfigDict(from_attributes=True)


class VersionRead(BaseModel):
    id: str
    version: str
    snapshot: dict
    created_at: datetime = Field(serialization_alias="createdAt")

    model_config = ConfigDict(from_attributes=True)


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

    model_config = ConfigDict(from_attributes=True)


class ValidationResult(BaseModel):
    valid: bool
    errors: list[str]
