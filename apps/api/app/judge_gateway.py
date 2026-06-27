import json
from dataclasses import dataclass
from typing import Protocol

from app.model_gateway import ModelGateway


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


class ModelJudgeGateway:
    def __init__(self, gateway: ModelGateway):
        self.gateway = gateway

    def evaluate(
        self,
        *,
        rubric_snapshot: dict,
        rubric_version: str,
        artifact_text: str,
        subject_type: str,
        subject_id: str | None,
    ) -> JudgeGatewayResult:
        input_snapshot = {
            "rubricSnapshot": rubric_snapshot,
            "rubricVersion": rubric_version,
            "artifactText": artifact_text,
            "subjectType": subject_type,
            "subjectId": subject_id,
        }
        model_result = self.gateway.complete(
            system_prompt=self._system_prompt(),
            user_input=json.dumps(input_snapshot, ensure_ascii=False),
            model=str(rubric_snapshot.get("judgeModel") or ""),
        )
        payload = self._parse_payload(model_result.content)
        return JudgeGatewayResult(
            dimension_scores=payload["dimensionScores"],
            score=int(payload["score"]),
            status=str(payload["status"]),
            rationale=str(payload["rationale"]),
            model=model_result.model,
            input_snapshot=input_snapshot,
        )

    @staticmethod
    def _system_prompt() -> str:
        return (
            "You are an evaluation judge for enterprise AI workflow artifacts. "
            "Return JSON only with keys: dimensionScores, score, status, rationale. "
            "dimensionScores must contain name, weight, score. status must be passed or failed."
        )

    @staticmethod
    def _parse_payload(content: str) -> dict:
        try:
            payload = json.loads(content)
            dimension_scores = payload["dimensionScores"]
            score = int(payload["score"])
            status = str(payload["status"])
            rationale = str(payload["rationale"])
        except (json.JSONDecodeError, KeyError, TypeError, ValueError):
            raise RuntimeError("LLM Judge 返回格式无效") from None
        if status not in {"passed", "failed"}:
            raise RuntimeError("LLM Judge 返回状态无效")
        if score < 0 or score > 100:
            raise RuntimeError("LLM Judge 返回分数无效")
        if not isinstance(dimension_scores, list) or not dimension_scores:
            raise RuntimeError("LLM Judge 维度分无效")
        return {
            "dimensionScores": dimension_scores,
            "score": score,
            "status": status,
            "rationale": rationale,
        }
