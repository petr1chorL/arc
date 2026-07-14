import json

import pytest
from sqlalchemy import func, select

from api_test_support import create_authenticated_client, csrf_headers, workspace_url
from app.judge_gateway import JudgeGatewayResult
from app.models import (
    ArtifactRecord,
    EvaluationRecord,
    HumanReviewRecord,
    NodeRunRecord,
    WorkflowVersionRecord,
)
from test_execution_api import FakeGateway, FakeModelResult, create_published_agent


class FakeJudgeGateway:
    def __init__(self, results: list[JudgeGatewayResult | Exception]):
        self.results = list(results)
        self.calls: list[dict] = []

    def evaluate(self, **request) -> JudgeGatewayResult:
        self.calls.append(request)
        if not self.results:
            raise AssertionError("Judge must not be called")
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class SensitiveJudgeFailure(RuntimeError):
    def __init__(self) -> None:
        super().__init__("provider-secret-detail: sk-live-sensitive")
        self.prompt_tokens = 13
        self.completion_tokens = 7
        self.attempts = 2
        self.model = "failed-judge-model"


def _judge_result(
    *,
    evidence_score: int = 91,
    actionability_score: int = 84,
) -> JudgeGatewayResult:
    return JudgeGatewayResult(
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
        rationale="Evidence is grounded and the action plan is executable.",
        model="served-evaluation-model",
        input_snapshot={"judgePromptVersion": "llm-judge-explainable-v1"},
        prompt_tokens=23,
        completion_tokens=17,
        attempts=1,
    )


def _create_model_provider(client, workspace_id: str, name: str) -> dict:
    response = client.post(
        workspace_url(workspace_id, "/model-providers"),
        json={
            "name": name,
            "providerType": "openai-compatible",
            "baseUrl": "https://api.deepseek.com",
            "defaultModel": "provider-default-model",
            "secretRef": "DEEPSEEK_API_KEY",
        },
        headers=csrf_headers(client),
    )
    assert response.status_code == 201
    return response.json()


def _publish_template(
    client,
    workspace_id: str,
    provider_id: str,
    *,
    name: str,
    pass_score: int = 80,
) -> tuple[dict, dict, dict]:
    body = {
        "name": name,
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
        "passScore": pass_score,
        "judgeType": "llm",
        "judgeModel": "template-pinned-model",
        "modelProviderId": provider_id,
    }
    created = client.post(
        workspace_url(workspace_id, "/evaluations/rubrics"),
        json=body,
        headers=csrf_headers(client),
    )
    assert created.status_code == 201
    published = client.post(
        workspace_url(
            workspace_id,
            f"/evaluations/rubrics/{created.json()['id']}/publish",
        ),
        headers=csrf_headers(client),
    )
    assert published.status_code == 201
    return created.json(), published.json(), body


def _rubric_ref(rubric: dict, version: dict) -> dict:
    return {
        "rubricId": rubric["id"],
        "versionId": version["id"],
        "version": version["version"],
        "name": rubric["name"],
    }


def _publish_workflow(
    client,
    workspace_id: str,
    *,
    agent: dict,
    agent_version: dict,
    rubric_ref: dict,
    include_downstream: bool,
) -> dict:
    nodes = [
        {
            "id": "start",
            "type": "trigger",
            "position": {"x": 0, "y": 0},
            "data": {"label": "Start"},
        },
        {
            "id": "source-agent",
            "type": "agent",
            "position": {"x": 200, "y": 0},
            "data": {
                "label": "Source Agent",
                "agentId": agent["id"],
                "agentVersion": agent_version["version"],
            },
        },
        {
            "id": "evaluation",
            "type": "evaluation",
            "position": {"x": 400, "y": 0},
            "data": {
                "label": "Evaluate Source Output",
                "rubricRef": rubric_ref,
            },
        },
    ]
    edges = [
        {"id": "start-source", "source": "start", "target": "source-agent"},
        {
            "id": "source-evaluation",
            "source": "source-agent",
            "target": "evaluation",
        },
    ]
    end_source = "evaluation"
    if include_downstream:
        nodes.append({
            "id": "downstream-agent",
            "type": "agent",
            "position": {"x": 600, "y": 0},
            "data": {
                "label": "Downstream Agent",
                "agentId": agent["id"],
                "agentVersion": agent_version["version"],
            },
        })
        edges.append({
            "id": "evaluation-downstream",
            "source": "evaluation",
            "target": "downstream-agent",
        })
        end_source = "downstream-agent"
    nodes.append({
        "id": "end",
        "type": "end",
        "position": {"x": 800, "y": 0},
        "data": {"label": "End"},
    })
    edges.append({"id": "to-end", "source": end_source, "target": "end"})

    created = client.post(
        workspace_url(workspace_id, "/workflows"),
        json={"name": "Evaluation Workflow", "nodes": nodes, "edges": edges},
        headers=csrf_headers(client),
    )
    assert created.status_code == 201
    published = client.post(
        workspace_url(workspace_id, f"/workflows/{created.json()['id']}/publish"),
        headers=csrf_headers(client),
    )
    assert published.status_code == 201
    return created.json()


