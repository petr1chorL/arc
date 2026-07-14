from dataclasses import dataclass, replace
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.database import create_database
from app.evaluation_service import EvaluationError, EvaluationService
from app.models import (
    Base,
    EvaluationRecord,
    ModelProviderRecord,
    RubricRecord,
    RubricVersionRecord,
    utc_now,
)


@dataclass(frozen=True)
class FakeJudgeResult:
    dimension_scores: list[dict]
    rationale: str
    model: str
    input_snapshot: dict
    score: int | None = None
    status: str | None = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    attempts: int = 1


class FakeJudgeGateway:
    def __init__(self, results: list[FakeJudgeResult] | None = None):
        self.results = list(results or [])
        self.calls: list[dict] = []

    def evaluate(self, **request) -> FakeJudgeResult:
        self.calls.append(request)
        if not self.results:
            raise AssertionError("Judge must not be called")
        return self.results.pop(0)


def _session_factory(tmp_path, database_name: str):
    engine, session_factory = create_database(
        f"sqlite:///{tmp_path / database_name}",
    )
    Base.metadata.create_all(engine)
    return session_factory


def _provider(
    *,
    provider_id: str,
    workspace_id: str,
    name: str = "Evaluation Provider",
    status: str = "active",
) -> ModelProviderRecord:
    return ModelProviderRecord(
        id=provider_id,
        workspace_id=workspace_id,
        name=name,
        provider_type="openai-compatible",
        base_url="https://api.deepseek.com",
        default_model="provider-default-model",
        secret_ref="DEEPSEEK_API_KEY",
        status=status,
        created_by="user-1",
    )


def _explainable_snapshot(
    *,
    rubric_id: str,
    provider_id: str,
    version: str,
    pass_score: int,
    judge_model: str,
) -> dict:
    return {
        "id": rubric_id,
        "name": "Explainable Evaluation Template",
        "artifact": "Launch plan",
        "dimensions": [
            {
                "id": "evidence",
                "name": "Evidence",
                "weight": 60,
                "criteria": "Cite concrete evidence for important claims.",
            },
            {
                "id": "actionability",
                "name": "Actionability",
                "weight": 40,
                "criteria": "Name owners and executable next actions.",
            },
        ],
        "gate": "Must include evidence and next actions",
        "pass_score": pass_score,
        "judge_type": "llm",
        "judge_model": judge_model,
        "model_provider_id": provider_id,
        "version": version,
        "status": "active",
    }


def _explainable_rubric(
    *,
    rubric_id: str,
    workspace_id: str,
    provider_id: str,
    version: str,
    pass_score: int,
    judge_model: str,
) -> RubricRecord:
    snapshot = _explainable_snapshot(
        rubric_id=rubric_id,
        provider_id=provider_id,
        version=version,
        pass_score=pass_score,
        judge_model=judge_model,
    )
    return RubricRecord(
        id=rubric_id,
        workspace_id=workspace_id,
        name=snapshot["name"],
        artifact=snapshot["artifact"],
        dimensions=snapshot["dimensions"],
        gate=snapshot["gate"],
        pass_score=pass_score,
        judge_type="llm",
        judge_model=judge_model,
        model_provider_id=provider_id,
        version=version,
        status="active",
    )


def _judge_result(
    *,
    model: str = "served-evaluation-model",
    evidence_score: int = 91,
    actionability_score: int = 84,
) -> FakeJudgeResult:
    return FakeJudgeResult(
        dimension_scores=[
            {
                "dimensionId": "evidence",
                "score": evidence_score,
                "reason": "The artifact cites concrete customer evidence.",
            },
            {
                "dimensionId": "actionability",
                "score": actionability_score,
                "reason": "The next actions have owners and deliverables.",
            },
        ],
        score=1,
        status="failed",
        rationale="Evidence is grounded and the action plan is executable.",
        model=model,
        input_snapshot={"judgePromptVersion": "llm-judge-v2"},
        prompt_tokens=23,
        completion_tokens=17,
        attempts=2,
    )


