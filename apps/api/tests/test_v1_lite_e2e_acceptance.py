import json
from dataclasses import dataclass

from sqlalchemy import func, select

from api_test_support import create_authenticated_client, csrf_headers, workspace_url
from app.judge_gateway import JudgeGatewayResult
from app.models import (
    EvaluationRecord,
    ModelProviderRecord,
    NodeRunRecord,
    UserRecord,
)
from app.v1_lite_seed import seed_v1_lite_assets


@dataclass
class FakeModelResult:
    content: str
    model: str = "fake-v1-lite-model"
    prompt_tokens: int = 20
    completion_tokens: int = 30


class FakeGateway:
    def __init__(self, results: list[FakeModelResult]):
        self.results = results
        self.calls: list[dict] = []

    def complete(self, **request):
        self.calls.append(request)
        return self.results.pop(0)


class FakeJudgeGateway:
    def __init__(self):
        self.calls: list[dict] = []

    def evaluate(self, **request) -> JudgeGatewayResult:
        self.calls.append(request)
        return JudgeGatewayResult(
            dimension_scores=[
                {
                    "dimensionId": dimension["id"],
                    "score": 90,
                    "reason": f"{dimension['name']} 已满足对应验收标准。",
                }
                for dimension in request["rubric_snapshot"]["dimensions"]
            ],
            rationale="各维度均达到 V1 Lite 试点验收要求。",
            model="fake-v1-lite-judge",
            input_snapshot={"judgePromptVersion": "llm-judge-explainable-v1"},
            prompt_tokens=12,
            completion_tokens=8,
            attempts=1,
        )


