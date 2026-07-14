from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.judge_gateway import JudgeGateway
from app.models import (
    EvaluationRecord,
    ModelProviderRecord,
    RubricRecord,
    RubricVersionRecord,
)
from app.runtime_security import is_valid_model_secret_ref


class EvaluationError(RuntimeError):
    def __init__(
        self,
        *,
        kind: str,
        code: str,
        message: str,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        attempts: int = 0,
        model: str = "",
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.code = code
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.attempts = attempts
        self.model = model


@dataclass(frozen=True)
class EvaluationPlan:
    rubric_id: str
    workspace_id: str
    rubric_version_id: str | None
    rubric_version: str
    snapshot: dict
    provider_id: str | None
    provider_name: str
    provider_type: str
    provider_base_url: str
    provider_secret_ref: str = field(repr=False)
    model: str = ""
    strict_explainable: bool = False


@dataclass(frozen=True)
class EvaluationResult:
    record: EvaluationRecord
    provider_id: str | None
    provider_name: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    attempts: int = 1


class EvaluationService:
    def __init__(self, judge_gateway: JudgeGateway):
        self.judge_gateway = judge_gateway

    def prepare_active(
        self,
        session: Session,
        *,
        workspace_id: str,
        rubric_id: str,
    ) -> EvaluationPlan:
        rubric = self._find_active_rubric(session, workspace_id, rubric_id)
        version = session.scalar(
            select(RubricVersionRecord)
            .where(
                RubricVersionRecord.workspace_id == workspace_id,
                RubricVersionRecord.rubric_id == rubric_id,
            )
            .order_by(RubricVersionRecord.created_at.desc()),
        )
        if version is None:
            return self._build_plan(
                session,
                workspace_id=workspace_id,
                rubric=rubric,
                rubric_version_id=None,
                rubric_version=rubric.version,
                snapshot=self._live_snapshot(rubric),
                require_workflow_compatible=False,
            )
        return self._build_plan(
            session,
            workspace_id=workspace_id,
            rubric=rubric,
            rubric_version_id=version.id,
            rubric_version=version.version,
            snapshot=version.snapshot,
            require_workflow_compatible=False,
        )

    def prepare_pinned(
        self,
        session: Session,
        *,
        workspace_id: str,
        rubric_id: str,
        rubric_version_id: str,
    ) -> EvaluationPlan:
        rubric = self._find_active_rubric(session, workspace_id, rubric_id)
        version = session.scalar(
            select(RubricVersionRecord).where(
                RubricVersionRecord.id == rubric_version_id,
                RubricVersionRecord.workspace_id == workspace_id,
                RubricVersionRecord.rubric_id == rubric_id,
            ),
        )
        if version is None:
            raise EvaluationError(
                kind="not_found",
                code="rubric_version_not_found",
                message="评估模板版本不存在",
            )
        return self._build_plan(
            session,
            workspace_id=workspace_id,
            rubric=rubric,
            rubric_version_id=version.id,
            rubric_version=version.version,
            snapshot=version.snapshot,
            require_workflow_compatible=True,
        )

    def evaluate(
        self,
        session: Session,
        *,
        plan: EvaluationPlan,
        artifact_text: str,
        subject_type: str,
        subject_id: str | None,
        created_by: str,
    ) -> EvaluationResult:
        normalized_artifact = artifact_text.strip()
        if not normalized_artifact:
            raise EvaluationError(
                kind="invalid",
                code="empty_artifact",
                message="上游产出物不能为空",
            )

        judge_type = self._snapshot_value(
            plan.snapshot,
            "judge_type",
            "judgeType",
            default="deterministic",
        )
        if judge_type == "llm":
            return self._evaluate_llm(
                session,
                plan=plan,
                artifact_text=normalized_artifact,
                subject_type=subject_type,
                subject_id=subject_id,
                created_by=created_by,
            )
        return self._evaluate_deterministic(
            session,
            plan=plan,
            artifact_text=normalized_artifact,
            subject_type=subject_type,
            subject_id=subject_id,
            created_by=created_by,
        )

    def _evaluate_llm(
        self,
        session: Session,
        *,
        plan: EvaluationPlan,
        artifact_text: str,
        subject_type: str,
        subject_id: str | None,
        created_by: str,
    ) -> EvaluationResult:
        try:
            judge_result = self.judge_gateway.evaluate(
                rubric_snapshot=plan.snapshot,
                rubric_version=plan.rubric_version,
                artifact_text=artifact_text,
                subject_type=subject_type,
                subject_id=subject_id,
                model_provider_id=plan.provider_id,
                model_provider=plan.provider_type,
                model_base_url=plan.provider_base_url,
                model_secret_ref=plan.provider_secret_ref,
            )
        except RuntimeError as error:
            raise EvaluationError(
                kind="judge_failed",
                code="judge_failed",
                message="评估模型调用失败",
                prompt_tokens=int(getattr(error, "prompt_tokens", 0)),
                completion_tokens=int(getattr(error, "completion_tokens", 0)),
                attempts=int(getattr(error, "attempts", 0)),
                model=str(getattr(error, "model", "") or plan.model),
            ) from None

        try:
            if plan.strict_explainable:
                dimension_scores, score, status_value = self._system_score(
                    plan.snapshot,
                    judge_result.dimension_scores,
                )
            else:
                dimension_scores = list(judge_result.dimension_scores)
                score = getattr(judge_result, "score", None)
                status_value = getattr(judge_result, "status", None)
                if not isinstance(score, int) or score < 0 or score > 100:
                    raise EvaluationError(
                        kind="judge_failed",
                        code="judge_result_invalid",
                        message="LLM Judge 返回分数无效",
                    )
                if status_value not in {"passed", "failed"}:
                    raise EvaluationError(
                        kind="judge_failed",
                        code="judge_result_invalid",
                        message="LLM Judge 返回状态无效",
                    )

            rationale = str(judge_result.rationale).strip()
            if not rationale:
                raise EvaluationError(
                    kind="judge_failed",
                    code="judge_result_invalid",
                    message="LLM Judge 返回总评理由无效",
                )
        except EvaluationError as error:
            raise EvaluationError(
                kind=error.kind,
                code=error.code,
                message=str(error),
                prompt_tokens=int(getattr(judge_result, "prompt_tokens", 0)),
                completion_tokens=int(getattr(judge_result, "completion_tokens", 0)),
                attempts=int(getattr(judge_result, "attempts", 0)),
                model=str(judge_result.model or plan.model),
            ) from None
        model = str(judge_result.model or plan.model)
        evaluator_input = {
            **dict(judge_result.input_snapshot),
            "rubricVersionId": plan.rubric_version_id,
            "modelProviderId": plan.provider_id,
            "modelProviderName": plan.provider_name,
        }
        record = self._create_record(
            session,
            plan=plan,
            artifact_text=artifact_text,
            subject_type=subject_type,
            subject_id=subject_id,
            dimension_scores=dimension_scores,
            score=score,
            status_value=status_value,
            rationale=rationale,
            evaluator_type="llm",
            evaluator_model=model,
            evaluator_input=evaluator_input,
            created_by=created_by,
        )
        return EvaluationResult(
            record=record,
            provider_id=plan.provider_id,
            provider_name=plan.provider_name,
            model=model,
            prompt_tokens=int(getattr(judge_result, "prompt_tokens", 0)),
            completion_tokens=int(getattr(judge_result, "completion_tokens", 0)),
            attempts=int(getattr(judge_result, "attempts", 1)),
        )

    def _evaluate_deterministic(
        self,
        session: Session,
        *,
        plan: EvaluationPlan,
        artifact_text: str,
        subject_type: str,
        subject_id: str | None,
        created_by: str,
    ) -> EvaluationResult:
        dimension_base_score = self._deterministic_dimension_score(artifact_text)
        dimension_scores = [
            {
                "name": dimension["name"],
                "weight": dimension["weight"],
                "score": dimension_base_score,
            }
            for dimension in plan.snapshot.get("dimensions", [])
        ]
        score = round(sum(
            dimension["score"] * dimension["weight"]
            for dimension in dimension_scores
        ) / 100)
        pass_score = int(self._snapshot_value(
            plan.snapshot,
            "pass_score",
            "passScore",
            default=0,
        ))
        status_value = "passed" if score >= pass_score else "failed"
        rationale = (
            "deterministic rubric evaluation: score is based on artifact "
            "length and explicit quality signals; LLM judge is not enabled yet."
        )
        record = self._create_record(
            session,
            plan=plan,
            artifact_text=artifact_text,
            subject_type=subject_type,
            subject_id=subject_id,
            dimension_scores=dimension_scores,
            score=score,
            status_value=status_value,
            rationale=rationale,
            evaluator_type="deterministic",
            evaluator_model="",
            evaluator_input={
                "artifactText": artifact_text,
                "rubricVersion": plan.rubric_version,
                "rubricVersionId": plan.rubric_version_id,
                "subjectType": subject_type,
                "subjectId": subject_id,
            },
            created_by=created_by,
        )
        return EvaluationResult(
            record=record,
            provider_id=None,
            provider_name="",
            model="",
        )

    def _build_plan(
        self,
        session: Session,
        *,
        workspace_id: str,
        rubric: RubricRecord,
        rubric_version_id: str | None,
        rubric_version: str,
        snapshot: dict,
        require_workflow_compatible: bool,
    ) -> EvaluationPlan:
        judge_type = str(self._snapshot_value(
            snapshot,
            "judge_type",
            "judgeType",
            default="deterministic",
        ))
        strict_explainable = self._has_explainable_dimensions(snapshot)
        provider_id_value = self._snapshot_value(
            snapshot,
            "model_provider_id",
            "modelProviderId",
            default=None,
        )
        provider_id = str(provider_id_value).strip() if provider_id_value else None
        model = str(self._snapshot_value(
            snapshot,
            "judge_model",
            "judgeModel",
            default="",
        )).strip()

        if require_workflow_compatible:
            if judge_type != "llm" or not strict_explainable:
                raise EvaluationError(
                    kind="invalid",
                    code="rubric_version_incompatible",
                    message="评估模板版本不兼容工作流评估节点",
                )
            if not provider_id or not model:
                raise EvaluationError(
                    kind="invalid",
                    code="rubric_version_incompatible",
                    message="评估模板版本缺少模型绑定",
                )

        provider = None
        if provider_id:
            provider = session.scalar(
                select(ModelProviderRecord).where(
                    ModelProviderRecord.id == provider_id,
                    ModelProviderRecord.workspace_id == workspace_id,
                ),
            )
            if provider is None or provider.status == "disabled":
                raise EvaluationError(
                    kind="conflict",
                    code="model_provider_unavailable",
                    message="评估模板绑定的 Model Provider 不可用",
                )
            if not self._provider_is_configured(provider):
                raise EvaluationError(
                    kind="conflict",
                    code="model_provider_unavailable",
                    message="评估模板绑定的 Model Provider 配置不完整",
                )

        return EvaluationPlan(
            workspace_id=workspace_id,
            rubric_id=rubric.id,
            rubric_version_id=rubric_version_id,
            rubric_version=rubric_version,
            snapshot=dict(snapshot),
            provider_id=provider.id if provider else None,
            provider_name=provider.name if provider else "",
            provider_type=provider.provider_type if provider else "openai-compatible",
            provider_base_url=provider.base_url if provider else "",
            provider_secret_ref=provider.secret_ref if provider else "",
            model=model or (provider.default_model if provider else ""),
            strict_explainable=strict_explainable,
        )

    def _find_active_rubric(
        self,
        session: Session,
        workspace_id: str,
        rubric_id: str,
    ) -> RubricRecord:
        rubric = session.scalar(
            select(RubricRecord).where(
                RubricRecord.id == rubric_id,
                RubricRecord.workspace_id == workspace_id,
            ),
        )
        if rubric is None:
            raise EvaluationError(
                kind="not_found",
                code="rubric_not_found",
                message="评估模板不存在",
            )
        if rubric.status != "active":
            raise EvaluationError(
                kind="conflict",
                code="rubric_unavailable",
                message="只有已发布评估模板可以运行评估",
            )
        return rubric

    @staticmethod
    def _live_snapshot(rubric: RubricRecord) -> dict:
        return {
            "id": rubric.id,
            "name": rubric.name,
            "artifact": rubric.artifact,
            "dimensions": rubric.dimensions,
            "gate": rubric.gate,
            "pass_score": rubric.pass_score,
            "judge_type": rubric.judge_type,
            "judge_model": rubric.judge_model,
            "model_provider_id": getattr(rubric, "model_provider_id", None),
            "version": rubric.version,
            "status": rubric.status,
        }

    @staticmethod
    def _system_score(snapshot: dict, judge_scores: list[dict]) -> tuple[list[dict], int, str]:
        dimensions = snapshot.get("dimensions")
        if not isinstance(dimensions, list) or not dimensions:
            raise EvaluationError(
                kind="invalid",
                code="rubric_version_incompatible",
                message="评估模板缺少评分维度",
            )
        scores_by_id: dict[str, dict] = {}
        for item in judge_scores:
            if not isinstance(item, dict):
                raise EvaluationError(
                    kind="judge_failed",
                    code="judge_result_invalid",
                    message="LLM Judge 返回维度结果无效",
                )
            dimension_id = str(item.get("dimensionId") or "").strip()
            if not dimension_id or dimension_id in scores_by_id:
                raise EvaluationError(
                    kind="judge_failed",
                    code="judge_result_invalid",
                    message="LLM Judge 返回维度结果无效",
                )
            scores_by_id[dimension_id] = item
        expected_ids = {str(dimension.get("id") or "").strip() for dimension in dimensions}
        if set(scores_by_id) != expected_ids:
            raise EvaluationError(
                kind="judge_failed",
                code="judge_result_invalid",
                message="LLM Judge 返回维度集合与模板不一致",
            )

        calculated: list[dict] = []
        weighted_total = 0.0
        for dimension in dimensions:
            dimension_id = str(dimension["id"]).strip()
            judge_score = scores_by_id[dimension_id]
            raw_score = judge_score.get("score")
            if isinstance(raw_score, bool) or not isinstance(raw_score, int) or not 0 <= raw_score <= 100:
                raise EvaluationError(
                    kind="judge_failed",
                    code="judge_result_invalid",
                    message="LLM Judge 返回维度分数无效",
                )
            reason = str(judge_score.get("reason") or "").strip()
            if not reason:
                raise EvaluationError(
                    kind="judge_failed",
                    code="judge_result_invalid",
                    message="LLM Judge 返回维度理由无效",
                )
            weight = int(dimension["weight"])
            weighted_score = round(raw_score * weight / 100, 2)
            weighted_total += raw_score * weight / 100
            calculated.append({
                "dimensionId": dimension_id,
                "name": str(dimension["name"]),
                "score": raw_score,
                "weight": weight,
                "weightedScore": weighted_score,
                "reason": reason,
            })
        score = round(weighted_total)
        pass_score = int(EvaluationService._snapshot_value(
            snapshot,
            "pass_score",
            "passScore",
            default=0,
        ))
        return calculated, score, "passed" if score >= pass_score else "failed"

    @staticmethod
    def _has_explainable_dimensions(snapshot: dict) -> bool:
        dimensions = snapshot.get("dimensions")
        if not isinstance(dimensions, list) or not dimensions:
            return False
        ids: set[str] = set()
        names: set[str] = set()
        total_weight = 0
        for dimension in dimensions:
            if not isinstance(dimension, dict):
                return False
            dimension_id = str(dimension.get("id") or "").strip()
            name = str(dimension.get("name") or "").strip()
            criteria = str(dimension.get("criteria") or "").strip()
            weight = dimension.get("weight")
            normalized_name = name.casefold()
            if (
                not dimension_id
                or not name
                or not criteria
                or dimension_id in ids
                or normalized_name in names
                or isinstance(weight, bool)
                or not isinstance(weight, int)
                or weight < 1
                or weight > 100
            ):
                return False
            ids.add(dimension_id)
            names.add(normalized_name)
            total_weight += weight
        return total_weight == 100

    @staticmethod
    def _provider_is_configured(provider: ModelProviderRecord) -> bool:
        return bool(
            provider.provider_type.strip()
            and provider.base_url.strip()
            and provider.default_model.strip()
            and is_valid_model_secret_ref(provider.secret_ref.strip())
        )

    @staticmethod
    def _deterministic_dimension_score(artifact_text: str) -> int:
        lower = artifact_text.lower()
        signal_keywords = (
            "source",
            "evidence",
            "owner",
            "risk",
            "next action",
            "acceptance",
            "criteria",
        )
        keyword_score = min(14, sum(2 for keyword in signal_keywords if keyword in lower))
        length_score = min(86, 42 + len(artifact_text) // 3)
        return min(100, length_score + keyword_score)

    @staticmethod
    def _create_record(
        session: Session,
        *,
        plan: EvaluationPlan,
        artifact_text: str,
        subject_type: str,
        subject_id: str | None,
        dimension_scores: list[dict],
        score: int,
        status_value: str,
        rationale: str,
        evaluator_type: str,
        evaluator_model: str,
        evaluator_input: dict,
        created_by: str,
    ) -> EvaluationRecord:
        record = EvaluationRecord(
            workspace_id=plan.workspace_id,
            rubric_id=plan.rubric_id,
            rubric_version=plan.rubric_version,
            rubric_snapshot=plan.snapshot,
            subject_type=subject_type,
            subject_id=subject_id,
            artifact_text=artifact_text,
            dimension_scores=dimension_scores,
            score=score,
            status=status_value,
            rationale=rationale,
            evaluator_type=evaluator_type,
            evaluator_model=evaluator_model,
            evaluator_input=evaluator_input,
            created_by=created_by,
        )
        session.add(record)
        session.flush()
        return record

    @staticmethod
    def _snapshot_value(snapshot: dict, snake: str, camel: str, *, default: Any) -> Any:
        if snake in snapshot:
            return snapshot[snake]
        return snapshot.get(camel, default)
