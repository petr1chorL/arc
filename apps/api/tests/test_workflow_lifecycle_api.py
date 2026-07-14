from fastapi.testclient import TestClient
import pytest

from api_test_support import create_authenticated_client, csrf_headers, workspace_url


def published_agent(client: TestClient, workspace_id: str) -> tuple[str, str]:
    agent = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": "Workflow Agent",
            "role": "Execute the workflow step and return output.",
            "owner": "Workflow Team",
            "model": "GPT-5",
        },
        headers=csrf_headers(client),
    ).json()
    version = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/publish"),
        headers=csrf_headers(client),
    ).json()
    return agent["id"], version["version"]


def valid_graph(agent_id: str, agent_version: str) -> dict:
    return {
        "nodes": [
            {"id": "start", "type": "trigger", "position": {"x": 0, "y": 0}, "data": {"label": "Start"}},
            {
                "id": "agent",
                "type": "agent",
                "position": {"x": 220, "y": 0},
                "data": {
                    "label": "Workflow Agent",
                    "agentId": agent_id,
                    "agentVersion": agent_version,
                },
            },
            {"id": "end", "type": "end", "position": {"x": 440, "y": 0}, "data": {"label": "End"}},
        ],
        "edges": [
            {"id": "start-agent", "source": "start", "target": "agent"},
            {"id": "agent-end", "source": "agent", "target": "end"},
        ],
    }


def create_data_object(client: TestClient, workspace_id: str, name: str) -> dict:
    response = client.post(
        workspace_url(workspace_id, "/data-objects"),
        json={
            "name": name,
            "description": "Workflow node data contract.",
            "schema": {
                "type": "object",
                "required": ["asin"],
                "properties": {"asin": {"type": "string"}},
            },
        },
        headers=csrf_headers(client),
    )
    assert response.status_code == 201
    return response.json()


def test_workflow_rejects_agent_version_from_another_workspace(tmp_path):
    client, source_workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'workflow-cross-workspace-agent.db'}",
    )
    agent_id, agent_version = published_agent(client, source_workspace_id)
    target_workspace_response = client.post(
        "/api/workspaces",
        json={"name": "Target Workspace", "slug": "target-workspace"},
        headers=csrf_headers(client),
    )
    assert target_workspace_response.status_code == 201
    target_workspace_id = target_workspace_response.json()["id"]
    workflow = client.post(
        workspace_url(target_workspace_id, "/workflows"),
        json={
            "name": "Cross Workspace Workflow",
            **valid_graph(agent_id, agent_version),
        },
        headers=csrf_headers(client),
    ).json()

    validation = client.post(
        workspace_url(target_workspace_id, f"/workflows/{workflow['id']}/validate"),
        headers=csrf_headers(client),
    )
    publish = client.post(
        workspace_url(target_workspace_id, f"/workflows/{workflow['id']}/publish"),
        headers=csrf_headers(client),
    )

    assert validation.status_code == 200
    assert validation.json()["valid"] is False
    assert validation.json()["errors"] == [
        f"Agent 版本 {agent_id}@{agent_version} 不存在",
    ]
    assert publish.status_code == 422
    assert publish.json()["detail"] == validation.json()["errors"]


