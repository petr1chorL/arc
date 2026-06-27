from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class JudgeGatewayResult:
    dimension_scores: list[dict]
    score: int
    status: str
    rationale: str
    model: str
    input_snapshot: dict


class JudgeGateway(Protocol):
    def evaluate(
        self,
        *,
        rubric_snapshot: dict,
        rubric_version: str,
        artifact_text: str,
        subject_type: str,
        subject_id: str | None,
    ) -> JudgeGatewayResult:
        pass


class DisabledJudgeGateway:
    def evaluate(
        self,
        *,
        rubric_snapshot: dict,
        rubric_version: str,
        artifact_text: str,
        subject_type: str,
        subject_id: str | None,
    ) -> JudgeGatewayResult:
        raise RuntimeError("LLM Judge 网关未配置")