def test_evaluation_node_uses_pinned_version_and_persists_structured_result(tmp_path):
    gateway = FakeGateway([
        FakeModelResult(
            "Evidence-backed launch plan with owners, deliverables, and next actions.",
        ),
        FakeModelResult("The downstream agent consumed the evaluation result."),
    ])
    judge = FakeJudgeGateway([_judge_result()])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'evaluation-workflow-success.db'}",
        model_gateway=gateway,
        judge_gateway=judge,
    )
    agent, agent_version = create_published_agent(client, workspace_id)
    provider = _create_model_provider(client, workspace_id, "Workflow Evaluation Provider")
    rubric, pinned_version, body = _publish_template(
        client,
        workspace_id,
        provider["id"],
        name="Pinned Workflow Evaluation Template",
    )
    workflow = _publish_workflow(
        client,
        workspace_id,
        agent=agent,
        agent_version=agent_version,
        rubric_ref=_rubric_ref(rubric, pinned_version),
        include_downstream=True,
    )
    updated = client.patch(
        workspace_url(workspace_id, f"/evaluations/rubrics/{rubric['id']}"),
        json={**body, "passScore": 95},
        headers=csrf_headers(client),
    )
    assert updated.status_code == 200
    latest_version = client.post(
        workspace_url(workspace_id, f"/evaluations/rubrics/{rubric['id']}/publish"),
        headers=csrf_headers(client),
    )
    assert latest_version.status_code == 201
    assert latest_version.json()["id"] != pinned_version["id"]

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Produce a launch plan and evaluate it."},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    assert response.json()["status"] == "已完成"
    run_id = response.json()["id"]
    with client.app.state.session_factory() as session:
        source_node = session.scalar(select(NodeRunRecord).where(
            NodeRunRecord.run_id == run_id,
            NodeRunRecord.node_id == "source-agent",
        ))
        evaluation_node = session.scalar(select(NodeRunRecord).where(
            NodeRunRecord.run_id == run_id,
            NodeRunRecord.node_id == "evaluation",
        ))
        record = session.scalar(select(EvaluationRecord).where(
            EvaluationRecord.workspace_id == workspace_id,
        ))
        assert source_node is not None
        assert evaluation_node is not None
        assert record is not None
        assert evaluation_node.status == "已完成"
        assert evaluation_node.model == "served-evaluation-model"
        assert evaluation_node.prompt_tokens == 23
        assert evaluation_node.completion_tokens == 17
        assert evaluation_node.total_tokens == 40
        assert evaluation_node.attempts == 1
        assert evaluation_node.cost_usd == 0

        assert record.rubric_version == pinned_version["version"]
        assert record.score == 88
        assert record.status == "passed"
        assert record.subject_type == "node_run"
        assert record.subject_id == source_node.id

        output = json.loads(evaluation_node.output_text)
        assert output["evaluationRecordId"] == record.id
        assert output["templateId"] == rubric["id"]
        assert output["templateVersion"] == pinned_version["version"]
        assert output["modelProviderId"] == provider["id"]
        assert output["modelProviderName"] == provider["name"]
        assert output["model"] == "served-evaluation-model"
        assert output["totalScore"] == 88
        assert output["passed"] is True
        assert output["overallReason"] == (
            "Evidence is grounded and the action plan is executable."
        )
        assert [
            (dimension["dimensionName"], dimension["score"], dimension["reason"])
            for dimension in output["dimensions"]
        ] == [
            ("Evidence", 91, "The artifact cites concrete customer evidence."),
            ("Actionability", 84, "The next actions have owners and deliverables."),
        ]

        artifact = session.scalar(select(ArtifactRecord).where(
            ArtifactRecord.source_node_run_id == evaluation_node.id,
        ))
        assert artifact is not None
        assert json.loads(artifact.content) == output
        assert artifact.source_node_run_id != source_node.id

    assert judge.calls[0]["rubric_version"] == pinned_version["version"]
    assert judge.calls[0]["subject_type"] == "node_run"
    assert judge.calls[0]["subject_id"] == source_node.id


