from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    AuditEventRecord,
    ArtifactRecord,
    ArtifactVersionRecord,
    HumanTaskRecord,
    NodeRunRecord,
    ReviewDecisionRecord,
    ReviewerRecord,
    ReviewGroupMemberRecord,
    ReviewGroupRecord,
    WorkflowRunRecord,
    utc_now,
)


class HumanTaskConflict(RuntimeError):
    pass


class HumanTaskValidation(RuntimeError):
    pass


TERMINAL_TASK_STATUSES = {"已通过", "已驳回", "已退回", "恢复失败"}


class HumanTaskService:
    def ensure_default_directory(self, session: Session) -> None:
        if session.scalar(select(func.count()).select_from(ReviewerRecord)):
            return
        now = utc_now()
        reviewers = [
            ReviewerRecord(name="林晓", role="产品审核人", created_at=now),
            ReviewerRecord(
                name="陈卓",
                role="质量专家",
                is_expert=True,
                created_at=now + timedelta(microseconds=1),
            ),
            ReviewerRecord(
                name="周宁",
                role="审核负责人",
                is_expert=True,
                created_at=now + timedelta(microseconds=2),
            ),
        ]
        session.add_all(reviewers)
        session.flush()
        product_group = ReviewGroupRecord(
            name="产品审核组",
            assignment_mode="group_claim",
            created_at=now,
        )
        escalation_group = ReviewGroupRecord(
            name="升级审核组",
            assignment_mode="round_robin",
            is_escalation_group=True,
            created_at=now + timedelta(microseconds=1),
        )
        session.add_all([product_group, escalation_group])
        session.flush()
        session.add_all([
            ReviewGroupMemberRecord(
                group_id=product_group.id,
                reviewer_id=reviewers[0].id,
            ),
            ReviewGroupMemberRecord(
                group_id=product_group.id,
                reviewer_id=reviewers[1].id,
                role="专家",
            ),
            ReviewGroupMemberRecord(
                group_id=escalation_group.id,
                reviewer_id=reviewers[2].id,
                role="审核负责人",
            ),
        ])
        session.commit()

    def list_reviewers(self, session: Session) -> list[ReviewerRecord]:
        return list(session.scalars(
            select(ReviewerRecord).order_by(ReviewerRecord.created_at.asc()),
        ))

    def list_groups(self, session: Session) -> list[dict]:
        groups = list(session.scalars(
            select(ReviewGroupRecord).order_by(ReviewGroupRecord.created_at.asc()),
        ))
        result: list[dict] = []
        for group in groups:
            reviewer_ids = self.group_reviewer_ids(session, group.id)
            members = list(session.scalars(
                select(ReviewerRecord)
                .where(ReviewerRecord.id.in_(reviewer_ids))
                .order_by(ReviewerRecord.created_at.asc()),
            )) if reviewer_ids else []
            result.append({
                "id": group.id,
                "name": group.name,
                "assignment_mode": group.assignment_mode,
                "is_escalation_group": group.is_escalation_group,
                "members": members,
            })
        return result

    def group_reviewer_ids(self, session: Session, group_id: str) -> list[str]:
        return list(session.scalars(
            select(ReviewGroupMemberRecord.reviewer_id)
            .join(
                ReviewerRecord,
                ReviewerRecord.id == ReviewGroupMemberRecord.reviewer_id,
            )
            .where(ReviewGroupMemberRecord.group_id == group_id)
            .order_by(ReviewerRecord.created_at.asc()),
        ))

    def default_product_group(self, session: Session) -> ReviewGroupRecord:
        group = session.scalar(
            select(ReviewGroupRecord).where(ReviewGroupRecord.name == "产品审核组"),
        )
        if group is None:
            raise RuntimeError("默认审核组不存在")
        return group

    def active_reviewer(self, session: Session, reviewer_id: str) -> ReviewerRecord:
        reviewer = session.get(ReviewerRecord, reviewer_id)
        if reviewer is None or not reviewer.is_active:
            raise HumanTaskValidation("审核人不存在或已停用")
        return reviewer

    def audit(
        self,
        session: Session,
        *,
        task: HumanTaskRecord,
        event_type: str,
        actor_id: str,
        reason: str = "",
        before_status: str = "",
        payload: dict | None = None,
    ) -> None:
        session.add(AuditEventRecord(
            human_task_id=task.id,
            event_type=event_type,
            actor_id=actor_id,
            reason=reason,
            before_status=before_status,
            after_status=task.status,
            payload=payload or {},
        ))

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
        assignment_type = data.get("assignmentType", "group_claim")
        participant_snapshot = list(data.get("reviewerIds", []))
        assignee_group_id = data.get("groupId")
        group: ReviewGroupRecord | None = None
        if not participant_snapshot:
            group = (
                session.get(ReviewGroupRecord, assignee_group_id)
                if assignee_group_id
                else self.default_product_group(session)
            )
            if group is None:
                raise HumanTaskValidation("审核组不存在")
            assignee_group_id = assignee_group_id or group.id
            participant_snapshot = self.group_reviewer_ids(session, assignee_group_id)
        assignee_reviewer_id = None
        task_status = "待认领"
        if assignment_type == "round_robin":
            group = group or session.get(ReviewGroupRecord, assignee_group_id)
            if group is None or not participant_snapshot:
                raise HumanTaskValidation("轮询分配需要包含成员的审核组")
            assignee_reviewer_id = participant_snapshot[
                group.rotation_cursor % len(participant_snapshot)
            ]
            group.rotation_cursor += 1
            task_status = "审核中"
        task = HumanTaskRecord(
            workflow_run_id=run.id,
            node_run_id=node_run.id,
            human_node_id=node["id"],
            source_node_id=source_node_id,
            artifact_version_id=artifact_version.id,
            title=data.get("label", "人工审核"),
            status=task_status,
            assignment_type=assignment_type,
            assignee_reviewer_id=assignee_reviewer_id,
            assignee_group_id=assignee_group_id,
            review_policy=data.get("reviewPolicy", "any_one"),
            required_approvals=int(data.get("requiredApprovals", 1)),
            participant_snapshot=participant_snapshot,
            created_at=now,
            updated_at=now,
        )
        session.add(task)
        session.flush()
        self.audit(
            session,
            task=task,
            event_type="task_created",
            actor_id="system",
        )
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
        received = session.scalar(
            select(func.count()).select_from(ReviewDecisionRecord).where(
                ReviewDecisionRecord.human_task_id == task.id,
                ReviewDecisionRecord.decision.in_(["approve", "modify_and_approve"]),
            ),
        ) or 0
        return {
            **{
                column.name: getattr(task, column.name)
                for column in HumanTaskRecord.__table__.columns
            },
            "artifact": artifact_version,
            "run": run,
            "approval_progress": {
                "required": task.required_approvals,
                "received": received,
            },
        }

    def claim_task(
        self,
        session: Session,
        task_id: str,
        reviewer_id: str,
    ) -> HumanTaskRecord:
        task = self.get_task(session, task_id)
        if task is None:
            raise HumanTaskValidation("人工任务不存在")
        self.active_reviewer(session, reviewer_id)
        if task.status in TERMINAL_TASK_STATUSES:
            raise HumanTaskConflict("终态任务不能认领")
        if reviewer_id not in task.participant_snapshot:
            raise HumanTaskConflict("审核人不在当前任务参与人快照中")
        if task.assignee_reviewer_id and task.assignee_reviewer_id != reviewer_id:
            raise HumanTaskConflict("任务已被其他审核人认领")
        before = task.status
        task.assignee_reviewer_id = reviewer_id
        task.status = "审核中"
        task.updated_at = utc_now()
        self.audit(
            session,
            task=task,
            event_type="task_claimed",
            actor_id=reviewer_id,
            before_status=before,
        )
        session.commit()
        session.refresh(task)
        return task

    def transfer_task(
        self,
        session: Session,
        task_id: str,
        *,
        actor_id: str,
        reviewer_id: str | None,
        group_id: str | None,
        reason: str,
    ) -> HumanTaskRecord:
        task = self.get_task(session, task_id)
        if task is None:
            raise HumanTaskValidation("人工任务不存在")
        self.active_reviewer(session, actor_id)
        if task.status in TERMINAL_TASK_STATUSES:
            raise HumanTaskConflict("终态任务不能转交")
        if bool(reviewer_id) == bool(group_id):
            raise HumanTaskValidation("必须且只能选择审核人或审核组")
        before = task.status
        if reviewer_id:
            self.active_reviewer(session, reviewer_id)
            if reviewer_id not in task.participant_snapshot:
                task.participant_snapshot = [*task.participant_snapshot, reviewer_id]
            task.assignee_reviewer_id = reviewer_id
            task.status = "审核中"
        else:
            group = session.get(ReviewGroupRecord, group_id)
            if group is None:
                raise HumanTaskValidation("审核组不存在")
            task.assignee_group_id = group.id
            task.assignee_reviewer_id = None
            task.participant_snapshot = self.group_reviewer_ids(session, group.id)
            task.status = "待认领"
        task.updated_at = utc_now()
        self.audit(
            session,
            task=task,
            event_type="task_transferred",
            actor_id=actor_id,
            reason=reason,
            before_status=before,
            payload={"reviewerId": reviewer_id, "groupId": group_id},
        )
        session.commit()
        session.refresh(task)
        return task

    def decide_task(
        self,
        session: Session,
        task_id: str,
        *,
        reviewer_id: str,
        decision: str,
        reason: str,
        artifact_version_id: str,
        idempotency_key: str,
    ) -> dict:
        task = self.get_task(session, task_id)
        if task is None:
            raise HumanTaskValidation("人工任务不存在")
        self.active_reviewer(session, reviewer_id)
        if task.status in TERMINAL_TASK_STATUSES:
            raise HumanTaskConflict("终态任务不能重复决策")
        if reviewer_id not in task.participant_snapshot:
            raise HumanTaskConflict("审核人不在当前任务参与人快照中")
        if artifact_version_id != task.artifact_version_id:
            raise HumanTaskConflict("产出物版本已更新，请刷新后重试")
        existing = session.scalar(
            select(ReviewDecisionRecord).where(
                ReviewDecisionRecord.human_task_id == task.id,
                ReviewDecisionRecord.reviewer_id == reviewer_id,
            ),
        )
        if existing is not None:
            raise HumanTaskConflict("审核人已提交决定")
        before = task.status
        session.add(ReviewDecisionRecord(
            human_task_id=task.id,
            reviewer_id=reviewer_id,
            decision=decision,
            reason=reason,
            artifact_version_id=artifact_version_id,
            idempotency_key=idempotency_key,
        ))
        session.flush()
        if decision == "reject":
            task.status = "已驳回"
        elif decision == "return_for_rerun":
            task.status = "已退回"
        else:
            received = session.scalar(
                select(func.count()).select_from(ReviewDecisionRecord).where(
                    ReviewDecisionRecord.human_task_id == task.id,
                    ReviewDecisionRecord.decision.in_(["approve", "modify_and_approve"]),
                ),
            ) or 0
            if task.review_policy == "any_one" or received >= task.required_approvals:
                task.status = "已通过"
            else:
                task.status = "审核中"
        task.updated_at = utc_now()
        self.audit(
            session,
            task=task,
            event_type="review_decision_submitted",
            actor_id=reviewer_id,
            reason=reason,
            before_status=before,
            payload={"decision": decision},
        )
        session.commit()
        detail = self.get_task_detail(session, task.id)
        if detail is None:
            raise RuntimeError("人工任务详情不可用")
        return detail
