"""Observe idempotent expert confirmations on disposable loopback PostgreSQL."""
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
from api_test_support import csrf_headers, workspace_url, login_admin
from test_human_task_api import create_task, decision_body, login_reviewer
from test_human_workflow_execution import FakeGateway, FakeModelResult


def verify_qualification_races(client, engine, admin, schema, port, expert, workspace_id, path, body):
    membership_id = admin.execute(sql.SQL("SELECT id FROM {}.workspace_memberships WHERE workspace_id=%s AND user_id=%s")
        .format(sql.Identifier(schema)), [workspace_id, expert["userId"]]).fetchone()[0]
    for table, record_id, field, revoked, restored in (
        ("users", expert["userId"], "status", "disabled", "active"),
        ("workspace_memberships", membership_id, "status", "disabled", "active"),
        ("reviewers", expert["id"], "is_expert", False, True),
    ):
        login_reviewer(client, expert["email"])
        ready, release = Event(), Event()
        publisher = []

        def gate(connection, cursor, statement, parameters, context, executemany):
            if "FROM feedback_candidates" in statement and "FOR UPDATE" in statement:
                publisher.append(connection.connection.driver_connection.info.backend_pid)
                ready.set()
                assert release.wait(10), "qualification gate release timed out"

        writer = psycopg.connect(host="127.0.0.1", port=port, user="postgres", dbname="arc_identity_test", autocommit=True)
        writer.execute("SET statement_timeout=15000")
        update = sql.SQL("UPDATE {}.{} SET {}=%s WHERE id=%s").format(
            sql.Identifier(schema), sql.Identifier(table), sql.Identifier(field))
        event.listen(engine, "before_cursor_execute", gate)
        try:
            with ThreadPoolExecutor(max_workers=2) as executor:
                try:
                    confirming = executor.submit(client.post, path, json=body, headers=csrf_headers(client))
                    assert ready.wait(5), "confirmation did not finish qualification checks"
                    revoking = executor.submit(writer.execute, update, [revoked, record_id])
                    deadline = monotonic() + 3
                    while monotonic() < deadline:
                        if publisher[0] in admin.execute("SELECT pg_blocking_pids(%s)", [writer.info.backend_pid]).fetchone()[0]:
                            break
                        sleep(0.02)
                    else:
                        raise AssertionError(f"{table} revocation was not blocked by confirmation")
                finally:
                    release.set()
                assert confirming.result(timeout=10).status_code == 201
                revoking.result(timeout=10)
        finally:
            release.set()
            event.remove(engine, "before_cursor_execute", gate)
            writer.close()
        try:
            rejected = client.post(path, json=body, headers=csrf_headers(client))
            expected = {"users": 401, "workspace_memberships": 404, "reviewers": 403}[table]
            assert rejected.status_code == expected, f"{table}: expected {expected}, received {rejected.status_code}"
        finally:
            admin.execute(update, [restored, record_id])
        print(f"Observed {table} revocation blocked; revoked qualification rejects later confirmation")


def create_additional_candidate(client, workspace_id, original, reviewers):
    login_admin(client)
    run = client.post(workspace_url(workspace_id, f"/workflows/{original['workflowId']}/runs"),
        headers=csrf_headers(client), json={"input": "Second synthetic sample input"})
    assert run.status_code == 201
    tasks = client.get(workspace_url(workspace_id, "/human-tasks")).json()
    task = next(item for item in tasks if item["workflowRunId"] == run.json()["id"])
    login_reviewer(client, reviewers[0]["email"])
    decision = client.post(workspace_url(workspace_id, f"/human-tasks/{task['id']}/decisions"),
        headers=csrf_headers(client), json={**decision_body(task, reviewers[0]["id"], "modify_and_approve"),
            "modifiedContent": "Second synthetic reviewed output", "tags": ["golden"]})
    assert decision.status_code == 200
    candidates = client.get(workspace_url(workspace_id, "/feedback-candidates")).json()
    candidate = next(item for item in candidates if item["humanTaskId"] == task["id"])
    login_reviewer(client, next(item for item in reviewers if item["isExpert"])["email"])
    return candidate, task


