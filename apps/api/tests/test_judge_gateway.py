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
    def __init__(self, result: FakeModelResult):
        self.result = result
        self.calls: list[dict] = []

    def complete(self, **request) -> FakeModelResult:
        self.calls.append(request)
        return self.result


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