def test_failed_score_completes_evaluation_without_implicit_human_review(tmp_path):
    gateway = FakeGateway([
        FakeModelResult(
            "A complete but weak launch plan with enough text for the source Agent.",
        ),
    ])
    judge = FakeJudgeGateway([_judge_result(evidence_score=30, actionability_score=40)])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'evaluation-workflow-low-score.db'}",
        model_gateway=gateway,
        judge_gateway=judge,
    )
    agent, agent_version = create_published_agent(client, workspace_id)
    provider = _create_model_provider(client, workspace_id, "Low Score Provider")
    rubric, version, _ = _publish_template(
        client,
        workspace_id,
        provider["id"],
        name="Low Score Evaluation Template",
    )
    workflow = _publish_workflow(
        client,
        workspace_id,
        agent=agent,
        agent_version=agent_version,
        rubric_ref=_rubric_ref(rubric, version),
        include_downstream=False,
    )

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Produce a weak launch plan."},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    assert response.json()["status"] == "已完成"
    with client.app.state.session_factory() as session:
        evaluation_node = session.scalar(select(NodeRunRecord).where(
            NodeRunRecord.run_id == response.json()["id"],
            NodeRunRecord.node_id == "evaluation",
        ))
        record = session.scalar(select(EvaluationRecord))
        assert evaluation_node is not None
        assert record is not None
        assert evaluation_node.status == "已完成"
        assert record.status == "failed"
        assert record.score == 34
        output = json.loads(evaluation_node.output_text)
        assert output["totalScore"] == 34
        assert output["passed"] is False
        assert session.scalar(
            select(func.count()).select_from(HumanReviewRecord),
        ) == 0


@pytest.mark.parametrize("failure_kind", ["judge", "template"])
def test_evaluation_failure_stops_downstream_and_redacts_error(tmp_path, failure_kind):
    gateway = FakeGateway([
        FakeModelResult(
            "Evidence-backed source output that should reach the evaluation node.",
        ),
        FakeModelResult("The downstream node must never execute."),
    ])
    judge_results = [SensitiveJudgeFailure()] if failure_kind == "judge" else []
    judge = FakeJudgeGateway(judge_results)
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / f'evaluation-workflow-failure-{failure_kind}.db'}",
        model_gateway=gateway,
        judge_gateway=judge,
    )
    agent, agent_version = create_published_agent(client, workspace_id)
    provider = _create_model_provider(client, workspace_id, f"Failure Provider {failure_kind}")
    rubric, version, _ = _publish_template(
        client,
        workspace_id,
        provider["id"],
        name=f"Failure Evaluation Template {failure_kind}",
    )
    workflow = _publish_workflow(
        client,
        workspace_id,
        agent=agent,
        agent_version=agent_version,
        rubric_ref=_rubric_ref(rubric, version),
        include_downstream=True,
    )
    if failure_kind == "template":
        disabled = client.post(
            workspace_url(
                workspace_id,
                f"/model-providers/{provider['id']}/deactivate",
            ),
            headers=csrf_headers(client),
        )
        assert disabled.status_code == 200

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Run the failing evaluation workflow."},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    assert response.json()["status"] == "失败"
    assert "provider-secret-detail" not in response.text
    assert "sk-live-sensitive" not in response.text
    with client.app.state.session_factory() as session:
        evaluation_node = session.scalar(select(NodeRunRecord).where(
            NodeRunRecord.run_id == response.json()["id"],
            NodeRunRecord.node_id == "evaluation",
        ))
        downstream_node = session.scalar(select(NodeRunRecord).where(
            NodeRunRecord.run_id == response.json()["id"],
            NodeRunRecord.node_id == "downstream-agent",
        ))
        assert evaluation_node is not None
        assert evaluation_node.status == "失败"
        assert evaluation_node.error
        assert "provider-secret-detail" not in evaluation_node.error
        assert "sk-live-sensitive" not in evaluation_node.error
        assert downstream_node is None
        if failure_kind == "judge":
            assert evaluation_node.model == "failed-judge-model"
            assert evaluation_node.prompt_tokens == 13
            assert evaluation_node.completion_tokens == 7
            assert evaluation_node.total_tokens == 20
            assert evaluation_node.attempts == 2
            assert evaluation_node.cost_usd == 0

        assert session.scalar(
            select(func.count()).select_from(EvaluationRecord),
        ) == 0
        assert session.scalar(select(func.count()).select_from(ArtifactRecord).where(
            ArtifactRecord.source_node_run_id == evaluation_node.id,
        )) == 0

    assert len(gateway.calls) == 1
    assert len(judge.calls) == (1 if failure_kind == "judge" else 0)