def test_v1_lite_seeded_assets_run_review_evaluate_regress_and_trace(tmp_path):
    judge = FakeJudgeGateway()
    gateway = FakeGateway([
        FakeModelResult(
            json.dumps({
                "problemModel": {
                    "businessGoal": "快速跑通一个受控 AI 赋能试点流程",
                    "actors": ["业务负责人", "构建者", "审核人"],
                    "risks": ["范围失控", "跳过人工审核", "评分不可复测"],
                    "openQuestions": ["真实业务负责人是否已确认验收样本"],
                },
            }, ensure_ascii=False),
        ),
        FakeModelResult(
            json.dumps({
                "workflowDesign": {
                    "nodes": ["输入", "Agent 建模", "Agent 方案", "Human Review", "Evaluation", "输出"],
                    "humanReviewPlacement": "高风险判断进入业务负责人审核",
                    "outOfScope": ["多组织 SaaS", "Kubernetes", "全量外部通知"],
                },
            }, ensure_ascii=False),
        ),
        FakeModelResult(
            json.dumps({
                "rubric": {
                    "dimensions": [
                        {"name": "业务目标清晰度", "weight": 20},
                        {"name": "工作流可执行性", "weight": 25},
                        {"name": "质量评价可操作性", "weight": 25},
                        {"name": "风险控制", "weight": 20},
                        {"name": "可迭代性", "weight": 10},
                    ],
                    "totalPassingScore": 80,
                    "hardGates": ["不得泄露密钥", "不得跳过 Human Review"],
                },
            }, ensure_ascii=False),
        ),
        FakeModelResult(
            "最终方案：V1.0 Lite 先跑通一个业务试点，保留人工审核、质量评分、Trace 证据和后续 V1.1 边界。"
            "变更说明：已采纳审核意见，明确风险控制、验收证据、Run ID、Human Task ID、Evaluation ID 和 Trace ID。"
        ),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'v1-lite-e2e.db'}",
        model_gateway=gateway,
        judge_gateway=judge,
    )
    with client.app.state.session_factory() as session:
        admin_id = session.scalar(select(UserRecord.id))
        assert admin_id is not None
        session.add(
            ModelProviderRecord(
                workspace_id=workspace_id,
                name="V1 Lite E2E Provider",
                provider_type="openai-compatible",
                base_url="https://api.deepseek.com",
                default_model="deepseek-v4-pro",
                secret_ref="DEEPSEEK_API_KEY",
                status="draft",
                created_by=admin_id,
            ),
        )
        session.flush()
        seeded = seed_v1_lite_assets(session)

    workflow_id = seeded["workflow"]["id"]
    run_input = json.dumps({
        "sourceNotes": "安克 AI 课程笔记与个人思维导图摘要",
        "businessContext": "希望构建一个企业 AI 赋能平台，用于编排 Agent、人工审核和质量评分",
        "desiredOutput": "平台落地路线与一个可执行试点流程",
        "riskConcerns": "不要大而全失控，先快速试点；质量评分体系要可落地",
    }, ensure_ascii=False)

    run_response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow_id}/runs"),
        json={"input": run_input},
        headers=csrf_headers(client),
    )

    assert run_response.status_code == 201
    paused_run = run_response.json()
    assert paused_run["id"]
    assert paused_run["status"] == "等待审核"
    assert len(gateway.calls) == 3

    tasks = client.get(workspace_url(workspace_id, "/human-tasks")).json()
    assert len(tasks) == 1
    task = tasks[0]
    assert task["workflowRunId"] == paused_run["id"]
    assert task["participantSnapshot"] == [seeded["reviewer"]["id"]]
    task_detail = client.get(
        workspace_url(workspace_id, f"/human-tasks/{task['id']}"),
    ).json()
    reviewed_artifact = task_detail["artifact"]["content"]
    assert "workflowDesign" in reviewed_artifact
    assert "rubric" in reviewed_artifact

    claimed = client.post(
        workspace_url(workspace_id, f"/human-tasks/{task['id']}/claim"),
        json={},
        headers=csrf_headers(client),
    )
    assert claimed.status_code == 200
    assert claimed.json()["status"] == "审核中"
    assert claimed.json()["assigneeReviewerId"] == seeded["reviewer"]["id"]

    decided = client.post(
        workspace_url(workspace_id, f"/human-tasks/{task['id']}/decisions"),
        json={
            "decision": "approve",
            "reason": "V1 Lite 自动验收：方案可以进入评估与观测验证。",
            "artifactVersionId": task["artifactVersionId"],
            "idempotencyKey": f"{task['id']}-v1-lite-approve",
        },
        headers=csrf_headers(client),
    )
    assert decided.status_code == 200
    assert decided.json()["status"] == "已通过"
    assert len(gateway.calls) == 4
    revision_input = json.loads(gateway.calls[3]["user_input"])
    assert revision_input["reviewedArtifact"] == reviewed_artifact
    assert revision_input["reviewDecision"] == {
        "decision": "approve",
        "reason": "V1 Lite 自动验收：方案可以进入评估与观测验证。",
    }

    completed_run = client.get(
        workspace_url(workspace_id, f"/runs/{paused_run['id']}"),
    ).json()
    assert completed_run["status"] == "已完成"
    assert completed_run["output"]
    node_types = [node["nodeType"] for node in completed_run["nodes"]]
    assert node_types.count("trigger") == 1
    assert node_types.count("agent") == 4
    assert node_types.count("human") == 1
    assert node_types.count("evaluation") == 1
    assert node_types.count("end") == 1

    with client.app.state.session_factory() as session:
        source_node = session.scalar(
            select(NodeRunRecord).where(
                NodeRunRecord.run_id == completed_run["id"],
                NodeRunRecord.node_id == "agent-revision",
            ),
        )
        evaluation_node = session.scalar(
            select(NodeRunRecord).where(
                NodeRunRecord.run_id == completed_run["id"],
                NodeRunRecord.node_id == "evaluation-placeholder",
            ),
        )
        evaluation_record = session.scalar(
            select(EvaluationRecord).where(
                EvaluationRecord.workspace_id == workspace_id,
            ),
        )
        assert source_node is not None
        assert evaluation_node is not None
        assert evaluation_record is not None
        assert evaluation_record.rubric_id == seeded["rubric"]["id"]
        assert evaluation_record.rubric_version == seeded["rubric"]["version"]
        assert evaluation_record.subject_type == "node_run"
        assert evaluation_record.subject_id == source_node.id

        evaluation_output = json.loads(evaluation_node.output_text)
        assert evaluation_output["evaluationRecordId"] == evaluation_record.id
        assert evaluation_output["templateId"] == seeded["rubric"]["id"]
        assert evaluation_output["templateVersion"] == seeded["rubric"]["version"]
        assert evaluation_output["modelProviderId"] == seeded["modelProvider"]["id"]
        assert evaluation_output["modelProviderName"] == seeded["modelProvider"]["name"]
        assert evaluation_output["model"] == "fake-v1-lite-judge"
        assert evaluation_output["totalScore"] == 90
        assert evaluation_output["passed"] is True
        assert evaluation_output["overallReason"] == "各维度均达到 V1 Lite 试点验收要求。"
        assert len(evaluation_output["dimensions"]) == 5
        assert all(
            dimension["score"] == 90 and dimension["reason"].strip()
            for dimension in evaluation_output["dimensions"]
        )
    assert len(judge.calls) == 1

    regression = client.post(
        workspace_url(workspace_id, "/evaluations/regression-runs"),
        json={
            "rubricId": seeded["rubric"]["id"],
            "sampleSetId": seeded["sampleSet"]["id"],
        },
        headers=csrf_headers(client),
    )
    assert regression.status_code == 201
    regression_run = regression.json()
    assert regression_run["id"]
    assert regression_run["totalSamples"] == 3
    assert len(regression_run["evaluationIds"]) == 3
    assert len(judge.calls) == 4
    assert all(
        call["rubric_version"] == seeded["rubric"]["version"]
        for call in judge.calls
    )
    with client.app.state.session_factory() as session:
        assert session.scalar(select(func.count()).select_from(EvaluationRecord)) == 4

    observability = client.get(
        workspace_url(workspace_id, f"/observability/runs/{completed_run['id']}"),
    )
    assert observability.status_code == 200
    trace = observability.json()
    assert trace["traceId"] == f"trace-{completed_run['id']}"
    assert [task["id"] for task in trace["humanTasks"]] == [task["id"]]
    source_types = {event["sourceType"] for event in trace["executionEvents"]}
    assert {"workflow_run", "node_run", "human_task", "audit_event"}.issubset(source_types)
    assert any(event["type"] == "human_task_created" for event in trace["executionEvents"])
