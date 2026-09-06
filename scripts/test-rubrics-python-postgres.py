"""Verify Python HTTP concurrency on disposable loopback PostgreSQL, never production."""
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


def verify_mutation_locks(client, engine, admin, schema, port, base, rubric):
    body = {key: rubric[key] for key in ("name", "artifact", "gate", "passScore", "dimensions")}
    for method, suffix, payload in [("PATCH", "", body), ("POST", "/deactivate", None)]:
        ready, release = Event(), Event()
        publisher = []

        def gate(connection, cursor, statement, parameters, context, executemany):
            if "FROM rubrics" in statement and "FOR UPDATE" in statement:
                publisher.append(connection.connection.driver_connection.info.backend_pid)
                ready.set()
                assert release.wait(10), "mutation gate release timed out"

        writer = psycopg.connect(host="127.0.0.1", port=port, user="postgres", dbname="arc_identity_test", autocommit=True)
        writer.execute("SET statement_timeout=15000")
        event.listen(engine, "after_cursor_execute", gate)
        try:
            with ThreadPoolExecutor(max_workers=2) as executor:
                try:
                    mutation = executor.submit(client.request, method, f"{base}/{rubric['id']}{suffix}",
                        headers=csrf_headers(client), **({"json": payload} if payload is not None else {}))
                    assert ready.wait(5), f"{method} {suffix} did not lock rubric"
                    writing = executor.submit(writer.execute,
                        sql.SQL("UPDATE {}.rubrics SET version=version WHERE id=%s").format(sql.Identifier(schema)), [rubric["id"]])
                    deadline = monotonic() + 3
                    while monotonic() < deadline:
                        if publisher[0] in admin.execute("SELECT pg_blocking_pids(%s)", [writer.info.backend_pid]).fetchone()[0]:
                            break
                        sleep(0.02)
                    else:
                        raise AssertionError(f"SQL mutation not blocked by {method} {suffix}")
                finally:
                    release.set()
                assert mutation.result(timeout=10).status_code == 200
                assert writing.result(timeout=10).rowcount == 1
            print(f"Observed Python {method} {suffix or 'edit'} blocks competing rubric UPDATE")
        finally:
            release.set()
            event.remove(engine, "after_cursor_execute", gate)
            writer.close()


def verify_default_lock(client, other, engine, admin, schema):
    workspace = client.post("/api/workspaces", headers=csrf_headers(client), json={"name": "Seed lock", "slug": "seed-lock"})
    assert workspace.status_code == 201
    workspace_id = workspace.json()["id"]
    assert admin.execute(sql.SQL("SELECT count(*) FROM {}.rubrics WHERE workspace_id=%s")
        .format(sql.Identifier(schema)), [workspace_id]).fetchone()[0] == 0
    path = f"/api/workspaces/{workspace_id}/evaluations/rubrics"
    ready, attempted, release, guard = Event(), Event(), Event(), Lock()
    pids = []

    def before(connection, cursor, statement, parameters, context, executemany):
        if "FROM workspaces" in statement and "FOR UPDATE" in statement:
            with guard:
                pids.append(connection.connection.driver_connection.info.backend_pid)
                if len(pids) == 2:
                    attempted.set()

    def after(connection, cursor, statement, parameters, context, executemany):
        if "FROM workspaces" in statement and "FOR UPDATE" in statement:
            if connection.connection.driver_connection.info.backend_pid == pids[0]:
                ready.set()
                assert release.wait(10), "default seed gate release timed out"

    event.listen(engine, "before_cursor_execute", before)
    event.listen(engine, "after_cursor_execute", after)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            try:
                first = executor.submit(client.get, path)
                assert ready.wait(5), "first default initialization did not lock workspace"
                second = executor.submit(other.get, path)
                assert attempted.wait(5), "second initialization did not attempt workspace lock"
                deadline = monotonic() + 3
                while monotonic() < deadline:
                    if pids[0] in admin.execute("SELECT pg_blocking_pids(%s)", [pids[1]]).fetchone()[0]:
                        break
                    sleep(0.02)
                else:
                    raise AssertionError("second default initialization was not blocked")
            finally:
                release.set()
            responses = [first.result(timeout=10), second.result(timeout=10)]
        assert [item.status_code for item in responses] == [200, 200]
        assert responses[0].json() == responses[1].json()
        assert len(responses[0].json()) == 3
        assert admin.execute(sql.SQL("SELECT count(*) FROM {}.rubrics WHERE workspace_id=%s")
            .format(sql.Identifier(schema)), [workspace_id]).fetchone()[0] == 3
        print("Observed Python default initialization workspace blocking; exactly three stable default rows")
    finally:
        release.set()
        event.remove(engine, "before_cursor_execute", before)
        event.remove(engine, "after_cursor_execute", after)


