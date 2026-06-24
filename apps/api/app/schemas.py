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
    created_at: datetime = Field(serialization_alias="createdAt")
    updated_at: datetime = Field(serialization_alias="updatedAt")

    model_config = ConfigDict(from_attributes=True)