def test_explainable_llm_evaluation_system_scores_and_persists_provider_context(tmp_path):
    session_factory = _session_factory(tmp_path, "evaluation-service.db")
    judge = FakeJudgeGateway([_judge_result()])
    service = EvaluationService(judge)

    with session_factory() as session:
        workspace_id = "workspace-1"
        provider = _provider(provider_id="provider-1", workspace_id=workspace_id)
        rubric = _explainable_rubric(
            rubric_id="rubric-1",
            workspace_id=workspace_id,
            provider_id=provider.id,
            version="v1.0.0",
            pass_score=88,
            judge_model="template-pinned-model",
        )
        version = RubricVersionRecord(
            id="rubric-version-1",
            workspace_id=workspace_id,
            rubric_id=rubric.id,
            version="v1.0.0",
            snapshot=_explainable_snapshot(
                rubric_id=rubric.id,
                provider_id=provider.id,
                version="v1.0.0",
                pass_score=88,
                judge_model="template-pinned-model",
            ),
        )
        session.add_all([provider, rubric, version])
        session.flush()

        plan = service.prepare_active(
            session,
            workspace_id=workspace_id,
            rubric_id=rubric.id,
        )
        result = service.evaluate(
            session,
            plan=plan,
            artifact_text="Evidence-backed launch plan with owners and next actions.",
            subject_type="node_run",
            subject_id="source-node-run-1",
            created_by="user-1",
        )

        record = result.record
        assert record.id
        assert record.score == 88
        assert record.status == "passed"
        assert record.rationale == "Evidence is grounded and the action plan is executable."
        assert record.dimension_scores == [
            {
                "dimensionId": "evidence",
                "name": "Evidence",
                "score": 91,
                "weight": 60,
                "weightedScore": 54.6,
                "reason": "The artifact cites concrete customer evidence.",
            },
            {
                "dimensionId": "actionability",
                "name": "Actionability",
                "score": 84,
                "weight": 40,
                "weightedScore": 33.6,
                "reason": "The next actions have owners and deliverables.",
            },
        ]
        assert record.evaluator_type == "llm"
        assert record.evaluator_model == "served-evaluation-model"
        assert record.evaluator_input["modelProviderId"] == provider.id
        assert record.evaluator_input["modelProviderName"] == provider.name
        assert result.provider_id == provider.id
        assert result.provider_name == provider.name
        assert result.model == "served-evaluation-model"
        assert result.prompt_tokens == 23
        assert result.completion_tokens == 17
        assert result.attempts == 2
        assert session.scalar(
            select(func.count()).select_from(EvaluationRecord),
        ) == 1


def test_unavailable_provider_fails_before_creating_evaluation_record(tmp_path):
    session_factory = _session_factory(tmp_path, "evaluation-provider-failure.db")
    service = EvaluationService(FakeJudgeGateway([_judge_result()]))

    with session_factory() as session:
        workspace_id = "workspace-1"
        provider = _provider(
            provider_id="disabled-provider",
            workspace_id=workspace_id,
            status="disabled",
        )
        rubric = _explainable_rubric(
            rubric_id="rubric-disabled-provider",
            workspace_id=workspace_id,
            provider_id=provider.id,
            version="v1.0.0",
            pass_score=80,
            judge_model="template-pinned-model",
        )
        session.add_all([
            provider,
            rubric,
            RubricVersionRecord(
                id="disabled-provider-version",
                workspace_id=workspace_id,
                rubric_id=rubric.id,
                version="v1.0.0",
                snapshot=_explainable_snapshot(
                    rubric_id=rubric.id,
                    provider_id=provider.id,
                    version="v1.0.0",
                    pass_score=80,
                    judge_model="template-pinned-model",
                ),
            ),
        ])
        session.flush()

        with pytest.raises(EvaluationError) as exc_info:
            service.prepare_active(
                session,
                workspace_id=workspace_id,
                rubric_id=rubric.id,
            )

        assert exc_info.value.kind == "conflict"
        assert exc_info.value.code == "model_provider_unavailable"
        assert session.scalar(
            select(func.count()).select_from(EvaluationRecord),
        ) == 0


def test_prepare_active_preserves_legacy_deterministic_evaluation(tmp_path):
    session_factory = _session_factory(tmp_path, "evaluation-deterministic.db")
    judge = FakeJudgeGateway()
    service = EvaluationService(judge)

    with session_factory() as session:
        rubric = RubricRecord(
            id="legacy-deterministic-rubric",
            workspace_id="workspace-1",
            name="Legacy Deterministic Rubric",
            artifact="Draft",
            dimensions=[{"name": "Completeness", "weight": 100}],
            gate="Must contain content",
            pass_score=40,
            judge_type="deterministic",
            judge_model="",
            model_provider_id=None,
            version="v0.1.0",
            status="active",
        )
        session.add(rubric)
        session.flush()

        plan = service.prepare_active(
            session,
            workspace_id="workspace-1",
            rubric_id=rubric.id,
        )
        result = service.evaluate(
            session,
            plan=plan,
            artifact_text="abc",
            subject_type="manual",
            subject_id="legacy-subject",
            created_by="user-1",
        )

        assert plan.rubric_version_id is None
        assert result.record.rubric_version == "v0.1.0"
        assert result.record.dimension_scores == [
            {"name": "Completeness", "weight": 100, "score": 43},
        ]
        assert result.record.score == 43
        assert result.record.status == "passed"
        assert result.record.evaluator_type == "deterministic"
        assert result.record.evaluator_model == ""
        assert "deterministic" in result.record.rationale
        assert judge.calls == []


