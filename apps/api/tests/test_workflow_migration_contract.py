"""Isolated contracts for Workflow governance and its read-only directories."""

from api_test_support import create_authenticated_client, workspace_url
from api_test_support import csrf_headers
from app.models import ReviewGroupMemberRecord, ReviewGroupRecord, ReviewerRecord
from app.domain import validate_workflow
from app.models import WorkflowRecord, WorkflowVersionRecord, AgentVersionRecord, DataObjectVersionRecord, AuditEventRecord
import pytest
from copy import deepcopy
from sqlalchemy import select
from app.schemas import WorkflowCreate
from pydantic import ValidationError


@pytest.mark.parametrize('value', ['NaN', 'Infinity', '-Infinity'])
def test_workflow_position_must_be_finite(value):
    with pytest.raises(ValidationError):
        WorkflowCreate.model_validate({'name': 'Finite', 'nodes': [{'id': 'a', 'type': 'trigger', 'data': {}, 'position': {'x': value}}]})


@pytest.mark.parametrize('field', ['requiredApprovals', 'dueMinutes', 'escalationMinutes'])
@pytest.mark.parametrize('value', [None, {}, [], 'invalid', True, 1.5])
def test_human_invalid_numbers_are_validation_errors(tmp_path, field, value):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'numbers.db'}")
    with client, client.app.state.session_factory() as session:
        nodes = [{'id': 'start', 'type': 'trigger', 'data': {}},
                 {'id': 'human', 'type': 'human', 'data': {field: value}},
                 {'id': 'end', 'type': 'end', 'data': {}}]
        errors = validate_workflow(nodes, [], session, workspace_id)
        assert any('必须是整数' in error for error in errors)


def test_workflow_governance_fixed_errors_states_and_deleted_guard(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'governance.db'}")
    with client:
        base = workspace_url(workspace_id, '/workflows')
        invalid = client.post(base, json={'name': {'private': 'do-not-echo'}}, headers=csrf_headers(client))
        assert invalid.status_code == 422
        assert invalid.json() == {'detail': 'Workflow 请求字段不符合要求'}
        graph = {'name': 'Synthetic', 'nodes': [
            {'id': 'start', 'type': 'trigger', 'position': {'x': 0}, 'data': {}},
            {'id': 'end', 'type': 'end', 'position': {'x': 1}, 'data': {}}],
            'edges': [{'id': 'edge', 'source': 'start', 'target': 'end'}]}
        created = client.post(base, json=graph, headers=csrf_headers(client))
        assert created.status_code == 201
        assert created.json()['status'] == '草稿'
        path = f"{base}/{created.json()['id']}"
        published = client.post(f'{path}/publish', headers=csrf_headers(client))
        assert published.status_code == 201
        assert published.json()['snapshot']['status'] == '草稿'
        assert client.get(path).json()['status'] == '已发布'
        assert client.delete(path, headers=csrf_headers(client)).status_code == 204
        assert client.get(path).status_code == 404
        assert client.post(f'{path}/publish', headers=csrf_headers(client)).status_code == 404


@pytest.mark.parametrize('mappings', [None, {}, [None], [{}], [{'sourcePath': '', 'targetPath': '$'}],
                                     [{'sourcePath': '$.a', 'targetPath': 'a'}]])
def test_workflow_invalid_mappings_rejected(tmp_path, mappings):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'mapping.db'}")
    with client, client.app.state.session_factory() as session:
        nodes = [{'id': 'start', 'type': 'trigger', 'data': {}}, {'id': 'end', 'type': 'end', 'data': {}}]
        errors = validate_workflow(nodes, [{'id': 'edge', 'source': 'start', 'target': 'end', 'data': {'mappings': mappings}}], session, workspace_id)
        assert any('映射' in error for error in errors)


def test_human_does_not_use_foreign_default_group_or_reviewer(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'human-scope.db'}")
    with client, client.app.state.session_factory() as session:
        for group in session.scalars(select(ReviewGroupRecord).where(ReviewGroupRecord.workspace_id == workspace_id)):
            group.is_escalation_group = True
        session.add_all([ReviewGroupRecord(id='foreign-group', workspace_id='foreign', name='Foreign'),
                         ReviewerRecord(id='foreign-reviewer', workspace_id='foreign', name='Private', role='expert')])
        session.commit()
        for data in [{'assignmentType': 'round_robin'}, {'assignmentType': 'direct', 'reviewerIds': ['foreign-reviewer']}]:
            errors = validate_workflow([{'id': 'start', 'type': 'trigger', 'data': {}},
                                       {'id': 'human', 'type': 'human', 'data': data},
                                       {'id': 'end', 'type': 'end', 'data': {}}], [], session, workspace_id)
            assert errors


