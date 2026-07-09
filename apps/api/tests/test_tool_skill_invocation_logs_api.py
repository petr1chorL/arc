from datetime import datetime, timezone

from api_test_support import create_authenticated_client, csrf_headers, workspace_url
from app.models import (
    ToolSkillAssetInvocationRecord,
    ToolSkillAssetRecord,
    WorkspaceRecord,
)


def create_asset(client, workspace_id: str, *, name: str = "飞书搜索") -> dict:
    response = client.post(
        workspace_url(workspace_id, "/asset-library"),
        json={
            "assetType": "tool",
            "name": name,
            "description": "Search Feishu documents",
            "parameterSchema": {"type": "object"},
        },
        headers=csrf_headers(client),
    )
    assert response.status_code == 201
    return response.json()


def seed_invocation(
    client,
    *,
    workspace_id: str,
    asset_id: str,
    asset_name: str,
    status: str = "succeeded",
    agent_id: str = "agent-1",
    created_at: datetime | None = None,
) -> str:
    with client.app.state.session_factory() as session:
        record = ToolSkillAssetInvocationRecord(
            workspace_id=workspace_id,
            asset_id=asset_id,
            asset_type="tool",
            asset_name=asset_name,
            agent_id=agent_id,
            agent_version="v1.0.0",
            run_id="run-1",
            node_run_id="node-run-1",
            status=status,
            input_summary="query=price",
            output_summary="3 docs matched",
            error="",
            duration_ms=23,
            created_at=created_at or datetime(2026, 6, 27, 10, 0, tzinfo=timezone.utc),
        )
        session.add(record)
        session.commit()
        return record.id


def test_list_tool_skill_invocation_logs_with_filters(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'tool-skill-invocations.db'}",
    )
    asset = create_asset(client, workspace_id)
    seed_invocation(
        client,
        workspace_id=workspace_id,
        asset_id=asset["id"],
        asset_name=asset["name"],
        status="succeeded",
        agent_id="agent-1",
        created_at=datetime(2026, 6, 27, 10, 0, tzinfo=timezone.utc),
    )
    seed_invocation(
        client,
        workspace_id=workspace_id,
        asset_id=asset["id"],
        asset_name=asset["name"],
        status="failed",
        agent_id="agent-2",
        created_at=datetime(2026, 6, 27, 10, 5, tzinfo=timezone.utc),
    )

    all_logs = client.get(workspace_url(workspace_id, "/asset-library/invocations"))
    filtered = client.get(
        workspace_url(
            workspace_id,
            f"/asset-library/invocations?assetId={asset['id']}&agentId=agent-1&status=succeeded",
        ),
    )

    assert all_logs.status_code == 200
    assert [item["status"] for item in all_logs.json()] == ["failed", "succeeded"]
    assert filtered.status_code == 200
    assert len(filtered.json()) == 1
    assert filtered.json()[0]["assetId"] == asset["id"]
    assert filtered.json()[0]["assetName"] == "飞书搜索"
    assert filtered.json()[0]["agentId"] == "agent-1"
    assert filtered.json()[0]["inputSummary"] == "query=price"
    assert filtered.json()[0]["outputSummary"] == "3 docs matched"


def test_tool_skill_invocation_logs_are_workspace_scoped(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'tool-skill-invocations-scope.db'}",
    )
    asset = create_asset(client, workspace_id)
    with client.app.state.session_factory() as session:
        workspace = session.get(WorkspaceRecord, workspace_id)
        assert workspace is not None
        other_workspace = WorkspaceRecord(
            organization_id=workspace.organization_id,
            name="Other Workspace",
            slug="other-workspace",
            status="active",
        )
        session.add(other_workspace)
        session.flush()
        other_asset = ToolSkillAssetRecord(
            workspace_id=other_workspace.id,
            asset_type="tool",
            name="其他工具",
            description="Other tool",
            parameter_schema={"type": "object"},
            created_by="system",
            created_at=datetime(2026, 6, 27, 10, 0, tzinfo=timezone.utc),
            updated_at=datetime(2026, 6, 27, 10, 0, tzinfo=timezone.utc),
        )
        session.add(other_asset)
        session.flush()
        session.add(ToolSkillAssetInvocationRecord(
            workspace_id=other_workspace.id,
            asset_id=other_asset.id,
            asset_type="tool",
            asset_name=other_asset.name,
            agent_id="other-agent",
            agent_version="v1.0.0",
            run_id="other-run",
            node_run_id="other-node",
            status="succeeded",
            input_summary="other input",
            output_summary="other output",
            error="",
            duration_ms=10,
            created_at=datetime(2026, 6, 27, 10, 0, tzinfo=timezone.utc),
        ))
        session.commit()

    seed_invocation(
        client,
        workspace_id=workspace_id,
        asset_id=asset["id"],
        asset_name=asset["name"],
    )
    response = client.get(workspace_url(workspace_id, "/asset-library/invocations"))

    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["assetId"] == asset["id"]
