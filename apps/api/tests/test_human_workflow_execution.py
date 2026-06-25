from dataclasses import dataclass

from fastapi.testclient import TestClient

from app.main import create_app


@dataclass
class FakeModelResult:
    content: str
    model: str = "fake-model"
    prompt_tokens: int = 12
    completion_tokens: int = 8


class FakeGateway:
    def __init__(self, results: list[FakeModelResult | Exception]):
        self.results = results
        self.calls: list[dict] = []

    def complete(self, **request):
        self.calls.append(request)
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def create_human_workflow(
    client: TestClient,
    human_data: dict | None = None,
    *,
    post_human_agent: bool = False,
) -> dict:
    agent = client.post(
        "/api/agents",
        json={
            "name": "审核前 Agent",
            "role": "生成需要人工确认的业务结论",
            "owner": "平台组",
            "model": "configured-model",
        },
    ).json()
    version = client.post(f"/api/agents/{agent['id']}/publish").json()
    nodes = [
        {
            "id": "start",
            "type": "trigger",
            "position": {"x": 0, "y": 0},
            "data": {"label": "开始"},
        },
        {
            "id": "agent-1",
            "type": "agent",
            "position": {"x": 220, "y": 0},
            "data": {
                "label": "审核前 Agent",
                "agentId": agent["id"],
                "agentVersion": version["version"],
            },
        },
        {
            "id": "human-1",
            "type": "human",
            "position": {"x": 440, "y": 0},
            "data": {
                "label": "人工审核",
                "assignmentType": "group_claim",
                "reviewPolicy": "any_one",
                "requiredApprovals": 1,
                "reviewerIds": [],
                **(human_data or {}),
            },
        },
    ]
    edges = [
        {"id": "start-agent", "source": "start", "target": "agent-1"},
        {"id": "agent-human", "source": "agent-1", "target": "human-1"},
    ]
    if post_human_agent:
        nodes.append({
            "id": "agent-2",
            "type": "agent",
            "position": {"x": 660, "y": 0},
            "data": {
                "label": "审核后 Agent",
                "agentId": agent["id"],
                "agentVersion": version["version"],
                "retryMaxAttempts": 2,
            },
        })
        edges.append({"id": "human-agent-2", "source": "human-1", "target": "agent-2"})
        end_x = 880
        end_source = "agent-2"
    else:
        end_x = 660
        end_source = "human-1"
    nodes.append({
        "id": "end",
        "type": "end",
        "position": {"x": end_x, "y": 0},
        "data": {"label": "结束"},
    })
    edges.append({"id": "to-end", "source": end_source, "target": "end"})
    workflow = client.post(
        "/api/workflows",
        json={
            "name": "人工协作流程",
            "nodes": nodes,
            "edges": edges,
        },
    ).json()
    published = client.post(f"/api/workflows/{workflow['id']}/publish")
    assert published.status_code == 201
    return workflow


def test_human_node_pauses_workflow_and_creates_task(tmp_path):
    gateway = FakeGateway([
        FakeModelResult("这是一段需要人工确认且长度足够的业务结论。"),
    ])
    client = TestClient(create_app(f"sqlite:///{tmp_path / 'human-workflow.db'}", gateway))
    workflow = create_human_workflow(client)

    response = client.post(
        f"/api/workflows/{workflow['id']}/runs",
        json={"input": "生成一份等待人工审核的结论"},
    )

    assert response.status_code == 201
    run = response.json()
    assert run["status"] == "等待审核"
    assert [node["nodeType"] for node in run["nodes"]] == ["trigger", "agent", "human"]
    assert run["nodes"][-1]["status"] == "等待审核"

    tasks_response = client.get("/api/human-tasks")
    assert tasks_response.status_code == 200
    tasks = tasks_response.json()
    assert len(tasks) == 1
    assert tasks[0]["workflowRunId"] == run["id"]
    assert tasks[0]["sourceNodeId"] == "agent-1"

    detail_response = client.get(f"/api/human-tasks/{tasks[0]['id']}")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["artifact"]["content"].startswith("这是一段需要人工确认")
    assert detail["run"]["status"] == "等待审核"
    assert detail["run"]["currentNode"] == "人工审核"
    assert detail["approvalProgress"] == {"required": 1, "received": 0}


def paused_run(
    tmp_path,
    results: list[FakeModelResult],
) -> tuple[TestClient, FakeGateway, dict, dict, dict]:
    gateway = FakeGateway(results)
    client = TestClient(create_app(f"sqlite:///{tmp_path / 'review-outcome.db'}", gateway))
    workflow = create_human_workflow(client)
    run = client.post(
        f"/api/workflows/{workflow['id']}/runs",
        json={"input": "生成等待审核的结论"},
    ).json()
    task = client.get("/api/human-tasks").json()[0]
    reviewer = client.get("/api/reviewers").json()[0]
    return client, gateway, run, task, reviewer