def test_workflow_draft_publishes_an_immutable_snapshot(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'workflows.db'}")
    agent_id, agent_version = published_agent(client, workspace_id)
    graph = valid_graph(agent_id, agent_version)
    workflow = client.post(
        workspace_url(workspace_id, "/workflows"),
        json={"name": "Immutable Workflow", **graph},
        headers=csrf_headers(client),
    ).json()

    validation = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/validate"),
        headers=csrf_headers(client),
    )
    published = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/publish"),
        json={"note": "首版发布，冻结节点契约"},
        headers=csrf_headers(client),
    )

    assert validation.status_code == 200
    assert validation.json() == {"valid": True, "errors": []}
    assert published.status_code == 201
    assert published.json()["version"] == "v1.0.0"
    assert published.json()["note"] == "首版发布，冻结节点契约"
    openapi = client.get("/openapi.json").json()
    publish_operation = openapi["paths"]["/api/workspaces/{workspace_id}/workflows/{workflow_id}/publish"]["post"]
    assert "requestBody" in publish_operation

    changed_graph = valid_graph(agent_id, agent_version)
    changed_graph["nodes"][1]["data"]["label"] = "Edited Workflow Agent"
    client.patch(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}"),
        json={"name": "Immutable Workflow", **changed_graph},
        headers=csrf_headers(client),
    )
    versions = client.get(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/versions"),
    ).json()

    assert versions[0]["snapshot"]["nodes"][1]["data"]["label"] == "Workflow Agent"
    assert versions[0]["note"] == "首版发布，冻结节点契约"


def test_workflow_can_be_deleted_from_directory_without_removing_versions(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'workflow-delete.db'}")
    agent_id, agent_version = published_agent(client, workspace_id)
    workflow = client.post(
        workspace_url(workspace_id, "/workflows"),
        json={"name": "Deletable Workflow", **valid_graph(agent_id, agent_version)},
        headers=csrf_headers(client),
    ).json()
    publish = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/publish"),
        json={"note": "删除前发布版本"},
        headers=csrf_headers(client),
    )

    delete = client.delete(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}"),
        headers=csrf_headers(client),
    )
    directory = client.get(workspace_url(workspace_id, "/workflows")).json()
    versions = client.get(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/versions"),
    ).json()

    assert publish.status_code == 201
    assert delete.status_code == 204
    assert all(item["id"] != workflow["id"] for item in directory)
    assert versions[0]["version"] == "v1.0.0"
    assert versions[0]["note"] == "删除前发布版本"


def test_workflow_draft_persists_io_schema_and_freezes_it_in_versions(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'workflow-schema.db'}")
    agent_id, agent_version = published_agent(client, workspace_id)
    graph = valid_graph(agent_id, agent_version)
    input_schema = {
        "type": "object",
        "required": ["asin"],
        "properties": {
            "asin": {"type": "string", "description": "Amazon ASIN"},
        },
    }
    output_schema = {
        "type": "object",
        "required": ["summary"],
        "properties": {
            "summary": {"type": "string"},
        },
    }
    workflow = client.post(
        workspace_url(workspace_id, "/workflows"),
        json={
            "name": "Contract Workflow",
            "inputSchema": input_schema,
            "outputSchema": output_schema,
            **graph,
        },
        headers=csrf_headers(client),
    )

    assert workflow.status_code == 201
    created = workflow.json()
    assert created["inputSchema"] == input_schema
    assert created["outputSchema"] == output_schema

    updated_output_schema = {
        "type": "object",
        "required": ["decision"],
        "properties": {
            "decision": {"type": "string", "enum": ["pass", "review"]},
        },
    }
    updated = client.patch(
        workspace_url(workspace_id, f"/workflows/{created['id']}"),
        json={
            "name": "Contract Workflow",
            "inputSchema": input_schema,
            "outputSchema": updated_output_schema,
            **graph,
        },
        headers=csrf_headers(client),
    )

    assert updated.status_code == 200
    assert updated.json()["outputSchema"] == updated_output_schema

    published = client.post(
        workspace_url(workspace_id, f"/workflows/{created['id']}/publish"),
        headers=csrf_headers(client),
    )

    assert published.status_code == 201
    snapshot = published.json()["snapshot"]
    assert snapshot["inputSchema"] == input_schema
    assert snapshot["outputSchema"] == updated_output_schema


