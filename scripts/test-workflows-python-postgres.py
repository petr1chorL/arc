"""Disposable loopback PostgreSQL verification for Python Workflow governance."""
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import sys
from threading import Event, Lock
from time import monotonic, sleep
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'apps/api'), str(ROOT / 'apps/api/tests')]
os.environ['DATABASE_URL'] = 'sqlite:///:memory:'
os.environ['ENVIRONMENT'] = 'development'
from app.config import Settings
Settings.model_config['env_file'] = None
import psycopg
from psycopg import sql
from sqlalchemy import event
from sqlalchemy.engine import URL
from fastapi.testclient import TestClient
from api_test_support import create_authenticated_client, csrf_headers, login_admin
from test_workflow_lifecycle_api import published_agent, create_data_object, valid_graph


def observe_block(admin, waiter, holder):
    deadline = monotonic() + 4
    while monotonic() < deadline:
        if holder in admin.execute('SELECT pg_blocking_pids(%s)', [waiter]).fetchone()[0]:
            return
        sleep(0.02)
    raise AssertionError('Expected a real PostgreSQL row lock wait')


def publication_pair(client, other, engine, admin, path):
    ready, attempted, release, guard = Event(), Event(), Event(), Lock()
    pids = []

    def before(connection, cursor, statement, parameters, context, executemany):
        if 'FROM workflows' in statement and 'FOR UPDATE' in statement:
            with guard:
                pids.append(connection.connection.driver_connection.info.backend_pid)
                if len(pids) == 2:
                    attempted.set()

    def after(connection, cursor, statement, parameters, context, executemany):
        if 'FROM workflows' in statement and 'FOR UPDATE' in statement:
            if connection.connection.driver_connection.info.backend_pid == pids[0]:
                ready.set()
                assert release.wait(10)

    event.listen(engine, 'before_cursor_execute', before)
    event.listen(engine, 'after_cursor_execute', after)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            try:
                first = executor.submit(client.post, f'{path}/publish', headers=csrf_headers(client))
                assert ready.wait(5), 'First publication did not lock Workflow'
                second = executor.submit(other.post, f'{path}/publish', headers=csrf_headers(other))
                assert attempted.wait(5), 'Second publication did not attempt Workflow lock'
                observe_block(admin, pids[1], pids[0])
            finally:
                release.set()
            responses = [first.result(timeout=10), second.result(timeout=10)]
        assert [response.status_code for response in responses] == [201, 201]
        assert [response.json()['version'] for response in responses] == ['v1.0.0', 'v1.1.0']
        print('PASS: independent HTTP publication pair serializes on Workflow row')
    finally:
        release.set()
        event.remove(engine, 'before_cursor_execute', before)
        event.remove(engine, 'after_cursor_execute', after)


