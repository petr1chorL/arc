"""Workflow governance error projection; execution routes retain their contract."""
from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy import select

from app.reference_asset_http import asset_validation_error_handler
from app.schemas import WorkflowRead, WorkflowNode, WorkflowEdge, VersionRead
from app.models import AgentVersionRecord, DataObjectVersionRecord, RubricVersionRecord

HISTORY_ERROR = '历史 Workflow 数据结构不符合要求，需先完成治理'


async def workflow_validation_error_handler(request: Request, error: RequestValidationError):
    parts = request.url.path.strip('/').split('/')
    if (parts[:2] == ['api', 'workspaces'] and len(parts) >= 4 and parts[3] == 'workflows'
            and ((len(parts) == 4 and request.method == 'POST')
                 or (len(parts) == 5 and request.method == 'PATCH')
                 or (len(parts) == 6 and parts[5] == 'publish' and request.method == 'POST'))):
        return JSONResponse(status_code=422, content={'detail': 'Workflow 请求字段不符合要求'})
    return await asset_validation_error_handler(request, error)


def require_workflow_read(value: object) -> WorkflowRead:
    try:
        result = WorkflowRead.model_validate(value)
        for node in result.nodes:
            WorkflowNode.model_validate(node)
        for edge in result.edges:
            WorkflowEdge.model_validate(edge)
        return result
    except ValidationError:
        raise HTTPException(status_code=409, detail=HISTORY_ERROR) from None


def require_workflow_version(record, session, workspace_id: str) -> None:
    try:
        VersionRead.model_validate(record)
        if not isinstance(record.snapshot, dict):
            raise ValueError
        snapshot = record.snapshot
        value = dict(snapshot)
        for public, internal in [('inputSchema', 'input_schema'), ('outputSchema', 'output_schema'),
                                 ('createdAt', 'created_at'), ('updatedAt', 'updated_at')]:
            if public in value:
                value[internal] = value[public]
        parsed = require_workflow_read(value)
        if parsed.id != record.workflow_id:
            raise ValueError
        for node in parsed.nodes:
            data = node['data']
            references = []
            if node['type'] == 'agent':
                references.append((AgentVersionRecord, 'agent_id', data.get('agentId'), data.get('agentVersion'), None))
            for field in ['inputDataObjectRef', 'outputDataObjectRef']:
                ref = data.get(field)
                if ref:
                    if not isinstance(ref, dict):
                        raise ValueError
                    if 'snapshot' in ref:
                        embedded = ref['snapshot']
                        if (not isinstance(embedded, dict) or embedded.get('id') != ref.get('definitionId')
                                or not isinstance(embedded.get('schema'), dict)):
                            raise ValueError
                    references.append((DataObjectVersionRecord, 'definition_id', ref.get('definitionId'), ref.get('version'), ref.get('versionId')))
            if node['type'] == 'evaluation':
                ref = data.get('rubricRef')
                if not isinstance(ref, dict):
                    raise ValueError
                references.append((RubricVersionRecord, 'rubric_id', ref.get('rubricId'), ref.get('version'), ref.get('versionId')))
            for model, key, parent_id, version, version_id in references:
                if not isinstance(parent_id, str) or not isinstance(version, str):
                    raise ValueError
                # Publication trims Rubric identity fields only; keep stored JSON untouched.
                if model is RubricVersionRecord:
                    parent_id, version = parent_id.strip(), version.strip()
                    if isinstance(version_id, str):
                        version_id = version_id.strip()
                query = select(model.id).where(model.workspace_id == workspace_id, getattr(model, key) == parent_id, model.version == version)
                if version_id is not None:
                    if not isinstance(version_id, str):
                        raise ValueError
                    query = query.where(model.id == version_id)
                if session.scalar(query) is None:
                    raise ValueError
    except (ValidationError, ValueError, TypeError):
        raise HTTPException(status_code=409, detail=HISTORY_ERROR) from None