def test_workflow_edges_preserve_field_mappings_in_draft_and_versions(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'workflow-edge-mapping.db'}")
    agent_id, agent_version = published_agent(client, workspace_id)
    graph = valid_graph(agent_id, agent_version)
    graph["edges"][0]["data"] = {
        "mappings": [
            {"sourcePath": "$.asin", "targetPath": "$.input.asin"},
            {"sourcePath": "$.market", "targetPath": "$.input.market"},
        ],
    }

    workflow = client.post(
        workspace_url(workspace_id, "/workflows"),
        json={"name": "Mapped Workflow", **graph},
        headers=csrf_headers(client),
    )

    assert workflow.status_code == 201
    created = workflow.json()
    assert created["edges"][0]["data"]["mappings"][0] == {
        "sourcePath": "$.asin",
        "targetPath": "$.input.asin",
    }

    graph["edges"][0]["data"]["mappings"] = [
        {"sourcePath": "$.summary", "targetPath": "$.review.summary"},
    ]
    updated = client.patch(
        workspace_url(workspace_id, f"/workflows/{created['id']}"),
        json={"name": "Mapped Workflow", **graph},
        headers=csrf_headers(client),
    )

    assert updated.status_code == 200
    assert updated.json()["edges"][0]["data"]["mappings"] == [
        {"sourcePath": "$.summary", "targetPath": "$.review.summary"},
    ]

    published = client.post(
        workspace_url(workspace_id, f"/workflows/{created['id']}/publish"),
        headers=csrf_headers(client),
    )

    assert published.status_code == 201
    assert published.json()["snapshot"]["edges"][0]["data"]["mappings"] == [
        {"sourcePath": "$.summary", "targetPath": "$.review.summary"},
    ]


def test_workflow_validation_rejects_missing_or_unpublished_data_object_refs(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'workflow-data-object-validation.db'}",
    )
    agent_id, agent_version = published_agent(client, workspace_id)
    input_definition = create_data_object(client, workspace_id, "Product Research Input")
    output_definition = create_data_object(client, workspace_id, "Review Decision Output")
    published_input = client.post(
        workspace_url(workspace_id, f"/data-objects/{input_definition['id']}/publish"),
        headers=csrf_headers(client),
    )
    assert published_input.status_code == 201
    graph = valid_graph(agent_id, agent_version)
    graph["nodes"][1]["data"]["inputDataObjectRef"] = {
        "definitionId": input_definition["id"],
        "name": input_definition["name"],
        "version": "v1.0.0",
        "status": "published",
        "schemaSummary": "required: asin",
    }
    graph["nodes"][1]["data"]["outputDataObjectRef"] = {
        "definitionId": output_definition["id"],
        "name": output_definition["name"],
        "version": "unpublished",
        "status": "draft",
        "schemaSummary": "required: asin",
    }
    workflow = client.post(
        workspace_url(workspace_id, "/workflows"),
        json={"name": "Data Object Contract Workflow", **graph},
        headers=csrf_headers(client),
    ).json()

    validation = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/validate"),
        headers=csrf_headers(client),
    )
    published = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/publish"),
        headers=csrf_headers(client),
    )

    assert validation.status_code == 200
    assert validation.json()["valid"] is False
    assert any("输出 Data Object" in error and "未发布" in error for error in validation.json()["errors"])
    assert published.status_code == 422

    graph["nodes"][1]["data"]["outputDataObjectRef"] = {
        "definitionId": "missing-data-object",
        "name": "Missing Contract",
        "version": "v1.0.0",
        "status": "published",
        "schemaSummary": "object schema",
    }
    updated = client.patch(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}"),
        json={"name": "Data Object Contract Workflow", **graph},
        headers=csrf_headers(client),
    )
    assert updated.status_code == 200

    missing_validation = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/validate"),
        headers=csrf_headers(client),
    )

    assert missing_validation.status_code == 200
    assert missing_validation.json()["valid"] is False
    assert any("输出 Data Object" in error and "不存在" in error for error in missing_validation.json()["errors"])


