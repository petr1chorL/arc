from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    ArtifactRecord,
    ArtifactVersionRecord,
    HumanTaskRecord,
    NodeRunRecord,
    WorkflowRunRecord,
    utc_now,
)


class HumanTaskService:
    def pause_for_review(
        self,
        *,
        session: Session,
        run: WorkflowRunRecord,
        node: dict,
        node_input: str,
        source_node_id: str,
        source_node_run_id: str,
        score: int | None,
    ) -> tuple[NodeRunRecord, HumanTaskRecord]:
        now = utc_now()
        node_run = NodeRunRecord(
            run_id=run.id,
            node_id=node["id"],
            node_type="human",
            node_name=node["data"].get("label", node["id"]),
            status="等待审核",
            input_text=node_input,
            output_text=node_input,
            attempts=1,
            score=score,
            started_at=now,
        )
        session.add(node_run)
        session.flush()

        artifact = ArtifactRecord(
            run_id=run.id,
            source_node_run_id=source_node_run_id,
            content=node_input,
            score=score,
        )
        session.add(artifact)
        session.flush()
        artifact_version = ArtifactVersionRecord(
            artifact_id=artifact.id,
            content=node_input,
        )
        session.add(artifact_version)
        session.flush()

        data = node.get("data", {})
        task = HumanTaskRecord(
            workflow_run_id=run.id,
            node_run_id=node_run.id,
            human_node_id=node["id"],
            source_node_id=source_node_id,
            artifact_version_id=artifact_version.id,
            title=data.get("label", "人工审核"),
            assignment_type=data.get("assignmentType", "group_claim"),
            review_policy=data.get("reviewPolicy", "any_one"),
            required_approvals=int(data.get("requiredApprovals", 1)),
            participant_snapshot=list(data.get("reviewerIds", [])),
            created_at=now,
            updated_at=now,
        )
        session.add(task)
        run.status = "等待审核"
        run.current_node = node_run.node_name
        run.output_text = node_input
        run.score = score
        session.commit()
        session.refresh(task)
        return node_run, task

    def list_tasks(self, session: Session) -> list[HumanTaskRecord]:
        statement = select(HumanTaskRecord).order_by(HumanTaskRecord.created_at.desc())
        return list(session.scalars(statement))

    def get_task(self, session: Session, task_id: str) -> HumanTaskRecord | None:
        return session.get(HumanTaskRecord, task_id)

    def get_task_detail(self, session: Session, task_id: str) -> dict | None:
        task = self.get_task(session, task_id)
        if task is None:
            return None
        artifact_version = session.get(ArtifactVersionRecord, task.artifact_version_id)
        run = session.get(WorkflowRunRecord, task.workflow_run_id)
        if artifact_version is None or run is None:
            return None
        return {
            **{
                column.name: getattr(task, column.name)
                for column in HumanTaskRecord.__table__.columns
            },
            "artifact": artifact_version,
            "run": run,
            "approval_progress": {
                "required": task.required_approvals,
                "received": 0,
            },
        }
