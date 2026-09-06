"""Observe Agent HTTP publication locking on disposable loopback PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import sys
from threading import Event, Lock
from time import monotonic, sleep
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "apps/api"), str(ROOT / "apps/api/tests")]
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["ENVIRONMENT"] = "development"
from app.config import Settings

Settings.model_config["env_file"] = None
import psycopg
from psycopg import sql
from sqlalchemy import event
from sqlalchemy.engine import URL
from fastapi.testclient import TestClient
from api_test_support import create_authenticated_client, csrf_headers, login_admin
from app.models import ModelProviderRecord, ToolSkillAssetRecord


def verify_dependency_races(client, workspace_id, engine, admin, schema, port):
    """A SQL disable writer must wait until the HTTP publisher commits."""
    for kind in ("provider", "tool", "skill"):
        dependency_id, name = uuid4().hex, f"Synthetic {kind}"
        table = "model_providers" if kind == "provider" else "tool_skill_assets"
        with client.app.state.session_factory() as session:
            if kind == "provider":
                session.add(ModelProviderRecord(id=dependency_id, workspace_id=workspace_id, name=name,
                    provider_type="openai-compatible", base_url="https://models.example.invalid", default_model="synthetic",
                    secret_ref="SYNTHETIC_KEY", status="draft", created_by="synthetic"))
            else:
                session.add(ToolSkillAssetRecord(id=dependency_id, workspace_id=workspace_id, name=name,
                    asset_type=kind, status="active", created_by="synthetic"))
            session.commit()
        base = f"/api/workspaces/{workspace_id}/agents"
        body = {"name": name, "role": "Test", "owner": "Test", "model": "test"}
        if kind == "provider":
            body["modelProviderId"] = dependency_id
        created = client.post(base, json=body, headers=csrf_headers(client))
        assert created.status_code == 201
        agent_id = created.json()["id"]
        path = f"{base}/{agent_id}"
        if kind != "provider":
            assert client.patch(path, json={f"{kind}s": [name]}, headers=csrf_headers(client)).status_code == 200
        ready, release = Event(), Event()
        publisher = []

        def gate(connection, cursor, statement, parameters, context, executemany):
            if "count(" in statement and "FROM agent_versions" in statement:
                publisher.append(connection.connection.driver_connection.info.backend_pid)
                ready.set()
                assert release.wait(10), "dependency gate release timed out"

        writer = psycopg.connect(host="127.0.0.1", port=port, user="postgres", dbname="arc_identity_test", autocommit=True)
        writer.execute("SET statement_timeout=15000")
        event.listen(engine, "before_cursor_execute", gate)
        try:
            with ThreadPoolExecutor(max_workers=2) as executor:
                try:
                    publishing = executor.submit(client.post, f"{path}/publish", headers=csrf_headers(client))
                    assert ready.wait(5), f"{kind} publisher did not reach dependency gate"
                    disabling = executor.submit(writer.execute, sql.SQL("UPDATE {}.{} SET status='disabled' WHERE id=%s")
                        .format(sql.Identifier(schema), sql.Identifier(table)), [dependency_id])
                    deadline = monotonic() + 3
                    while monotonic() < deadline:
                        if publisher[0] in admin.execute("SELECT pg_blocking_pids(%s)", [writer.info.backend_pid]).fetchone()[0]:
                            break
                        sleep(0.02)
                    else:
                        raise AssertionError(f"{kind} disable was not blocked by publication")
                finally:
                    release.set()
                assert publishing.result(timeout=10).status_code == 201
                disabling.result(timeout=10)
        finally:
            release.set()
            event.remove(engine, "before_cursor_execute", gate)
            writer.close()
        assert client.post(f"{path}/publish", headers=csrf_headers(client)).status_code == 422
        history = client.get(f"{path}/versions")
        assert history.status_code == 200 and len(history.json()) == 1
        assert admin.execute(sql.SQL("SELECT count(*) FROM {}.agent_versions WHERE agent_id=%s")
                             .format(sql.Identifier(schema)), [agent_id]).fetchone()[0] == 1
        print(f"Observed {kind} disable blocked by publisher; later publish rejected without partial version")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5432
    if not 1 <= port <= 65535:
        raise ValueError("Invalid loopback test port")
    schema = f"agents_python_{uuid4().hex}"
    admin = psycopg.connect(host="127.0.0.1", port=port, user="postgres", dbname="arc_identity_test", autocommit=True)
    clients, engine = [], None
    release = Event()
    try:
        admin.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        url = URL.create("postgresql+psycopg", username="postgres", host="127.0.0.1", port=port,
                         database="arc_identity_test", query={"options": f"-c search_path={schema} -c statement_timeout=15000"})
        client, workspace_id = create_authenticated_client(url.render_as_string(hide_password=False))
        clients.append(client)
        other = TestClient(client.app)
        clients.append(other)
        login_admin(other)
        assert client.cookies["arc_one_session"] != other.cookies["arc_one_session"]
        base = f"/api/workspaces/{workspace_id}/agents"
        created = client.post(base, json={"name": "Concurrent Agent", "role": "Test", "owner": "Test", "model": "test"},
                              headers=csrf_headers(client))
        assert created.status_code == 201
        agent = created.json()
        path = f"{base}/{agent['id']}/publish"
        engine = client.app.state.session_factory.kw["bind"]
        locked, attempted, guard = Event(), Event(), Lock()
        pids = []

        def before_execute(connection, cursor, statement, parameters, context, executemany):
            if "FROM agents" not in statement or "FOR UPDATE" not in statement:
                return
            with guard:
                pids.append(connection.connection.driver_connection.info.backend_pid)
                if len(pids) == 2:
                    attempted.set()

        def after_execute(connection, cursor, statement, parameters, context, executemany):
            if "FROM agents" not in statement or "FOR UPDATE" not in statement:
                return
            if connection.connection.driver_connection.info.backend_pid == pids[0]:
                locked.set()
                assert release.wait(10), "publication lock release timed out"

        event.listen(engine, "before_cursor_execute", before_execute)
        event.listen(engine, "after_cursor_execute", after_execute)
        with ThreadPoolExecutor(max_workers=2) as executor:
            try:
                first = executor.submit(client.post, path, headers=csrf_headers(client))
                assert locked.wait(5), "first Agent publication did not acquire a row lock"
                second = executor.submit(other.post, path, headers=csrf_headers(other))
                assert attempted.wait(5), "second independent session did not attempt the row lock"
                deadline = monotonic() + 5
                while monotonic() < deadline:
                    if pids[0] in admin.execute("SELECT pg_blocking_pids(%s)", [pids[1]]).fetchone()[0]:
                        break
                    sleep(0.02)
                else:
                    raise AssertionError("second Agent publication was not blocked by the first")
            finally:
                release.set()
            responses = [first.result(timeout=10), second.result(timeout=10)]
        event.remove(engine, "before_cursor_execute", before_execute)
        event.remove(engine, "after_cursor_execute", after_execute)
        assert [response.status_code for response in responses] == [201, 201]
        assert sorted(response.json()["version"] for response in responses) == ["v1.0.0", "v1.1.0"]
        rows = admin.execute(sql.SQL("SELECT version,snapshot FROM {}.agent_versions WHERE agent_id=%s ORDER BY version")
                             .format(sql.Identifier(schema)), [agent["id"]]).fetchall()
        assert len(rows) == 2 and rows[0][1] == agent
        write_locks = []

        def observe_write_lock(connection, cursor, statement, parameters, context, executemany):
            if "FROM agents" in statement and "FOR UPDATE" in statement:
                write_locks.append(statement)

        event.listen(engine, "before_cursor_execute", observe_write_lock)
        for operation in ("update", "deactivate", "activate"):
            before = len(write_locks)
            target = f"{base}/{agent['id']}"
            response = (client.patch(target, json={"name": "Edited"}, headers=csrf_headers(client))
                        if operation == "update" else client.post(f"{target}/{operation}", headers=csrf_headers(client)))
            assert response.status_code == 200
            assert len(write_locks) == before + 1, f"{operation} did not lock its Agent row"
        event.remove(engine, "before_cursor_execute", observe_write_lock)
        preserved = admin.execute(sql.SQL("SELECT version,snapshot FROM {}.agent_versions WHERE agent_id=%s ORDER BY version")
                                  .format(sql.Identifier(schema)), [agent["id"]]).fetchall()
        assert preserved == rows
        verify_dependency_races(client, workspace_id, engine, admin, schema, port)
        print(json.dumps({"passed": True, "independentSessions": 2, "publicationLockObserved": True,
                          "versions": 2, "otherWriteLocksObserved": len(write_locks), "snapshotsPreserved": True}))
    finally:
        release.set()
        for client in clients:
            client.close()
        if engine is not None:
            engine.dispose()
        try:
            admin.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))
            assert admin.execute("SELECT 1 FROM pg_namespace WHERE nspname=%s", [schema]).fetchone() is None
            print("Synthetic Agent PostgreSQL schema cleanup independently confirmed")
        finally:
            admin.close()


if __name__ == "__main__":
    main()