def test_workflow_malformed_history_and_version_collision_fail_closed(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'history.db'}")
    with client:
        base = workspace_url(workspace_id, '/workflows')
        graph = {'name': 'Synthetic', 'nodes': [
            {'id': 'start', 'type': 'trigger', 'position': {'x': 0}, 'data': {}},
            {'id': 'end', 'type': 'end', 'position': {'x': 1}, 'data': {}}], 'edges': []}
        created = client.post(base, json=graph, headers=csrf_headers(client)).json()
        path = f"{base}/{created['id']}"
        with client.app.state.session_factory() as session:
            session.add(WorkflowVersionRecord(id='collision', workspace_id=workspace_id, workflow_id=created['id'],
                                              version='v1.1.0', snapshot={}, note='Synthetic'))
            session.commit()
        failed = client.post(f'{path}/publish', headers=csrf_headers(client))
        assert failed.status_code == 409
        assert failed.json() == {'detail': 'Workflow version already exists'}
        history = client.get(f'{path}/versions')
        assert history.status_code == 409
        assert history.json() == {'detail': '历史 Workflow 数据结构不符合要求，需先完成治理'}
        with client.app.state.session_factory() as session:
            row = session.get(WorkflowRecord, created['id'])
            row.nodes = [{'unexpected': 'private'}]
            session.commit()
        for endpoint in [base, path]:
            assert client.get(endpoint).status_code == 409


def test_workflow_history_rejects_foreign_agent_snapshot_reference(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'snapshot-scope.db'}")
    with client:
        base = workspace_url(workspace_id, '/workflows')
        created = client.post(base, json={'name': 'History'}, headers=csrf_headers(client)).json()
        snapshot = {**created, 'nodes': [{'id': 'agent', 'type': 'agent', 'position': {'x': 0},
                                        'data': {'agentId': 'other-agent', 'agentVersion': 'v1.0.0'}}]}
        with client.app.state.session_factory() as session:
            session.add(AgentVersionRecord(id='foreign-version', workspace_id='other', agent_id='other-agent', version='v1.0.0', snapshot={}))
            session.add(WorkflowVersionRecord(id='snapshot-version', workspace_id=workspace_id, workflow_id=created['id'], version='v1.0.0', snapshot=snapshot))
            session.commit()
        response = client.get(f"{base}/{created['id']}/versions")
        assert response.status_code == 409
        with client.app.state.session_factory() as session:
            assert session.get(WorkflowVersionRecord, 'snapshot-version').snapshot == snapshot


def test_human_threshold_ignores_foreign_and_inactive_group_members(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'group-count.db'}")
    with client, client.app.state.session_factory() as session:
        session.add(ReviewGroupRecord(id='group-count', workspace_id=workspace_id, name='Count'))
        for reviewer_id, scope, active in [('local-count', workspace_id, True), ('foreign-count', 'foreign', True), ('inactive-count', workspace_id, False)]:
            session.add(ReviewerRecord(id=reviewer_id, workspace_id=scope, name='Count', role='expert', is_active=active))
            session.add(ReviewGroupMemberRecord(id=f'm-{reviewer_id}', workspace_id=workspace_id, group_id='group-count', reviewer_id=reviewer_id))
        session.commit()
        nodes = [{'id': 'start', 'type': 'trigger', 'data': {}}, {'id': 'end', 'type': 'end', 'data': {}},
                 {'id': 'human', 'type': 'human', 'data': {'groupId': 'group-count', 'reviewPolicy': 'threshold', 'requiredApprovals': 2}}]
        assert 'Human 节点 human 的通过人数不能超过参与审核人数' in validate_workflow(nodes, [], session, workspace_id)


def test_workflow_history_uses_the_same_rubric_reference_whitespace_as_publication(tmp_path):
    from test_workflow_lifecycle_api import (published_agent, _create_evaluation_model_provider,
        _publish_evaluation_template, _rubric_ref, _create_evaluation_workflow)
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'rubric-whitespace.db'}")
    with client:
        agent_id, agent_version = published_agent(client, workspace_id)
        provider = _create_evaluation_model_provider(client, workspace_id, 'Whitespace provider')
        rubric, version = _publish_evaluation_template(client, workspace_id, 'Whitespace rubric', provider_id=provider['id'])
        reference = {key: f' {value} ' for key, value in _rubric_ref(rubric, version).items()}
        workflow = _create_evaluation_workflow(client, workspace_id, name='Whitespace workflow',
            agent_id=agent_id, agent_version=agent_version, rubric_ref=reference)
        path = workspace_url(workspace_id, f"/workflows/{workflow['id']}")
        published = client.post(f'{path}/publish', headers=csrf_headers(client))
        assert published.status_code == 201
        history = client.get(f'{path}/versions')
        assert history.status_code == 200
        assert history.json()[0]['snapshot'] == published.json()['snapshot']