def test_workflow_publish_freezes_data_object_version_snapshots(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'workflow-data-object-freeze.db'}",
    )
    agent_id, agent_version = published_agent(client, workspace_id)
    definition = create_data_object(client, workspace_id, "Product Research Input")
    first_data_object_version = client.post(
        workspace_url(workspace_id, f"/data-objects/{definition['id']}/publish"),
        headers=csrf_headers(client),
    ).json()
    graph = valid_graph(agent_id, agent_version)
    graph["nodes"][1]["data"]["inputDataObjectRef"] = {
        "definitionId": definition["id"],
        "name": definition["name"],
        "version": first_data_object_version["version"],
        "status": "published",
        "schemaSummary": "required: asin",
    }
    workflow = client.post(
        workspace_url(workspace_id, "/workflows"),
        json={"name": "Frozen Data Object Workflow", **graph},
        headers=csrf_headers(client),
    ).json()

    updated_definition = client.patch(
        workspace_url(workspace_id, f"/data-objects/{definition['id']}"),
        json={
            "name": "Updated Product Research Input",
            "schema": {
                "type": "object",
                "required": ["summary"],
                "properties": {"summary": {"type": "string"}},
            },
        },
        headers=csrf_headers(client),
    )
    assert updated_definition.status_code == 200
    second_data_object_version = client.post(
        workspace_url(workspace_id, f"/data-objects/{definition['id']}/publish"),
        headers=csrf_headers(client),
    )
    assert second_data_object_version.status_code == 201
    assert second_data_object_version.json()["version"] == "v1.1.0"

    published_workflow = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/publish"),
        headers=csrf_headers(client),
    )

    assert published_workflow.status_code == 201
    ref = published_workflow.json()["snapshot"]["nodes"][1]["data"]["inputDataObjectRef"]
    assert ref["version"] == "v1.0.0"
    assert ref["versionId"] == first_data_object_version["id"]
    assert ref["snapshot"]["name"] == "Product Research Input"
    assert ref["snapshot"]["schema"]["required"] == ["asin"]


def test_workflow_publish_rejects_cycles_and_unpublished_agent_references(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'workflows.db'}")
    graph = {
        "nodes": [
            {"id": "start", "type": "trigger", "position": {"x": 0, "y": 0}, "data": {"label": "Start"}},
            {
                "id": "agent",
                "type": "agent",
                "position": {"x": 220, "y": 0},
                "data": {
                    "label": "Missing Agent",
                    "agentId": "missing",
                    "agentVersion": "v1.0.0",
                },
            },
            {"id": "end", "type": "end", "position": {"x": 440, "y": 0}, "data": {"label": "End"}},
        ],
        "edges": [
            {"id": "one", "source": "start", "target": "agent"},
            {"id": "two", "source": "agent", "target": "end"},
            {"id": "cycle", "source": "end", "target": "start"},
        ],
    }
    workflow = client.post(
        workspace_url(workspace_id, "/workflows"),
        json={"name": "Invalid Workflow", **graph},
        headers=csrf_headers(client),
    ).json()

    validation = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/validate"),
        headers=csrf_headers(client),
    )
    published = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/publish"),
        headers=csrf_headers(client),
    )

    assert validation.status_code == 200
    assert validation.json()["valid"] is False
    errors = validation.json()["errors"]
    assert any("环" in error for error in errors)
    assert any("Agent" in error and "v1.0.0" in error for error in errors)
    assert published.status_code == 422


