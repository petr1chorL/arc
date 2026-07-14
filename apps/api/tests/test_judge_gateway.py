import json
from dataclasses import dataclass

import pytest

from app.judge_gateway import ModelJudgeGateway


@dataclass
class FakeModelResult:
    content: str
    model: str = "deepseek-v4-pro"
    prompt_tokens: int = 20
    completion_tokens: int = 12


class FakeModelGateway:
    def __init__(
        self,
        result: FakeModelResult | Exception | list[FakeModelResult | Exception],
    ):
        self.results = result if isinstance(result, list) else [result]
        self.calls: list[dict] = []

    def complete(self, **request) -> FakeModelResult:
        self.calls.append(request)
        index = min(len(self.calls) - 1, len(self.results) - 1)
        result = self.results[index]
        if isinstance(result, Exception):
            raise result
        return result


def test_model_judge_gateway_parses_structured_json_result():
    gateway = FakeModelGateway(FakeModelResult(
        content=json.dumps({
            "dimensionScores": [
                {"name": "Evidence", "weight": 60, "score": 92},
                {"name": "Actionability", "weight": 40, "score": 84},
            ],
            "score": 89,
            "status": "passed",
            "rationale": "Evidence is strong and actions are clear.",
        }),
    ))
    rubric_snapshot = {
        "name": "LLM Judge Rubric",
        "artifact": "Launch plan",
        "dimensions": [
            {"name": "Evidence", "weight": 60},
            {"name": "Actionability", "weight": 40},
        ],
        "gate": "Must include evidence and next actions",
        "passScore": 80,
        "judgeType": "llm",
        "judgeModel": "deepseek-v4-pro",
    }

    result = ModelJudgeGateway(gateway).evaluate(
        rubric_snapshot=rubric_snapshot,
        rubric_version="v1.0",
        artifact_text="Evidence-backed plan with owner and next action.",
        subject_type="manual",
        subject_id="sample-1",
    )

    assert result.dimension_scores == [
        {"name": "Evidence", "weight": 60, "score": 92},
        {"name": "Actionability", "weight": 40, "score": 84},
    ]
    assert result.score == 89
    assert result.status == "passed"
    assert result.rationale == "Evidence is strong and actions are clear."
    assert result.model == "deepseek-v4-pro"
    assert result.input_snapshot["rubricVersion"] == "v1.0"
    assert result.input_snapshot["judgePromptVersion"] == "llm-judge-v1"
    assert result.input_snapshot["artifactText"] == "Evidence-backed plan with owner and next action."
    assert gateway.calls[0]["model"] == "deepseek-v4-pro"
    assert "Return JSON only" in gateway.calls[0]["system_prompt"]
    assert "llm-judge-v1" in gateway.calls[0]["system_prompt"]


def test_model_judge_gateway_retries_invalid_json_payload_once():
    gateway = FakeModelGateway([
        FakeModelResult(content="not json"),
        FakeModelResult(content=json.dumps({
            "dimensionScores": [
                {"name": "Evidence", "weight": 100, "score": 91},
            ],
            "score": 91,
            "status": "passed",
            "rationale": "Recovered after retry.",
        })),
    ])

    result = ModelJudgeGateway(gateway, max_attempts=2).evaluate(
        rubric_snapshot={
            "name": "Retry Rubric",
            "dimensions": [{"name": "Evidence", "weight": 100}],
            "judgeType": "llm",
            "judgeModel": "deepseek-v4-pro",
        },
        rubric_version="v1.0",
        artifact_text="Artifact with evidence.",
        subject_type="manual",
        subject_id=None,
    )

    assert result.score == 91
    assert result.rationale == "Recovered after retry."
    assert len(gateway.calls) == 2


def test_model_judge_gateway_rejects_invalid_dimension_score_schema():
    gateway = FakeModelGateway(FakeModelResult(
        content=json.dumps({
            "dimensionScores": [
                {"name": "Evidence", "score": 91},
            ],
            "score": 91,
            "status": "passed",
            "rationale": "Missing dimension weight.",
        }),
    ))

    try:
        ModelJudgeGateway(gateway, max_attempts=1).evaluate(
            rubric_snapshot={
                "name": "Strict Rubric",
                "dimensions": [{"name": "Evidence", "weight": 100}],
                "judgeType": "llm",
                "judgeModel": "deepseek-v4-pro",
            },
            rubric_version="v1.0",
            artifact_text="Artifact with evidence.",
            subject_type="manual",
            subject_id=None,
        )
    except RuntimeError as error:
        assert str(error) == "LLM Judge returned invalid dimension score schema"
    else:
        raise AssertionError("Expected invalid dimension score schema to be rejected")


def _explainable_rubric_snapshot() -> dict:
    return {
        "id": "rubric-explainable",
        "name": "Explainable Judge Rubric",
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
        "passScore": 80,
        "judgeType": "llm",
        "judgeModel": "deepseek-v4-pro",
        "modelProviderId": "provider-1",
    }


def _valid_explainable_judge_payload() -> dict:
    return {
        "overallReason": "Evidence is strong and the next actions are clear.",
        "dimensions": [
            {
                "dimensionId": "evidence",
                "score": 92,
                "reason": "The plan cites customer interviews and measured outcomes.",
            },
            {
                "dimensionId": "actionability",
                "score": 84,
                "reason": "Each next action has an owner and a concrete deliverable.",
            },
        ],
    }


