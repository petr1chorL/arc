import json
from dataclasses import dataclass
from typing import Protocol

from app.model_gateway import ModelGateway


@dataclass(frozen=True)
class JudgeGatewayResult:
    dimension_scores: list[dict]
    rationale: str
    model: str
    input_snapshot: dict
    score: int | None = None
    status: str | None = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    attempts: int = 1


class JudgeGatewayError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        attempts: int = 0,
        model: str = "",
    ) -> None:
        super().__init__(message)
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.attempts = attempts
        self.model = model


class JudgeGateway(Protocol):
    def evaluate(
        self,
        *,
        rubric_snapshot: dict,
        rubric_version: str,
        artifact_text: str,
        subject_type: str,
        subject_id: str | None,
        model_provider_id: str | None = None,
        model_provider: str = "openai-compatible",
        model_base_url: str = "",
        model_secret_ref: str = "",
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
        model_provider_id: str | None = None,
        model_provider: str = "openai-compatible",
        model_base_url: str = "",
        model_secret_ref: str = "",
    ) -> JudgeGatewayResult:
        raise RuntimeError("LLM Judge 网关未配置")


class ModelJudgeGateway:
    PROMPT_VERSION = "llm-judge-v1"
    EXPLAINABLE_PROMPT_VERSION = "llm-judge-explainable-v1"

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
        model_provider_id: str | None = None,
        model_provider: str = "openai-compatible",
        model_base_url: str = "",
        model_secret_ref: str = "",
    ) -> JudgeGatewayResult:
        explainable_contract = self._uses_explainable_contract(rubric_snapshot)
        prompt_version = (
            self.EXPLAINABLE_PROMPT_VERSION
            if explainable_contract
            else self.PROMPT_VERSION
        )
        input_snapshot = {
            "rubricSnapshot": rubric_snapshot,
            "rubricVersion": rubric_version,
            "judgePromptVersion": prompt_version,
            "artifactText": artifact_text,
            "subjectType": subject_type,
            "subjectId": subject_id,
        }
        last_validation_error: RuntimeError | None = None
        last_failure_was_transport = False
        prompt_tokens = 0
        completion_tokens = 0
        model = ""
        for attempt in range(1, self.max_attempts + 1):
            try:
                model_result = self.gateway.complete(
                    system_prompt=self._system_prompt(explainable_contract),
                    user_input=json.dumps(input_snapshot, ensure_ascii=False),
                    model=str(
                        rubric_snapshot.get("judgeModel")
                        or rubric_snapshot.get("judge_model")
                        or ""
                    ),
                    model_provider_id=model_provider_id,
                    model_provider=model_provider,
                    model_base_url=model_base_url,
                    model_secret_ref=model_secret_ref,
                )
            except RuntimeError:
                last_failure_was_transport = True
                continue
            model = str(model_result.model or model)
            prompt_tokens += model_result.prompt_tokens
            completion_tokens += model_result.completion_tokens
            try:
                payload = (
                    self._parse_explainable_payload(
                        model_result.content,
                        rubric_snapshot["dimensions"],
                    )
                    if explainable_contract
                    else self._parse_payload(model_result.content)
                )
            except RuntimeError as error:
                last_validation_error = error
                last_failure_was_transport = False
                continue
            if explainable_contract:
                return JudgeGatewayResult(
                    dimension_scores=payload["dimensions"],
                    rationale=payload["overallReason"],
                    model=model_result.model,
                    input_snapshot=input_snapshot,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    attempts=attempt,
                )
            return JudgeGatewayResult(
                dimension_scores=payload["dimensionScores"],
                score=int(payload["score"]),
                status=str(payload["status"]),
                rationale=str(payload["rationale"]),
                model=model_result.model,
                input_snapshot=input_snapshot,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                attempts=attempt,
            )
        message = (
            "LLM Judge 模型调用失败"
            if last_failure_was_transport or last_validation_error is None
            else str(last_validation_error)
        )
        raise JudgeGatewayError(
            message,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            attempts=self.max_attempts,
            model=model,
        ) from None

    @staticmethod
    def _system_prompt(explainable_contract: bool) -> str:
        if explainable_contract:
            return (
                "You are an evaluation judge for enterprise AI workflow artifacts. "
                f"Prompt version: {ModelJudgeGateway.EXPLAINABLE_PROMPT_VERSION}. "
                "Return JSON only with keys: overallReason and dimensions. "
                "Each dimensions item must contain dimensionId, score, and reason. "
                "Return every rubric dimension exactly once."
            )
        return (
            "You are an evaluation judge for enterprise AI workflow artifacts. "
            f"Prompt version: {ModelJudgeGateway.PROMPT_VERSION}. "
            "Return JSON only with keys: dimensionScores, score, status, rationale. "
            "dimensionScores must contain name, weight, score. status must be passed or failed."
        )

    @staticmethod
    def _uses_explainable_contract(rubric_snapshot: dict) -> bool:
        dimensions = rubric_snapshot.get("dimensions")
        return (
            isinstance(dimensions, list)
            and bool(dimensions)
            and all(
                isinstance(dimension, dict)
                and isinstance(dimension.get("id"), str)
                and bool(dimension["id"].strip())
                and isinstance(dimension.get("criteria"), str)
                and bool(dimension["criteria"].strip())
                for dimension in dimensions
            )
        )

    @staticmethod
    def _parse_explainable_payload(content: str, rubric_dimensions: list[dict]) -> dict:
        try:
            payload = json.loads(content)
            overall_reason = payload["overallReason"]
            raw_dimensions = payload["dimensions"]
        except (json.JSONDecodeError, KeyError, TypeError):
            raise RuntimeError("LLM Judge 返回格式无效") from None
        if not isinstance(overall_reason, str) or not overall_reason.strip():
            raise RuntimeError("LLM Judge 返回格式无效")
        expected_ids = [str(dimension["id"]).strip() for dimension in rubric_dimensions]
        if len(expected_ids) != len(set(expected_ids)):
            raise RuntimeError("LLM Judge 返回格式无效")
        if not isinstance(raw_dimensions, list) or len(raw_dimensions) != len(expected_ids):
            raise RuntimeError("LLM Judge 返回格式无效")

        scores_by_id: dict[str, dict] = {}
        for item in raw_dimensions:
            if not isinstance(item, dict):
                raise RuntimeError("LLM Judge 返回格式无效")
            dimension_id = item.get("dimensionId")
            raw_score = item.get("score")
            reason = item.get("reason")
            if (
                not isinstance(dimension_id, str)
                or not dimension_id.strip()
                or not isinstance(raw_score, (int, float))
                or isinstance(raw_score, bool)
                or int(raw_score) != raw_score
                or not isinstance(reason, str)
                or not reason.strip()
            ):
                raise RuntimeError("LLM Judge 返回格式无效")
            normalized_id = dimension_id.strip()
            score = int(raw_score)
            if score < 0 or score > 100 or normalized_id in scores_by_id:
                raise RuntimeError("LLM Judge 返回格式无效")
            scores_by_id[normalized_id] = {
                "dimensionId": normalized_id,
                "score": score,
                "reason": reason.strip(),
            }

        if set(scores_by_id) != set(expected_ids):
            raise RuntimeError("LLM Judge 返回格式无效")
        return {
            "overallReason": overall_reason.strip(),
            "dimensions": [scores_by_id[dimension_id] for dimension_id in expected_ids],
        }

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