def test_workflow_publish_rejects_invalid_human_node_configuration(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'human-validation.db'}")
    graph = {
        "nodes": [
            {"id": "start", "type": "trigger", "position": {"x": 0, "y": 0}, "data": {"label": "Start"}},
            {
                "id": "human",
                "type": "human",
                "position": {"x": 220, "y": 0},
                "data": {
                    "label": "Human Review",
                    "assignmentType": "direct",
                    "reviewerIds": [],
                    "reviewPolicy": "threshold",
                    "requiredApprovals": 2,
                    "dueMinutes": 0,
                    "escalationMinutes": 0,
                },
            },
            {"id": "end", "type": "end", "position": {"x": 440, "y": 0}, "data": {"label": "End"}},
        ],
        "edges": [
            {"id": "start-human", "source": "start", "target": "human"},
            {"id": "human-end", "source": "human", "target": "end"},
        ],
    }
    workflow = client.post(
        workspace_url(workspace_id, "/workflows"),
        json={"name": "Invalid Human Workflow", **graph},
        headers=csrf_headers(client),
    ).json()

    validation = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/validate"),
        headers=csrf_headers(client),
    )
    published = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/publish"),
        headers=csrf_headers(client),
    )

    assert validation.status_code == 200
    assert validation.json()["valid"] is False
    errors = validation.json()["errors"]
    assert any("直接分配" in error for error in errors)
    assert any("通过人数" in error for error in errors)
    assert any("大于 0" in error for error in errors)
    assert any("晚于截止" in error for error in errors)
    assert published.status_code == 422

def _create_evaluation_model_provider(
    client: TestClient,
    workspace_id: str,
    name: str,
) -> dict:
    response = client.post(
        workspace_url(workspace_id, "/model-providers"),
        json={
            "name": name,
            "providerType": "openai-compatible",
            "baseUrl": "https://api.deepseek.com",
            "defaultModel": "deepseek-v4-pro",
            "secretRef": "DEEPSEEK_API_KEY",
        },
        headers=csrf_headers(client),
    )
    assert response.status_code == 201
    return response.json()


def _publish_evaluation_template(
    client: TestClient,
    workspace_id: str,
    name: str,
    *,
    provider_id: str | None = None,
    legacy: bool = False,
) -> tuple[dict, dict]:
    if legacy:
        body = {
            "name": name,
            "artifact": "Launch plan",
            "dimensions": [{"name": "Completeness", "weight": 100}],
            "gate": "Must be complete",
            "passScore": 80,
            "judgeType": "deterministic",
            "judgeModel": "",
        }
    else:
        assert provider_id is not None
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
            "passScore": 80,
            "judgeType": "llm",
            "judgeModel": "deepseek-v4-pro",
            "modelProviderId": provider_id,
        }
    created = client.post(
        workspace_url(workspace_id, "/evaluations/rubrics"),
        json=body,
        headers=csrf_headers(client),
    )
    assert created.status_code == 201
    rubric = created.json()
    published = client.post(
        workspace_url(workspace_id, f"/evaluations/rubrics/{rubric['id']}/publish"),
        headers=csrf_headers(client),
    )
    assert published.status_code == 201
    return rubric, published.json()


def _evaluation_graph(
    agent_id: str,
    agent_version: str,
    *,
    rubric_ref: dict | None,
    incoming_edges: int = 1,
) -> dict:
    evaluation_data = {"label": "Evaluate Output"}
    if rubric_ref is not None:
        evaluation_data["rubricRef"] = rubric_ref
    edges = [
        {"id": "start-agent", "source": "start", "target": "agent"},
        {"id": "evaluation-end", "source": "evaluation", "target": "end"},
    ]
    if incoming_edges >= 1:
        edges.append(
            {"id": "agent-evaluation", "source": "agent", "target": "evaluation"},
        )
    if incoming_edges >= 2:
        edges.append(
            {"id": "start-evaluation", "source": "start", "target": "evaluation"},
        )
    return {
        "nodes": [
            {
                "id": "start",
                "type": "trigger",
                "position": {"x": 0, "y": 0},
                "data": {"label": "Start"},
            },
            {
                "id": "agent",
                "type": "agent",
                "position": {"x": 220, "y": 0},
                "data": {
                    "label": "Workflow Agent",
                    "agentId": agent_id,
                    "agentVersion": agent_version,
                },
            },
            {
                "id": "evaluation",
                "type": "evaluation",
                "position": {"x": 440, "y": 0},
                "data": evaluation_data,
            },
            {
                "id": "end",
                "type": "end",
                "position": {"x": 660, "y": 0},
                "data": {"label": "End"},
            },
        ],
        "edges": edges,
    }


