from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import Session

from app.migrations import ensure_current_schema
from app.models import (
    Base,
    HumanTaskRecord,
    ReviewDecisionRecord,
    WorkspaceRecord,
)


def test_existing_human_task_table_is_upgraded_without_losing_rows(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as connection:
        connection.execute(text("""
            CREATE TABLE human_tasks (
                id VARCHAR(36) PRIMARY KEY,
                workflow_run_id VARCHAR(36) NOT NULL,
                node_run_id VARCHAR(36) NOT NULL,
                human_node_id VARCHAR(120) NOT NULL,
                source_node_id VARCHAR(120) NOT NULL,
                artifact_version_id VARCHAR(36) NOT NULL,
                title VARCHAR(200) NOT NULL,
                status VARCHAR(32) NOT NULL,
                assignment_type VARCHAR(32) NOT NULL,
                review_policy VARCHAR(32) NOT NULL,
                required_approvals INTEGER NOT NULL,
                participant_snapshot JSON NOT NULL,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
        """))
        connection.execute(
            text("""
                INSERT INTO human_tasks (
                    id, workflow_run_id, node_run_id, human_node_id,
                    source_node_id, artifact_version_id, title, status,
                    assignment_type, review_policy, required_approvals,
                    participant_snapshot, created_at, updated_at
                ) VALUES (
                    'legacy-task', 'run-1', 'node-run-1', 'human-1',
                    'agent-1', 'artifact-version-1', '历史审核任务', '待认领',
                    'group_claim', 'any_one', 1, '[]',
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
            """),
        )
        connection.execute(text("""
            CREATE TABLE review_decisions (
                id VARCHAR(36) PRIMARY KEY,
                human_task_id VARCHAR(36) NOT NULL,
                reviewer_id VARCHAR(36) NOT NULL,
                decision VARCHAR(32) NOT NULL,
                reason TEXT NOT NULL,
                artifact_version_id VARCHAR(36) NOT NULL,
                idempotency_key VARCHAR(160) NOT NULL,
                created_at DATETIME NOT NULL
            )
        """))
        connection.execute(
            text("""
                INSERT INTO review_decisions (
                    id, human_task_id, reviewer_id, decision, reason,
                    artifact_version_id, idempotency_key, created_at
                ) VALUES (
                    'legacy-decision', 'legacy-task', 'reviewer-1', 'approve',
                    '历史决定', 'artifact-version-1', 'legacy-key',
                    CURRENT_TIMESTAMP
                )
            """),
        )

    Base.metadata.create_all(engine)
    ensure_current_schema(engine)

    columns = {
        column["name"] for column in inspect(engine).get_columns("human_tasks")
    }
    assert {
        "assignee_reviewer_id",
        "assignee_group_id",
        "due_at",
        "escalation_at",
        "sla_status",
        "escalation_group_id",
        "due_reminder_sent_at",
        "overdue_recorded_at",
        "escalated_at",
    } <= columns
    decision_columns = {
        column["name"]
        for column in inspect(engine).get_columns("review_decisions")
    }
    assert "tags" in decision_columns
    assert "workspace_id" in columns
    assert "workspace_id" in decision_columns

    with Session(engine) as session:
        workspace = session.scalar(select(WorkspaceRecord))
        assert workspace is not None
        task = session.scalar(
            select(HumanTaskRecord).where(HumanTaskRecord.id == "legacy-task"),
        )
        assert task is not None
        assert task.title == "历史审核任务"
        assert task.sla_status == "正常"
        assert task.workspace_id == workspace.id
        decision = session.scalar(
            select(ReviewDecisionRecord).where(
                ReviewDecisionRecord.id == "legacy-decision",
            ),
        )
        assert decision is not None
        assert decision.reason == "历史决定"
        assert decision.tags == []
        assert decision.workspace_id == workspace.id