def sql_competition(client, engine, admin, port, path, method, payload, gate_text, update, values, expected):
    ready, release = Event(), Event()
    holders = []

    def gate(connection, cursor, statement, parameters, context, executemany):
        if gate_text in statement and not holders:
            holders.append(connection.connection.driver_connection.info.backend_pid)
            ready.set()
            assert release.wait(10)

    writer = psycopg.connect(host='127.0.0.1', port=port, user='postgres', dbname='arc_identity_test', autocommit=True, connect_timeout=5)
    writer.execute('SET statement_timeout=15000')
    event.listen(engine, 'after_cursor_execute', gate)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            try:
                operation = executor.submit(client.request, method, path, headers=csrf_headers(client),
                                            **({'json': payload} if payload is not None else {}))
                assert ready.wait(5), f'{method} did not reach expected gate'
                writing = executor.submit(writer.execute, update, values)
                observe_block(admin, writer.info.backend_pid, holders[0])
            finally:
                release.set()
            assert operation.result(timeout=10).status_code == expected
            assert writing.result(timeout=10).rowcount == 1
        print(f'PASS: {method} {path.rsplit("/", 1)[-1]} holds required row against SQL update')
    finally:
        release.set()
        event.remove(engine, 'after_cursor_execute', gate)
        writer.close()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5432
    if not 1 <= port <= 65535:
        raise ValueError('Invalid loopback port')
    schema = f'workflows_python_{uuid4().hex}'
    admin = psycopg.connect(host='127.0.0.1', port=port, user='postgres', dbname='arc_identity_test', autocommit=True, connect_timeout=5)
    clients, engine = [], None
    try:
        admin.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
        url = URL.create('postgresql+psycopg', username='postgres', host='127.0.0.1', port=port,
                         database='arc_identity_test', query={'options': f'-c search_path={schema} -c statement_timeout=15000'})
        client, workspace = create_authenticated_client(url.render_as_string(hide_password=False))
        clients.append(client)
        other = TestClient(client.app)
        clients.append(other)
        login_admin(other)
        assert client.cookies['arc_one_session'] != other.cookies['arc_one_session']
        engine = client.app.state.session_factory.kw['bind']
        agent_id, agent_version = published_agent(client, workspace)
        graph = {'name': 'Workflow PG', **valid_graph(agent_id, agent_version)}
        definition = create_data_object(client, workspace, 'Workflow PG object')
        object_response = client.post(f'/api/workspaces/{workspace}/data-objects/{definition["id"]}/publish', headers=csrf_headers(client))
        assert object_response.status_code == 201
        graph['nodes'][1]['data']['inputDataObjectRef'] = {'definitionId': definition['id'], 'version': object_response.json()['version']}
        base = f'/api/workspaces/{workspace}/workflows'
        created = client.post(base, json=graph, headers=csrf_headers(client))
        assert created.status_code == 201
        workflow_id = created.json()['id']
        path = f'{base}/{workflow_id}'
        publication_pair(client, other, engine, admin, path)
        frozen = admin.execute(sql.SQL('SELECT snapshot FROM {}.workflow_versions WHERE workflow_id=%s ORDER BY version').format(sql.Identifier(schema)), [workflow_id]).fetchall()
        assert [row[0]['status'] for row in frozen] == ['草稿', '已发布']
        update_workflow = sql.SQL('UPDATE {}.workflows SET version=version WHERE id=%s').format(sql.Identifier(schema))
        sql_competition(client, engine, admin, port, path, 'PATCH', graph, 'FROM workflows', update_workflow, [workflow_id], 200)
        update_agent = sql.SQL('UPDATE {}.agent_versions SET version=version WHERE agent_id=%s').format(sql.Identifier(schema))
        sql_competition(client, engine, admin, port, f'{path}/publish', 'POST', None, 'INSERT INTO workflow_versions', update_agent, [agent_id], 201)
        disable_object = sql.SQL('UPDATE {}.data_object_definitions SET status=%s WHERE id=%s').format(sql.Identifier(schema))
        sql_competition(client, engine, admin, port, f'{path}/publish', 'POST', None, 'INSERT INTO workflow_versions', disable_object, ['disabled', definition['id']], 201)
        assert client.post(f'{path}/publish', headers=csrf_headers(client)).status_code == 422
        sql_competition(client, engine, admin, port, path, 'DELETE', None, 'FROM workflows', update_workflow, [workflow_id], 204)
        assert client.get(path).status_code == 404
        rows = admin.execute(sql.SQL('SELECT snapshot FROM {}.workflow_versions WHERE workflow_id=%s ORDER BY version').format(sql.Identifier(schema)), [workflow_id]).fetchall()
        assert rows[:2] == frozen and len(rows) == 4
        assert admin.execute(sql.SQL("SELECT count(*) FROM {}.audit_events WHERE action='workflow.publish' AND target_id=%s").format(sql.Identifier(schema)), [workflow_id]).fetchone()[0] == 4
        print('PASS: immutable versions and four matching publication audits independently verified')
    finally:
        for client in clients:
            client.close()
        if engine is not None:
            engine.dispose()
        try:
            admin.execute(sql.SQL('DROP SCHEMA IF EXISTS {} CASCADE').format(sql.Identifier(schema)))
            assert admin.execute('SELECT nspname FROM pg_namespace WHERE nspname=%s', [schema]).fetchone() is None
            print('PASS: isolated Workflow PG schema cleanup independently verified')
        finally:
            admin.close()


if __name__ == '__main__':
    main()