@pytest.mark.parametrize("incoming_count", [0, 2])
def test_runtime_rejects_invalid_evaluation_predecessor_count(tmp_path, incoming_count):
    gateway = FakeGateway([
        FakeModelResult("Evidence-backed source output with owners and next actions."),
        FakeModelResult("Downstream must not execute."),
    ])
    judge = FakeJudgeGateway([_judge_result()])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / f'evaluation-invalid-incoming-{incoming_count}.db'}",
        model_gateway=gateway,
        judge_gateway=judge,
    )
    agent, agent_version = create_published_agent(client, workspace_id)
    provider = _create_model_provider(client, workspace_id, "Incoming Edge Provider")
    rubric, version, _ = _publish_template(
        client,
        workspace_id,
        provider["id"],
        name="Incoming Edge Template",
    )
    workflow = _publish_workflow(
        client,
        workspace_id,
        agent=agent,
        agent_version=agent_version,
        rubric_ref=_rubric_ref(rubric, version),
        include_downstream=True,
    )
    with client.app.state.session_factory() as session:
        workflow_version = session.scalar(select(WorkflowVersionRecord).where(
            WorkflowVersionRecord.workflow_id == workflow["id"],
            WorkflowVersionRecord.workspace_id == workspace_id,
        ))
        assert workflow_version is not None
        snapshot = dict(workflow_version.snapshot)
        edges = [
            dict(edge)
            for edge in snapshot["edges"]
            if not (
                incoming_count == 0
                and edge["source"] == "source-agent"
                and edge["target"] == "evaluation"
            )
        ]
        if incoming_count == 2:
            edges.append({
                "id": "corrupt-extra-evaluation-edge",
                "source": "start",
                "target": "evaluation",
            })
        snapshot["edges"] = edges
        workflow_version.snapshot = snapshot
        session.commit()

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Run a corrupt workflow snapshot."},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    assert response.json()["status"] == "失败"
    run_id = response.json()["id"]
    with client.app.state.session_factory() as session:
        evaluation_node = session.scalar(select(NodeRunRecord).where(
            NodeRunRecord.run_id == run_id,
            NodeRunRecord.node_id == "evaluation",
        ))
        assert evaluation_node is not None
        assert evaluation_node.status == "失败"
        assert evaluation_node.error == "评估节点必须恰好有 1 个已完成上游节点"
        assert session.scalar(select(func.count()).select_from(EvaluationRecord)) == 0
        assert session.scalar(select(func.count()).select_from(ArtifactRecord).where(
            ArtifactRecord.source_node_run_id == evaluation_node.id,
        )) == 0
        assert session.scalar(select(func.count()).select_from(NodeRunRecord).where(
            NodeRunRecord.run_id == run_id,
            NodeRunRecord.node_id.in_(["downstream-agent", "end"]),
        )) == 0
    assert judge.calls == []
    assert len(gateway.calls) <= 1
