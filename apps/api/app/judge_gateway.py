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
    def __init__(self, gateway: ModelGateway, max_attempts: int = 2):
        self.gateway = gateway
        self.max_attempts = max(1, max_attempts)

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
        last_error: RuntimeError | None = None
        for _attempt in range(self.max_attempts):
            model_result = self.gateway.complete(
                system_prompt=self._system_prompt(),
                user_input=json.dumps(input_snapshot, ensure_ascii=False),
                model=str(rubric_snapshot.get("judgeModel") or ""),
            )
            try:
                payload = self._parse_payload(model_result.content)
            except RuntimeError as error:
                last_error = error
                continue
            return JudgeGatewayResult(
                dimension_scores=payload["dimensionScores"],
                score=int(payload["score"]),
                status=str(payload["status"]),
                rationale=str(payload["rationale"]),
                model=model_result.model,
                input_snapshot=input_snapshot,
            )
        if last_error:
            raise last_error
        raise RuntimeError("LLM Judge returned invalid JSON payload")

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
            dimension_scores = ModelJudgeGateway._parse_dimension_scores(payload["dimensionScores"])
            score = int(payload["score"])
            status = str(payload["status"])
            rationale = str(payload["rationale"])
        except (json.JSONDecodeError, KeyError, TypeError, ValueError):
            raise RuntimeError("LLM Judge 返回格式无效") from None
        if status not in {"passed", "failed"}:
            raise RuntimeError("LLM Judge 返回状态无效")
        if score < 0 or score > 100:
            raise RuntimeError("LLM Judge 返回分数无效")
        return {
            "dimensionScores": dimension_scores,
            "score": score,
            "status": status,
            "rationale": rationale,
        }

    @staticmethod
    def _parse_dimension_scores(value: object) -> list[dict]:
        if not isinstance(value, list) or not value:
            raise RuntimeError("LLM Judge returned invalid dimension score schema")
        dimension_scores: list[dict] = []
        for item in value:
            if not isinstance(item, dict):
                raise RuntimeError("LLM Judge returned invalid dimension score schema")
            name = item.get("name")
            if not isinstance(name, str) or not name.strip():
                raise RuntimeError("LLM Judge returned invalid dimension score schema")
            try:
                weight = int(item["weight"])
                score = int(item["score"])
            except (KeyError, TypeError, ValueError):
                raise RuntimeError("LLM Judge returned invalid dimension score schema") from None
            if weight < 1 or weight > 100 or score < 0 or score > 100:
                raise RuntimeError("LLM Judge returned invalid dimension score schema")
            dimension_scores.append({
                "name": name.strip(),
                "weight": weight,
                "score": score,
            })
        return dimension_scores