def verify_provider_lock(client, engine, admin, schema, port, base, rubric):
    provider = client.post(base.replace("/evaluations/rubrics", "/model-providers"), headers=csrf_headers(client), json={
        "name": "Rubric lock provider", "baseUrl": "https://model.example.invalid", "defaultModel": "synthetic", "secretRef": "SYNTHETIC_KEY"})
    assert provider.status_code == 201
    body = {key: rubric[key] for key in ("name", "artifact", "gate", "passScore", "dimensions")}
    body.update(judgeType="llm", judgeModel="synthetic", modelProviderId=provider.json()["id"])
    assert client.patch(f"{base}/{rubric['id']}", headers=csrf_headers(client), json=body).status_code == 200
    ready, release = Event(), Event()
    publisher = []

    def gate(connection, cursor, statement, parameters, context, executemany):
        if "INSERT INTO rubric_versions" in statement:
            publisher.append(connection.connection.driver_connection.info.backend_pid)
            ready.set()
            assert release.wait(10), "Provider gate release timed out"

    writer = psycopg.connect(host="127.0.0.1", port=port, user="postgres", dbname="arc_identity_test", autocommit=True)
    writer.execute("SET statement_timeout=15000")
    update = sql.SQL("UPDATE {}.model_providers SET status=%s WHERE id=%s").format(sql.Identifier(schema))
    event.listen(engine, "before_cursor_execute", gate)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            try:
                publishing = executor.submit(client.post, f"{base}/{rubric['id']}/publish", headers=csrf_headers(client))
                assert ready.wait(5), "publication did not reach version insertion"
                stopping = executor.submit(writer.execute, update, ["disabled", provider.json()["id"]])
                deadline = monotonic() + 3
                while monotonic() < deadline:
                    if publisher[0] in admin.execute("SELECT pg_blocking_pids(%s)", [writer.info.backend_pid]).fetchone()[0]:
                        break
                    sleep(0.02)
                else:
                    raise AssertionError("Provider stop was not blocked by Python rubric publication")
            finally:
                release.set()
            assert publishing.result(timeout=10).status_code == 201
            assert stopping.result(timeout=10).rowcount == 1
        assert client.post(f"{base}/{rubric['id']}/publish", headers=csrf_headers(client)).status_code == 422
        assert admin.execute(sql.SQL("SELECT count(*) FROM {}.rubric_versions WHERE rubric_id=%s")
            .format(sql.Identifier(schema)), [rubric["id"]]).fetchone()[0] == 3
        print("Observed Python rubric Provider stop blocked; subsequent publication rejected without extra version")
    finally:
        release.set()
        event.remove(engine, "before_cursor_execute", gate)
        writer.close()
        admin.execute(update, ["active", provider.json()["id"]])


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5432
    if not 1 <= port <= 65535:
        raise ValueError("Invalid loopback test port")
    schema = f"rubrics_python_{uuid4().hex}"
    admin = psycopg.connect(host="127.0.0.1", port=port, user="postgres", dbname="arc_identity_test", autocommit=True)
    clients = []
    engine = None
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
        base = f"/api/workspaces/{workspace_id}/evaluations/rubrics"
        created = client.post(base, json={"name": "Concurrent rubric", "artifact": "Report", "gate": "Required", "passScore": 80,
                                         "dimensions": [{"id": "quality", "name": "Quality", "weight": 100, "criteria": "Grounded"}]}, headers=csrf_headers(client))
        assert created.status_code == 201
        rubric = created.json()
        path = f"{base}/{rubric['id']}/publish"
        engine = client.app.state.session_factory.kw["bind"]
        locked, attempted = Event(), Event()
        guard = Lock()
        pids = []

        def before_execute(connection, cursor, statement, parameters, context, executemany):
            if "FROM rubrics" not in statement or "FOR UPDATE" not in statement:
                return
            with guard:
                pids.append(connection.connection.driver_connection.info.backend_pid)
                if len(pids) == 2:
                    attempted.set()

        def after_execute(connection, cursor, statement, parameters, context, executemany):
            if "FROM rubrics" not in statement or "FOR UPDATE" not in statement:
                return
            if connection.connection.driver_connection.info.backend_pid == pids[0]:
                locked.set()
                if not release.wait(10):
                    raise AssertionError("Timed out waiting to release synthetic publication lock")

        event.listen(engine, "before_cursor_execute", before_execute)
        event.listen(engine, "after_cursor_execute", after_execute)
        with ThreadPoolExecutor(max_workers=2) as executor:
            try:
                first = executor.submit(client.post, path, headers=csrf_headers(client))
                assert locked.wait(5), "first HTTP publication did not acquire a rubric row lock"
                second = executor.submit(other.post, path, headers=csrf_headers(other))
                assert attempted.wait(5), "second independent session did not attempt the rubric lock"
                deadline = monotonic() + 5
                while monotonic() < deadline:
                    blocking = admin.execute("SELECT pg_blocking_pids(%s)", [pids[1]]).fetchone()[0]
                    if pids[0] in blocking:
                        break
                    sleep(0.02)
                else:
                    raise AssertionError("second publication was not blocked by the first rubric lock")
            finally:
                release.set()
            responses = [first.result(timeout=10), second.result(timeout=10)]
        event.remove(engine, "before_cursor_execute", before_execute)
        event.remove(engine, "after_cursor_execute", after_execute)
        assert [response.status_code for response in responses] == [201, 201]
        assert sorted(response.json()["version"] for response in responses) == ["v1.0.0", "v1.1.0"]
        rows = admin.execute(sql.SQL("SELECT version,snapshot FROM {}.rubric_versions WHERE rubric_id=%s ORDER BY version")
                             .format(sql.Identifier(schema)), [rubric["id"]]).fetchall()
        assert len(rows) == 2
        assert [row[1]["status"] for row in rows] == ["active", "active"]
        assert [row[1]["version"] for row in rows] == ["v1.0.0", "v1.1.0"]
        assert rows[0][1]["dimensions"] == rubric["dimensions"]
        verify_provider_lock(client, engine, admin, schema, port, base, rubric)
        verify_default_lock(client, other, engine, admin, schema)
        verify_mutation_locks(client, engine, admin, schema, port, base, rubric)
        print(json.dumps({"passed": True, "independentSessions": 2, "publicationLockObserved": True, "serializedPublicationVersions": 2}))
    finally:
        release.set()
        for client in clients:
            client.close()
        if engine is not None:
            engine.dispose()
        try:
            admin.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))
            assert admin.execute("SELECT 1 FROM pg_namespace WHERE nspname=%s", [schema]).fetchone() is None
            print("Synthetic Python PostgreSQL schema cleanup independently confirmed")
        finally:
            admin.close()


if __name__ == "__main__":
    main()