def _create_evaluation_workflow(
    client: TestClient,
    workspace_id: str,
    *,
    name: str,
    agent_id: str,
    agent_version: str,
    rubric_ref: dict | None,
    incoming_edges: int = 1,
) -> dict:
    response = client.post(
        workspace_url(workspace_id, "/workflows"),
        json={
            "name": name,
            **_evaluation_graph(
                agent_id,
                agent_version,
                rubric_ref=rubric_ref,
                incoming_edges=incoming_edges,
            ),
        },
        headers=csrf_headers(client),
    )
    assert response.status_code == 201
    return response.json()


def _assert_workflow_validation_rejects(
    client: TestClient,
    workspace_id: str,
    workflow_id: str,
) -> list[str]:
    validation = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow_id}/validate"),
        headers=csrf_headers(client),
    )
    published = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow_id}/publish"),
        headers=csrf_headers(client),
    )
    assert validation.status_code == 200
    assert validation.json()["valid"] is False
    errors = validation.json()["errors"]
    assert errors
    assert published.status_code == 422
    assert published.json()["detail"] == errors
    return errors


def _rubric_ref(rubric: dict, version: dict) -> dict:
    return {
        "rubricId": rubric["id"],
        "versionId": version["id"],
        "version": version["version"],
        "name": rubric["name"],
    }


@pytest.mark.parametrize("incoming_edges", [0, 2])
def test_workflow_evaluation_node_requires_exactly_one_incoming_edge(
    tmp_path,
    incoming_edges,
):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / f'evaluation-incoming-{incoming_edges}.db'}",
    )
    agent_id, agent_version = published_agent(client, workspace_id)
    provider = _create_evaluation_model_provider(
        client,
        workspace_id,
        f"Evaluation Provider {incoming_edges}",
    )
    rubric, version = _publish_evaluation_template(
        client,
        workspace_id,
        f"Evaluation Template {incoming_edges}",
        provider_id=provider["id"],
    )
    workflow = _create_evaluation_workflow(
        client,
        workspace_id,
        name=f"Invalid Evaluation Incoming {incoming_edges}",
        agent_id=agent_id,
        agent_version=agent_version,
        rubric_ref=_rubric_ref(rubric, version),
        incoming_edges=incoming_edges,
    )

    errors = _assert_workflow_validation_rejects(
        client,
        workspace_id,
        workflow["id"],
    )

    assert "评估节点 evaluation 必须恰好有 1 条入边" in errors