def submit_decision(
    client: TestClient,
    task: dict,
    reviewer: dict,
    decision: str,
    *,
    modified_content: str | None = None,
    idempotency_key: str | None = None,
):
    body = {
        "reviewerId": reviewer["id"],
        "decision": decision,
        "reason": f"{decision} 的审核原因",
        "artifactVersionId": task["artifactVersionId"],
        "idempotencyKey": idempotency_key or f"{task['id']}-{decision}",
    }
    if modified_content is not None:
        body["modifiedContent"] = modified_content
        body["tags"] = ["人工修订", "高质量"]
    return client.post(f"/api/human-tasks/{task['id']}/decisions", json=body)


def test_approve_resumes_downstream_once(tmp_path):
    client, _, run, task, reviewer = paused_run(
        tmp_path,
        [FakeModelResult("这是一段等待直接通过且长度足够的业务结论。")],
    )

    first = submit_decision(
        client,
        task,
        reviewer,
        "approve",
        idempotency_key="approve-once",
    )
    repeated = submit_decision(
        client,
        task,
        reviewer,
        "approve",
        idempotency_key="approve-once",
    )

    assert first.status_code == 200
    assert repeated.status_code == 200
    persisted = client.get(f"/api/runs/{run['id']}").json()
    assert persisted["status"] == "已完成"
    assert [node["nodeType"] for node in persisted["nodes"]].count("end") == 1


def test_modify_and_approve_uses_new_artifact_version(tmp_path):
    client, _, run, task, reviewer = paused_run(
        tmp_path,
        [FakeModelResult("这是一段需要人工修订且长度足够的原始业务结论。")],
    )
    modified = "这是人工修订后的正式业务结论，应作为后续节点的输入。"

    response = submit_decision(
        client,
        task,
        reviewer,
        "modify_and_approve",
        modified_content=modified,
    )

    assert response.status_code == 200
    detail = response.json()
    assert detail["status"] == "修改后通过"
    assert detail["artifact"]["content"] == modified
    assert detail["artifact"]["version"] == 2
    persisted = client.get(f"/api/runs/{run['id']}").json()
    assert persisted["status"] == "已完成"
    assert persisted["output"] == modified


def test_return_for_rerun_executes_source_agent_and_pauses_again(tmp_path):
    client, gateway, run, task, reviewer = paused_run(
        tmp_path,
        [
            FakeModelResult("第一版需要退回重跑且长度足够的业务结论。"),
            FakeModelResult("第二版重跑后生成且长度足够的业务结论。"),
        ],
    )

    response = submit_decision(client, task, reviewer, "return_for_rerun")

    assert response.status_code == 200
    persisted = client.get(f"/api/runs/{run['id']}").json()
    assert persisted["status"] == "等待审核"
    assert [node["nodeType"] for node in persisted["nodes"]].count("agent") == 2
    assert len(gateway.calls) == 2
    tasks = client.get("/api/human-tasks").json()
    assert len(tasks) == 2
    assert tasks[0]["id"] != task["id"]


def test_reject_terminates_without_running_downstream(tmp_path):
    client, _, run, task, reviewer = paused_run(
        tmp_path,
        [FakeModelResult("这是一段将被人工驳回且长度足够的业务结论。")],
    )

    response = submit_decision(client, task, reviewer, "reject")

    assert response.status_code == 200
    persisted = client.get(f"/api/runs/{run['id']}").json()
    assert persisted["status"] == "已驳回"
    assert all(node["nodeType"] != "end" for node in persisted["nodes"])


def test_failed_resume_can_retry_without_new_decision(tmp_path):
    gateway = FakeGateway([
        FakeModelResult("这是一段准备进入人工审核且长度足够的业务结论。"),
        RuntimeError("temporary downstream failure"),
        RuntimeError("temporary downstream failure"),
        FakeModelResult("恢复重试后成功生成且长度足够的下游业务结论。"),
    ])
    client = TestClient(create_app(f"sqlite:///{tmp_path / 'resume-retry.db'}", gateway))
    workflow = create_human_workflow(client, post_human_agent=True)
    run = client.post(
        f"/api/workflows/{workflow['id']}/runs",
        json={"input": "执行带恢复失败的流程"},
    ).json()
    task = client.get("/api/human-tasks").json()[0]
    reviewer = client.get("/api/reviewers").json()[0]

    failed = submit_decision(client, task, reviewer, "approve")

    assert failed.status_code == 200
    assert failed.json()["status"] == "恢复失败"
    assert client.get(f"/api/runs/{run['id']}").json()["status"] == "恢复失败"

    retried = client.post(f"/api/human-tasks/{task['id']}/retry-resume")

    assert retried.status_code == 200
    assert retried.json()["status"] == "已通过"
    persisted = client.get(f"/api/runs/{run['id']}").json()
    assert persisted["status"] == "已完成"
    assert persisted["output"].startswith("恢复重试后成功")
