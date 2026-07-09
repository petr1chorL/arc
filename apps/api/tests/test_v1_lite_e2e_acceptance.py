import json
from dataclasses import dataclass

from api_test_support import create_authenticated_client, csrf_headers, workspace_url
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


def test_v1_lite_seeded_assets_run_review_evaluate_regress_and_trace(tmp_path):
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
    )
    with client.app.state.session_factory() as session:
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

    evaluation = client.post(
        workspace_url(workspace_id, f"/evaluations/rubrics/{seeded['rubric']['id']}/evaluate"),
        json={
            "artifactText": completed_run["output"],
            "subjectType": "workflow_run",
            "subjectId": completed_run["id"],
        },
        headers=csrf_headers(client),
    )
    assert evaluation.status_code == 201
    evaluation_record = evaluation.json()
    assert evaluation_record["id"]
    assert evaluation_record["rubricId"] == seeded["rubric"]["id"]
    assert evaluation_record["subjectId"] == completed_run["id"]

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
