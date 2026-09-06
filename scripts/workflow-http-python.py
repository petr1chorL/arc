"""Replay synthetic Workflow HTTP cases; stdin JSON, stdout full status/body JSON.

Input: {"tables": {"workflows": [...]}, "workspaceAlias": "a",
        "foreignWorkspaces": ["b"], "cases": [
          {"method": "POST", "path": "/workflows", "body": {...},
           "status": 201, "saveAs": "workflowId"},
          {"method": "GET", "path": "/workflows/{workflowId}", "status": 200}]}
Table workspace_id aliases map to real synthetic Workspace IDs. Cases default to
workspaceAlias and may select another alias with "workspace". String placeholders
{workspaceId}, {userId}, {organizationId}, and saveAs names resolve recursively.
No normalization: the caller owns timestamp/dynamic ID normalization. 204 body is null.
"""
import json
import os
from datetime import datetime
from pathlib import Path
import re
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "apps/api"), str(ROOT / "apps/api/tests")]
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["ENVIRONMENT"] = "development"
from app.config import Settings

Settings.model_config["env_file"] = None
from sqlalchemy import DateTime, delete, inspect, select
from app.models import (
    AgentRecord, AgentVersionRecord, DataObjectDefinitionRecord, DataObjectVersionRecord,
    ModelProviderRecord, ReviewGroupMemberRecord, ReviewGroupRecord, ReviewerRecord,
    RubricRecord, RubricVersionRecord, ToolSkillAssetRecord, UserRecord,
    WorkflowRecord, WorkflowVersionRecord, WorkspaceRecord,
)
from api_test_support import create_authenticated_client, csrf_headers, workspace_url

MODELS = [ModelProviderRecord, ToolSkillAssetRecord, AgentRecord, AgentVersionRecord,
          DataObjectDefinitionRecord, DataObjectVersionRecord, RubricRecord, RubricVersionRecord,
          ReviewerRecord, ReviewGroupRecord, ReviewGroupMemberRecord, WorkflowRecord, WorkflowVersionRecord]
ROUTES = re.compile(r"/(?:workflows(?:/[^/]+(?:/(?:validate|publish|versions))?)?|reviewers|review-groups)\Z")


def replay(data):
    tables = data.get("tables", {})
    assert set(tables) <= {model.__tablename__ for model in MODELS}, "Unknown synthetic table"
    with TemporaryDirectory(prefix="arc-workflow-http-") as directory:
        client, workspace_id = create_authenticated_client(f"sqlite:///{Path(directory) / 'contract.db'}")
        try:
            aliases = {data.get("workspaceAlias", "a"): workspace_id}
            with client.app.state.session_factory() as session:
                user = session.scalar(select(UserRecord).where(UserRecord.is_organization_admin.is_(True)))
                assert user is not None
                values = {"workspaceId": workspace_id, "userId": user.id, "organizationId": user.organization_id}
                for alias in data.get("foreignWorkspaces", []):
                    assert alias not in aliases, "Duplicate Workspace alias"
                    foreign = WorkspaceRecord(organization_id=user.organization_id, name=f"Synthetic {alias}", slug=f"synthetic-{alias}")
                    session.add(foreign)
                    session.flush()
                    aliases[alias] = foreign.id

                def resolve(value):
                    if isinstance(value, dict):
                        return {key: resolve(item) for key, item in value.items()}
                    if isinstance(value, list):
                        return [resolve(item) for item in value]
                    if isinstance(value, str):
                        return re.sub(r"\{([A-Za-z][A-Za-z0-9]*)\}", lambda match: str(values.get(match[1], match[0])), value)
                    return value

                # The temporary database is wholly synthetic; remove any application defaults.
                for model in reversed(MODELS):
                    session.execute(delete(model))
                for model in MODELS:
                    for source in tables.get(model.__tablename__, []):
                        row = resolve(source)
                        if "workspace_id" in row:
                            row["workspace_id"] = aliases.get(row["workspace_id"], row["workspace_id"])
                        for column in model.__table__.columns:
                            if isinstance(column.type, DateTime) and row.get(column.name) is not None:
                                row[column.name] = datetime.fromisoformat(row[column.name])
                        attributes = {column.name: prop.key for prop in inspect(model).column_attrs for column in prop.columns}
                        session.add(model(**{attributes.get(key, key): value for key, value in row.items()}))
                session.commit()
            results = []
            for index, case in enumerate(data["cases"]):
                target = aliases[case.get("workspace", data.get("workspaceAlias", "a"))]
                values["workspaceId"] = target
                path = resolve(case["path"])
                assert ROUTES.fullmatch(path) and "?" not in path and "%" not in path, "Only governance paths are accepted"
                method = case["method"].upper()
                assert method in {"GET", "POST", "PATCH", "DELETE"}, "Unsupported method"
                assert not path.startswith(("/reviewers", "/review-groups")) or method == "GET", "Directories are read-only"
                response = client.request(method, workspace_url(target, path), headers=csrf_headers(client),
                    **({"json": resolve(case["body"])} if "body" in case else {}))
                if "status" in case:
                    assert response.status_code == case["status"], (index, case.get("name", path), response.status_code, response.text)
                body = response.json() if response.content else None
                results.append({"status": response.status_code, "body": body})
                if "saveAs" in case:
                    assert 200 <= response.status_code < 300 and isinstance(body, dict) and "id" in body
                    values[case["saveAs"]] = body["id"]
            return results
        finally:
            client.close()
            client.app.state.session_factory.kw["bind"].dispose()