def _evaluate_explainable_payload(gateway: FakeModelGateway):
    return ModelJudgeGateway(gateway).evaluate(
        rubric_snapshot=_explainable_rubric_snapshot(),
        rubric_version="v1.0.0",
        artifact_text="Evidence-backed plan with owner and next action.",
        subject_type="node_run",
        subject_id="node-run-1",
    )


def test_model_judge_gateway_parses_dimension_reasons():
    gateway = FakeModelGateway(FakeModelResult(
        content=json.dumps(_valid_explainable_judge_payload()),
        prompt_tokens=23,
        completion_tokens=17,
    ))

    result = _evaluate_explainable_payload(gateway)

    assert result.dimension_scores == _valid_explainable_judge_payload()["dimensions"]
    assert result.rationale == _valid_explainable_judge_payload()["overallReason"]
    assert result.model == "deepseek-v4-pro"
    assert result.prompt_tokens == 23
    assert result.completion_tokens == 17
    assert result.attempts == 1


def test_model_judge_gateway_ignores_model_reported_totals_and_weights():
    payload = _valid_explainable_judge_payload()
    payload.update({"score": 1, "status": "failed"})
    payload["dimensions"] = [
        {
            **dimension,
            "name": "Model-supplied name must be ignored",
            "weight": 1,
            "weightedScore": 0.01,
        }
        for dimension in payload["dimensions"]
    ]
    gateway = FakeModelGateway(FakeModelResult(content=json.dumps(payload)))

    result = _evaluate_explainable_payload(gateway)

    assert result.dimension_scores == _valid_explainable_judge_payload()["dimensions"]
    assert getattr(result, "score", None) is None
    assert getattr(result, "status", None) is None


INVALID_EXPLAINABLE_PAYLOADS = [
    "not-json",
    json.dumps({
        **_valid_explainable_judge_payload(),
        "overallReason": " ",
    }),
    json.dumps({
        **_valid_explainable_judge_payload(),
        "dimensions": [_valid_explainable_judge_payload()["dimensions"][0]],
    }),
    json.dumps({
        **_valid_explainable_judge_payload(),
        "dimensions": [
            _valid_explainable_judge_payload()["dimensions"][0],
            _valid_explainable_judge_payload()["dimensions"][0],
        ],
    }),
    json.dumps({
        **_valid_explainable_judge_payload(),
        "dimensions": [
            *_valid_explainable_judge_payload()["dimensions"],
            {"dimensionId": "extra", "score": 80, "reason": "Not in the rubric."},
        ],
    }),
    json.dumps({
        **_valid_explainable_judge_payload(),
        "dimensions": [
            {
                **_valid_explainable_judge_payload()["dimensions"][0],
                "score": 101,
            },
            _valid_explainable_judge_payload()["dimensions"][1],
        ],
    }),
    json.dumps({
        **_valid_explainable_judge_payload(),
        "dimensions": [
            {
                **_valid_explainable_judge_payload()["dimensions"][0],
                "reason": " ",
            },
            _valid_explainable_judge_payload()["dimensions"][1],
        ],
    }),
]


@pytest.mark.parametrize("invalid_content", INVALID_EXPLAINABLE_PAYLOADS)
def test_model_judge_gateway_retries_invalid_dimension_contract(invalid_content):
    gateway = FakeModelGateway([
        FakeModelResult(
            content=invalid_content,
            prompt_tokens=11,
            completion_tokens=7,
        ),
        FakeModelResult(
            content=json.dumps(_valid_explainable_judge_payload()),
            prompt_tokens=13,
            completion_tokens=9,
        ),
    ])

    result = _evaluate_explainable_payload(gateway)

    assert len(gateway.calls) == 2
    assert result.attempts == 2
    assert result.prompt_tokens == 24
    assert result.completion_tokens == 16


def test_model_judge_gateway_failure_reports_accumulated_usage():
    gateway = FakeModelGateway([
        FakeModelResult(content="not-json", prompt_tokens=5, completion_tokens=3),
        FakeModelResult(content="still-not-json", prompt_tokens=7, completion_tokens=4),
    ])

    with pytest.raises(RuntimeError) as exc_info:
        _evaluate_explainable_payload(gateway)

    assert len(gateway.calls) == 2
    assert exc_info.value.prompt_tokens == 12
    assert exc_info.value.completion_tokens == 7
    assert exc_info.value.attempts == 2

def test_transport_failure_preserves_previous_attempt_usage_and_redacts_error():
    gateway = FakeModelGateway([
        FakeModelResult(
            content="not-json",
            model="served-evaluation-model",
            prompt_tokens=5,
            completion_tokens=3,
        ),
        RuntimeError("transport failed with api_key=sk-sensitive"),
    ])

    with pytest.raises(RuntimeError) as exc_info:
        _evaluate_explainable_payload(gateway)

    error = exc_info.value
    assert str(error) == "LLM Judge 模型调用失败"
    assert error.prompt_tokens == 5
    assert error.completion_tokens == 3
    assert error.attempts == 2
    assert error.model == "served-evaluation-model"
    assert "sk-sensitive" not in str(error)