def test_prepare_pinned_uses_exact_rubric_version_instead_of_latest(tmp_path):
    session_factory = _session_factory(tmp_path, "evaluation-pinned-version.db")
    judge = FakeJudgeGateway([_judge_result(model="served-pinned-model")])
    service = EvaluationService(judge)

    with session_factory() as session:
        workspace_id = "workspace-1"
        provider = _provider(provider_id="provider-1", workspace_id=workspace_id)
        rubric = _explainable_rubric(
            rubric_id="rubric-pinned",
            workspace_id=workspace_id,
            provider_id=provider.id,
            version="v2.0.0",
            pass_score=50,
            judge_model="latest-model",
        )
        now = utc_now()
        pinned_version = RubricVersionRecord(
            id="rubric-version-pinned",
            workspace_id=workspace_id,
            rubric_id=rubric.id,
            version="v1.0.0",
            snapshot=_explainable_snapshot(
                rubric_id=rubric.id,
                provider_id=provider.id,
                version="v1.0.0",
                pass_score=90,
                judge_model="pinned-model",
            ),
            created_at=now,
        )
        latest_version = RubricVersionRecord(
            id="rubric-version-latest",
            workspace_id=workspace_id,
            rubric_id=rubric.id,
            version="v2.0.0",
            snapshot=_explainable_snapshot(
                rubric_id=rubric.id,
                provider_id=provider.id,
                version="v2.0.0",
                pass_score=50,
                judge_model="latest-model",
            ),
            created_at=now + timedelta(seconds=1),
        )
        session.add_all([provider, rubric, pinned_version, latest_version])
        session.flush()

        plan = service.prepare_pinned(
            session,
            workspace_id=workspace_id,
            rubric_id=rubric.id,
            rubric_version_id=pinned_version.id,
        )
        result = service.evaluate(
            session,
            plan=plan,
            artifact_text="Evidence-backed launch plan with owners and next actions.",
            subject_type="node_run",
            subject_id="source-node-run-1",
            created_by="user-1",
        )

        assert plan.rubric_version_id == pinned_version.id
        assert plan.rubric_version == "v1.0.0"
        assert plan.model == "pinned-model"
        assert result.record.rubric_version == "v1.0.0"
        assert result.record.rubric_snapshot["pass_score"] == 90
        assert result.record.score == 88
        assert result.record.status == "failed"
        assert result.record.evaluator_model == "served-pinned-model"


def test_invalid_system_scoring_preserves_judge_usage_and_creates_no_record(tmp_path):
    session_factory = _session_factory(tmp_path, "evaluation-invalid-result.db")
    invalid_result = replace(
        _judge_result(model="served-invalid-model"),
        dimension_scores=[
            {
                "dimensionId": "evidence",
                "score": 91,
                "reason": "Evidence is present.",
            },
        ],
    )
    service = EvaluationService(FakeJudgeGateway([invalid_result]))

    with session_factory() as session:
        provider = _provider(provider_id="provider-1", workspace_id="workspace-1")
        rubric = _explainable_rubric(
            rubric_id="rubric-invalid-result",
            workspace_id="workspace-1",
            provider_id=provider.id,
            version="v1.0.0",
            pass_score=80,
            judge_model="template-model",
        )
        version = RubricVersionRecord(
            id="rubric-version-invalid-result",
            workspace_id="workspace-1",
            rubric_id=rubric.id,
            version="v1.0.0",
            snapshot=_explainable_snapshot(
                rubric_id=rubric.id,
                provider_id=provider.id,
                version="v1.0.0",
                pass_score=80,
                judge_model="template-model",
            ),
        )
        session.add_all([provider, rubric, version])
        session.flush()
        plan = service.prepare_pinned(
            session,
            workspace_id="workspace-1",
            rubric_id=rubric.id,
            rubric_version_id=version.id,
        )

        with pytest.raises(EvaluationError) as exc_info:
            service.evaluate(
                session,
                plan=plan,
                artifact_text="Evidence-backed launch plan.",
                subject_type="node_run",
                subject_id="source-node-run",
                created_by="user-1",
            )

        error = exc_info.value
        assert error.code == "judge_result_invalid"
        assert error.prompt_tokens == 23
        assert error.completion_tokens == 17
        assert error.attempts == 2
        assert error.model == "served-invalid-model"
        assert session.scalar(select(func.count()).select_from(EvaluationRecord)) == 0
