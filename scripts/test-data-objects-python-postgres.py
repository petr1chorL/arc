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


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5432
    if not 1 <= port <= 65535:
        raise ValueError("Invalid loopback test port")
    schema = f"data_objects_python_{uuid4().hex}"
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
        base = f"/api/workspaces/{workspace_id}/data-objects"
        created = client.post(base, json={"name": "Concurrent object", "schema": {}}, headers=csrf_headers(client))
        assert created.status_code == 201
        definition = created.json()
        path = f"{base}/{definition['id']}/publish"
        engine = client.app.state.session_factory.kw["bind"]
        locked, attempted = Event(), Event()
        guard = Lock()
        pids = []

        def before_execute(connection, cursor, statement, parameters, context, executemany):
            if "FROM data_object_definitions" not in statement or "FOR UPDATE" not in statement:
                return
            with guard:
                pids.append(connection.connection.driver_connection.info.backend_pid)
                if len(pids) == 2:
                    attempted.set()

        def after_execute(connection, cursor, statement, parameters, context, executemany):
            if "FROM data_object_definitions" not in statement or "FOR UPDATE" not in statement:
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
                assert locked.wait(5), "first HTTP publication did not acquire a definition row lock"
                second = executor.submit(other.post, path, headers=csrf_headers(other))
                assert attempted.wait(5), "second independent session did not attempt the definition lock"
                deadline = monotonic() + 5
                while monotonic() < deadline:
                    blocking = admin.execute("SELECT pg_blocking_pids(%s)", [pids[1]]).fetchone()[0]
                    if pids[0] in blocking:
                        break
                    sleep(0.02)
                else:
                    raise AssertionError("second publication was not blocked by the first definition lock")
            finally:
                release.set()
            responses = [first.result(timeout=10), second.result(timeout=10)]
        event.remove(engine, "before_cursor_execute", before_execute)
        event.remove(engine, "after_cursor_execute", after_execute)
        assert [response.status_code for response in responses] == [201, 201]
        assert sorted(response.json()["version"] for response in responses) == ["v1.0.0", "v1.1.0"]
        rows = admin.execute(sql.SQL("SELECT version,snapshot FROM {}.data_object_versions WHERE definition_id=%s ORDER BY version")
                             .format(sql.Identifier(schema)), [definition["id"]]).fetchall()
        assert len(rows) == 2 and rows[0][1] == definition
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(actor.post, base, json={"name": "Unique race", "schema": {}},
                                       headers=csrf_headers(actor)) for actor in clients]
            statuses = sorted(future.result(timeout=10).status_code for future in futures)
        assert statuses == [201, 409]
        count = admin.execute(sql.SQL("SELECT count(*) FROM {}.data_object_definitions WHERE name='Unique race'")
                              .format(sql.Identifier(schema))).fetchone()[0]
        assert count == 1
        print(json.dumps({"passed": True, "independentSessions": 2, "publicationLockObserved": True,
                          "versions": 2, "uniqueNameResults": statuses}))
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