@pytest.mark.parametrize(
    ("case", "expected_error"),
    [
        ("missing_ref", "评估节点 evaluation 必须选择已发布评估模板版本"),
        ("cross_workspace", "评估节点 evaluation 的评分模板版本不存在"),
        ("legacy", "评估节点 evaluation 的评分模板版本不兼容工作流评估"),
        ("disabled_provider", "评估节点 evaluation 的模型 Provider 不可用"),
    ],
)
def test_workflow_evaluation_node_rejects_invalid_rubric_reference(
    tmp_path,
    case,
    expected_error,
):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / f'evaluation-ref-{case}.db'}",
    )
    agent_id, agent_version = published_agent(client, workspace_id)
    rubric_ref = None

    if case == "cross_workspace":
        foreign_workspace = client.post(
            "/api/workspaces",
            json={
                "name": "Foreign Evaluation Workspace",
                "slug": "foreign-evaluation-workspace",
            },
            headers=csrf_headers(client),
        )
        assert foreign_workspace.status_code == 201
        foreign_workspace_id = foreign_workspace.json()["id"]
        provider = _create_evaluation_model_provider(
            client,
            foreign_workspace_id,
            "Foreign Evaluation Provider",
        )
        rubric, version = _publish_evaluation_template(
            client,
            foreign_workspace_id,
            "Foreign Evaluation Template",
            provider_id=provider["id"],
        )
        rubric_ref = _rubric_ref(rubric, version)
    elif case == "legacy":
        rubric, version = _publish_evaluation_template(
            client,
            workspace_id,
            "Legacy Deterministic Template",
            legacy=True,
        )
        rubric_ref = _rubric_ref(rubric, version)
    elif case == "disabled_provider":
        provider = _create_evaluation_model_provider(
            client,
            workspace_id,
            "Disabled Evaluation Provider",
        )
        rubric, version = _publish_evaluation_template(
            client,
            workspace_id,
            "Disabled Provider Evaluation Template",
            provider_id=provider["id"],
        )
        deactivated = client.post(
            workspace_url(
                workspace_id,
                f"/model-providers/{provider['id']}/deactivate",
            ),
            headers=csrf_headers(client),
        )
        assert deactivated.status_code == 200
        rubric_ref = _rubric_ref(rubric, version)

    workflow = _create_evaluation_workflow(
        client,
        workspace_id,
        name=f"Invalid Evaluation Reference {case}",
        agent_id=agent_id,
        agent_version=agent_version,
        rubric_ref=rubric_ref,
    )

    errors = _assert_workflow_validation_rejects(
        client,
        workspace_id,
        workflow["id"],
    )

    assert expected_error in errors


def test_workflow_evaluation_node_publishes_and_keeps_pinned_template_version(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'evaluation-version-pin.db'}",
    )
    agent_id, agent_version = published_agent(client, workspace_id)
    provider = _create_evaluation_model_provider(
        client,
        workspace_id,
        "Pinned Evaluation Provider",
    )
    rubric, first_template_version = _publish_evaluation_template(
        client,
        workspace_id,
        "Pinned Evaluation Template",
        provider_id=provider["id"],
    )
    first_ref = _rubric_ref(rubric, first_template_version)
    workflow = _create_evaluation_workflow(
        client,
        workspace_id,
        name="Pinned Evaluation Workflow",
        agent_id=agent_id,
        agent_version=agent_version,
        rubric_ref=first_ref,
    )

    validation = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/validate"),
        headers=csrf_headers(client),
    )
    first_workflow_version = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/publish"),
        headers=csrf_headers(client),
    )

    assert validation.status_code == 200
    assert validation.json() == {"valid": True, "errors": []}
    assert first_workflow_version.status_code == 201
    first_snapshot_ref = first_workflow_version.json()["snapshot"]["nodes"][2]["data"]["rubricRef"]
    assert first_snapshot_ref["rubricId"] == rubric["id"]
    assert first_snapshot_ref["versionId"] == first_template_version["id"]
    assert first_snapshot_ref["version"] == first_template_version["version"]

    second_template_version = client.post(
        workspace_url(
            workspace_id,
            f"/evaluations/rubrics/{rubric['id']}/publish",
        ),
        headers=csrf_headers(client),
    )
    assert second_template_version.status_code == 201
    assert second_template_version.json()["id"] != first_template_version["id"]

    second_workflow_version = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/publish"),
        headers=csrf_headers(client),
    )
    assert second_workflow_version.status_code == 201
    second_snapshot_ref = second_workflow_version.json()["snapshot"]["nodes"][2]["data"]["rubricRef"]
    assert second_snapshot_ref["versionId"] == first_template_version["id"]
    assert second_snapshot_ref["version"] == first_template_version["version"]

    versions = client.get(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/versions"),
    )
    assert versions.status_code == 200
    frozen_refs = [
        version["snapshot"]["nodes"][2]["data"]["rubricRef"]
        for version in versions.json()
    ]
    assert len(frozen_refs) == 2
    assert {
        (ref["versionId"], ref["version"])
        for ref in frozen_refs
    } == {
        (first_template_version["id"], first_template_version["version"]),
    }