def verify_cross_candidate_collision(client, engine, admin, schema, port, workspace_id, original, reviewers):
    candidate, task = create_additional_candidate(client, workspace_id, original, reviewers)
    writer = psycopg.connect(host="127.0.0.1", port=port, user="postgres", dbname="arc_identity_test")
    attempted, publisher = Event(), []

    def observe_insert(connection, cursor, statement, parameters, context, executemany):
        if "INSERT INTO golden_samples" in statement:
            publisher.append(connection.connection.driver_connection.info.backend_pid)
            attempted.set()

    event.listen(engine, "before_cursor_execute", observe_insert)
    try:
        writer.execute("SET LOCAL statement_timeout=15000")
        writer.execute(sql.SQL("UPDATE {}.golden_samples SET idempotency_key='cross-candidate-key' WHERE candidate_id=%s")
            .format(sql.Identifier(schema)), [original["id"]])
        with ThreadPoolExecutor(max_workers=1) as executor:
            try:
                confirming = executor.submit(client.post,
                    workspace_url(workspace_id, f"/feedback-candidates/{candidate['id']}/confirm"),
                    headers=csrf_headers(client), json={"reason": "Synthetic collision", "idempotencyKey": "cross-candidate-key"})
                assert attempted.wait(5), "confirmation did not attempt sample insertion"
                deadline = monotonic() + 5
                while monotonic() < deadline:
                    if writer.info.backend_pid in admin.execute("SELECT pg_blocking_pids(%s)", [publisher[0]]).fetchone()[0]:
                        break
                    sleep(0.02)
                else:
                    raise AssertionError("sample insert did not wait on conflicting unique key")
            finally:
                writer.commit()
            response = confirming.result(timeout=10)
        assert response.status_code == 409
        assert response.json() == {"detail": "黄金样本确认冲突，请刷新后重试"}
        assert admin.execute(sql.SQL("SELECT count(*) FROM {}.golden_samples").format(sql.Identifier(schema))).fetchone()[0] == 1
        state = admin.execute(sql.SQL("SELECT status,confirmed_at FROM {}.feedback_candidates WHERE id=%s")
            .format(sql.Identifier(schema)), [candidate["id"]]).fetchone()
        assert state == (candidate["status"], None)
        assert admin.execute(sql.SQL("SELECT count(*) FROM {}.audit_events WHERE human_task_id=%s AND event_type='golden_sample_confirmed'")
            .format(sql.Identifier(schema)), [task["id"]]).fetchone()[0] == 0
        print("Observed cross-candidate unique-key conflict: fixed 409, no partial sample or audit")
    finally:
        event.remove(engine, "before_cursor_execute", observe_insert)
        writer.close()


