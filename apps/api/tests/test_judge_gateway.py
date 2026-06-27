import json
from dataclasses import dataclass

from app.judge_gateway import ModelJudgeGateway


@dataclass
class FakeModelResult:
    content: str
    model: str = "deepseek-v4-pro"
    prompt_tokens: int = 20
    completion_tokens: int = 12


class FakeModelGateway:
    def __init__(self, result: FakeModelResult | list[FakeModelResult]):
        self.results = result if isinstance(result, list) else [result]
        self.calls: list[dict] = []

    def complete(self, **request) -> FakeModelResult:
        self.calls.append(request)
        index = min(len(self.calls) - 1, len(self.results) - 1)
        return self.results[index]


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
    assert result.input_snapshot["artifactText"] == "Evidence-backed plan with owner and next action."
    assert gateway.calls[0]["model"] == "deepseek-v4-pro"
    assert "Return JSON only" in gateway.calls[0]["system_prompt"]


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
