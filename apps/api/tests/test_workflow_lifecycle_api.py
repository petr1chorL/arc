from fastapi.testclient import TestClient

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