def verify_source_races(client, engine, admin, schema, port, workspace_id, original, reviewers):
    for table, id_field in (
        ("artifact_versions", "modifiedVersionId"),
        ("workflow_runs", "workflowRunId"),
        ("human_tasks", "humanTaskId"),
    ):
        candidate, task = create_additional_candidate(client, workspace_id, original, reviewers)
        ready, release = Event(), Event()
        publisher = []

        def gate(connection, cursor, statement, parameters, context, executemany):
            if "INSERT INTO golden_samples" in statement:
                publisher.append(connection.connection.driver_connection.info.backend_pid)
                ready.set()
                assert release.wait(10), "source gate release timed out"

        writer = psycopg.connect(host="127.0.0.1", port=port, user="postgres", dbname="arc_identity_test", autocommit=True)
        writer.execute("SET statement_timeout=15000")
        update = sql.SQL("UPDATE {}.{} SET workspace_id=workspace_id WHERE id=%s").format(
            sql.Identifier(schema), sql.Identifier(table))
        event.listen(engine, "before_cursor_execute", gate)
        try:
            with ThreadPoolExecutor(max_workers=2) as executor:
                try:
                    confirming = executor.submit(client.post,
                        workspace_url(workspace_id, f"/feedback-candidates/{candidate['id']}/confirm"),
                        headers=csrf_headers(client), json={"reason": "Synthetic source race", "idempotencyKey": f"source-{table}"})
                    assert ready.wait(5), "confirmation did not finish source reads"
                    writing = executor.submit(writer.execute, update, [candidate[id_field]])
                    deadline = monotonic() + 3
                    while monotonic() < deadline:
                        if publisher[0] in admin.execute("SELECT pg_blocking_pids(%s)", [writer.info.backend_pid]).fetchone()[0]:
                            break
                        sleep(0.02)
                    else:
                        raise AssertionError(f"{table} source write was not blocked by confirmation")
                finally:
                    release.set()
                response = confirming.result(timeout=10)
                assert response.status_code == 201
                assert writing.result(timeout=10).rowcount == 1
            stored = admin.execute(sql.SQL("SELECT input_text,expected_output FROM {}.golden_samples WHERE candidate_id=%s")
                .format(sql.Identifier(schema)), [candidate["id"]]).fetchall()
            assert stored == [("Second synthetic sample input", "Second synthetic reviewed output")]
            assert admin.execute(sql.SQL("SELECT count(*) FROM {}.audit_events WHERE human_task_id=%s AND event_type='golden_sample_confirmed'")
                .format(sql.Identifier(schema)), [task["id"]]).fetchone()[0] == 1
            state = admin.execute(sql.SQL("SELECT status,confirmed_at FROM {}.feedback_candidates WHERE id=%s")
                .format(sql.Identifier(schema)), [candidate["id"]]).fetchone()
            assert state[0] == "已确认" and state[1] is not None
            print(f"Observed {table} source UPDATE blocked until first confirmation committed; snapshot and audit verified")
        finally:
            release.set()
            event.remove(engine, "before_cursor_execute", gate)
            writer.close()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5432
    if not 1 <= port <= 65535:
        raise ValueError("Invalid loopback test port")
    schema = f"feedback_python_{uuid4().hex}"
    admin = psycopg.connect(host="127.0.0.1", port=port, user="postgres", dbname="arc_identity_test", autocommit=True)
    clients, engine = [], None
    release = Event()
    try:
        admin.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        url = URL.create("postgresql+psycopg", username="postgres", host="127.0.0.1", port=port,
            database="arc_identity_test", query={"options": f"-c search_path={schema} -c statement_timeout=15000"})
        client, workspace_id, task, reviewers = create_task(ROOT, database_url=url.render_as_string(hide_password=False),
            model_gateway=FakeGateway([FakeModelResult("Synthetic source-lock draft for human review.") for _ in range(5)]))
        clients.append(client)
        login_reviewer(client, reviewers[0]["email"])
        response = client.post(workspace_url(workspace_id, f"/human-tasks/{task['id']}/decisions"),
            headers=csrf_headers(client), json={**decision_body(task, reviewers[0]["id"], "modify_and_approve"),
                "modifiedContent": "Synthetic expert-approved output", "tags": ["golden"]})
        assert response.status_code == 200
        candidate = client.get(workspace_url(workspace_id, "/feedback-candidates")).json()[0]
        expert = next(item for item in reviewers if item["isExpert"])
        login_reviewer(client, expert["email"])
        other = TestClient(client.app)
        clients.append(other)
        login_reviewer(other, expert["email"])
        assert client.cookies["arc_one_session"] != other.cookies["arc_one_session"]
        path = workspace_url(workspace_id, f"/feedback-candidates/{candidate['id']}/confirm")
        body = {"reason": "Synthetic expert confirmation", "idempotencyKey": "same-confirmation"}
        engine = client.app.state.session_factory.kw["bind"]
        locked, attempted, guard = Event(), Event(), Lock()
        pids = []

        def before_execute(connection, cursor, statement, parameters, context, executemany):
            if "FROM feedback_candidates" not in statement or "FOR UPDATE" not in statement:
                return
            with guard:
                pids.append(connection.connection.driver_connection.info.backend_pid)
                if len(pids) == 2:
                    attempted.set()

        def after_execute(connection, cursor, statement, parameters, context, executemany):
            if "FROM feedback_candidates" not in statement or "FOR UPDATE" not in statement:
                return
            if connection.connection.driver_connection.info.backend_pid == pids[0]:
                locked.set()
                assert release.wait(10), "confirmation lock release timed out"

        event.listen(engine, "before_cursor_execute", before_execute)
        event.listen(engine, "after_cursor_execute", after_execute)
        with ThreadPoolExecutor(max_workers=2) as executor:
            try:
                first = executor.submit(client.post, path, json=body, headers=csrf_headers(client))
                assert locked.wait(5), "first confirmation did not acquire candidate lock"
                second = executor.submit(other.post, path, json=body, headers=csrf_headers(other))
                assert attempted.wait(5), "second confirmation did not attempt candidate lock"
                deadline = monotonic() + 5
                while monotonic() < deadline:
                    if pids[0] in admin.execute("SELECT pg_blocking_pids(%s)", [pids[1]]).fetchone()[0]:
                        break
                    sleep(0.02)
                else:
                    raise AssertionError("second confirmation was not blocked by first")
            finally:
                release.set()
            responses = [first.result(timeout=10), second.result(timeout=10)]
        event.remove(engine, "before_cursor_execute", before_execute)
        event.remove(engine, "after_cursor_execute", after_execute)
        assert [item.status_code for item in responses] == [201, 201]
        assert responses[0].json() == responses[1].json()
        assert responses[0].json()["expectedOutput"] == "Synthetic expert-approved output"
        assert admin.execute(sql.SQL("SELECT count(*) FROM {}.golden_samples WHERE candidate_id=%s")
            .format(sql.Identifier(schema)), [candidate["id"]]).fetchone()[0] == 1
        assert admin.execute(sql.SQL("SELECT count(*) FROM {}.audit_events WHERE human_task_id=%s AND event_type='golden_sample_confirmed'")
            .format(sql.Identifier(schema)), [task["id"]]).fetchone()[0] == 1
        assert client.post(path, json={**body, "idempotencyKey": "different-confirmation"}, headers=csrf_headers(client)).status_code == 409
        verify_qualification_races(client, engine, admin, schema, port, expert, workspace_id, path, body)
        verify_cross_candidate_collision(client, engine, admin, schema, port, workspace_id, candidate, reviewers)
        verify_source_races(client, engine, admin, schema, port, workspace_id, candidate, reviewers)
        print(json.dumps({"passed": True, "independentSessions": 2, "candidateLockObserved": True,
            "originalCandidateSamples": 1, "originalCandidateAudits": 1, "sourceLockCases": 3}))
    finally:
        release.set()
        for client in clients:
            client.close()
        if engine is not None:
            engine.dispose()
        try:
            admin.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))
            assert admin.execute("SELECT 1 FROM pg_namespace WHERE nspname=%s", [schema]).fetchone() is None
            print("Synthetic feedback schema cleanup independently confirmed")
        finally:
            admin.close()


if __name__ == "__main__":
    main()