def self_test():
    graph = {"name": "Synthetic lifecycle", "nodes": [
        {"id": "start", "type": "trigger", "data": {}, "position": {"x": 0, "y": 0}},
        {"id": "end", "type": "end", "data": {}, "position": {"x": 1, "y": 0}}],
        "edges": [{"id": "edge", "source": "start", "target": "end"}]}
    cases = [
        {"method": "POST", "path": "/workflows", "body": graph, "status": 201, "saveAs": "workflowId"},
        {"method": "GET", "path": "/workflows/{workflowId}", "status": 200},
        {"method": "POST", "path": "/workflows/{workflowId}/validate", "status": 200},
        {"method": "POST", "path": "/workflows/{workflowId}/publish", "status": 201},
        {"method": "PATCH", "path": "/workflows/{workflowId}", "body": {**graph, "name": "Edited draft"}, "status": 200},
        {"method": "GET", "path": "/workflows/{workflowId}/versions", "status": 200},
        {"method": "DELETE", "path": "/workflows/{workflowId}", "status": 204},
        {"method": "GET", "path": "/workflows/{workflowId}", "status": 404},
        {"method": "GET", "path": "/workflows/{workflowId}", "workspace": "b", "status": 404},
        {"method": "GET", "path": "/reviewers", "status": 200},
        {"method": "GET", "path": "/review-groups", "status": 200},
    ]
    results = replay({"tables": {
        "reviewers": [{"id": "synthetic-reviewer", "workspace_id": "a", "user_id": "{userId}",
                       "name": "Synthetic expert", "role": "expert", "is_active": True, "is_expert": True,
                       "created_at": "2026-09-06T00:00:00+00:00"},
                      {"id": "foreign-reviewer", "workspace_id": "b", "name": "Foreign expert", "role": "expert"}],
    }, "foreignWorkspaces": ["b"], "cases": cases})
    assert results[2]["body"]["valid"] is True
    assert results[4]["body"]["name"] == "Edited draft"
    assert results[5]["body"][0]["snapshot"]["name"] == graph["name"]
    assert results[6]["body"] is None
    assert [row["id"] for row in results[9]["body"]] == ["synthetic-reviewer"]
    return {"passed": len(results), "checks": "synthetic lifecycle, immutable history, foreign scope and directories"}


if __name__ == "__main__":
    output = self_test() if sys.argv[1:] == ["--self-test"] else replay(json.loads(sys.stdin.buffer.read().decode("utf-8-sig")))
    print(json.dumps(output, ensure_ascii=True))