@pytest.mark.parametrize('corruption', ['array', 'wrong-id', 'schema-array', 'schema-missing'])
def test_workflow_publish_rejects_damaged_embedded_data_object_snapshot(tmp_path, corruption):
    from test_workflow_lifecycle_api import create_data_object
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'embedded-object.db'}")
    with client:
        definition = create_data_object(client, workspace_id, 'Embedded object')
        version = client.post(workspace_url(workspace_id, f"/data-objects/{definition['id']}/publish"), headers=csrf_headers(client)).json()
        snapshot = version['snapshot']
        damaged = [] if corruption == 'array' else dict(snapshot)
        if corruption == 'wrong-id':
            damaged['id'] = 'foreign-definition'
        elif corruption == 'schema-array':
            damaged['schema'] = []
        elif corruption == 'schema-missing':
            damaged.pop('schema')
        with client.app.state.session_factory() as session:
            session.get(DataObjectVersionRecord, version['id']).snapshot = damaged
            session.commit()
        graph = {'name': 'Damaged object ref', 'nodes': [
            {'id': 'start', 'type': 'trigger', 'position': {}, 'data': {'outputDataObjectRef': {'definitionId': definition['id'], 'version': version['version']}}},
            {'id': 'end', 'type': 'end', 'position': {}, 'data': {}}], 'edges': []}
        created = client.post(workspace_url(workspace_id, '/workflows'), json=graph, headers=csrf_headers(client)).json()
        response = client.post(workspace_url(workspace_id, f"/workflows/{created['id']}/publish"), headers=csrf_headers(client))
        assert response.status_code == 409
        assert response.json() == {'detail': '历史 Workflow 数据结构不符合要求，需先完成治理'}
        with client.app.state.session_factory() as session:
            assert list(session.scalars(select(WorkflowVersionRecord).where(WorkflowVersionRecord.workflow_id == created['id']))) == []
            assert list(session.scalars(select(AuditEventRecord).where(AuditEventRecord.target_id == created['id'], AuditEventRecord.action == 'workflow.publish'))) == []
            assert session.get(WorkflowRecord, created['id']).status == '草稿'
            assert session.get(DataObjectVersionRecord, version['id']).snapshot == damaged


def test_workflow_history_validates_present_embedded_object_but_allows_legacy_omission(tmp_path):
    from test_workflow_lifecycle_api import create_data_object
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'embedded-history.db'}")
    with client:
        definition = create_data_object(client, workspace_id, 'Embedded history')
        version = client.post(workspace_url(workspace_id, f"/data-objects/{definition['id']}/publish"), headers=csrf_headers(client)).json()
        graph = {'name': 'Embedded history', 'nodes': [
            {'id': 'start', 'type': 'trigger', 'position': {}, 'data': {'outputDataObjectRef': {'definitionId': definition['id'], 'version': version['version']}}},
            {'id': 'end', 'type': 'end', 'position': {}, 'data': {}}], 'edges': []}
        created = client.post(workspace_url(workspace_id, '/workflows'), json=graph, headers=csrf_headers(client)).json()
        path = workspace_url(workspace_id, f"/workflows/{created['id']}")
        published = client.post(f'{path}/publish', headers=csrf_headers(client)).json()
        assert client.get(f'{path}/versions').status_code == 200
        for corruption in ['array', 'wrong-id', 'schema-array', 'missing-schema', 'legacy-omission']:
            snapshot = deepcopy(published['snapshot'])
            reference = snapshot['nodes'][0]['data']['outputDataObjectRef']
            if corruption == 'array':
                reference['snapshot'] = []
            elif corruption == 'wrong-id':
                reference['snapshot']['id'] = 'foreign'
            elif corruption == 'schema-array':
                reference['snapshot']['schema'] = []
            elif corruption == 'missing-schema':
                reference['snapshot'].pop('schema')
            else:
                reference.pop('snapshot')
            with client.app.state.session_factory() as session:
                session.get(WorkflowVersionRecord, published['id']).snapshot = snapshot
                session.commit()
            history = client.get(f'{path}/versions')
            assert history.status_code == (200 if corruption == 'legacy-omission' else 409)
            with client.app.state.session_factory() as session:
                assert session.get(WorkflowVersionRecord, published['id']).snapshot == snapshot


def test_review_directory_never_returns_foreign_reviewer_through_local_group(tmp_path):
    client, workspace_id = create_authenticated_client(f"sqlite:///{tmp_path / 'workflow.db'}")
    with client:
        with client.app.state.session_factory() as session:
            session.add_all([
                ReviewerRecord(id="local", workspace_id=workspace_id, name="Local", role="expert"),
                ReviewerRecord(id="foreign", workspace_id="other-space", name="Private foreign name", role="expert"),
                ReviewGroupRecord(id="local-group", workspace_id=workspace_id, name="Synthetic directory"),
                ReviewGroupMemberRecord(id="local-member", workspace_id=workspace_id, group_id="local-group", reviewer_id="local"),
                ReviewGroupMemberRecord(id="broken-member", workspace_id=workspace_id, group_id="local-group", reviewer_id="foreign"),
            ])
            session.commit()
        response = client.get(workspace_url(workspace_id, "/review-groups"))
        assert response.status_code == 200
        group = next(row for row in response.json() if row["id"] == "local-group")
        assert [row["id"] for row in group["members"]] == ["local"]
        assert "Private foreign name" not in response.text
