from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from difflib import unified_diff

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    AuditEventRecord,
    ArtifactDiffRecord,
    ArtifactRecord,
    ArtifactVersionRecord,
    FeedbackCandidateRecord,
    GoldenSampleRecord,
    HumanTaskRecord,
    NodeRunRecord,
    NotificationOutboxRecord,
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


TERMINAL_TASK_STATUSES = {"已通过", "修改后通过", "已驳回", "已退回", "恢复失败"}


class HumanTaskService:
    def __init__(self, clock: Callable[[], datetime] = utc_now):
        self.clock = clock

    def now(self) -> datetime:
        current = self.clock()
        return current if current.tzinfo else current.replace(tzinfo=timezone.utc)

    @staticmethod
    def aware(value: datetime) -> datetime:
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)

    def ensure_default_directory(self, session: Session) -> None:
        if session.scalar(select(func.count()).select_from(ReviewerRecord)):
            return
        now = self.now()
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
        now = self.now()
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
        due_minutes = int(data.get("dueMinutes", 240))
        escalation_minutes = int(data.get("escalationMinutes", 480))
        if due_minutes <= 0 or escalation_minutes <= due_minutes:
            raise HumanTaskValidation("SLA 升级时间必须晚于截止时间")
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
        escalation_group_id = data.get("escalationGroupId")
        if not escalation_group_id:
            escalation_group = session.scalar(
                select(ReviewGroupRecord).where(
                    ReviewGroupRecord.is_escalation_group.is_(True),
                ),
            )
            escalation_group_id = escalation_group.id if escalation_group else None
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
            due_at=now + timedelta(minutes=due_minutes),
            escalation_at=now + timedelta(minutes=escalation_minutes),
            escalation_group_id=escalation_group_id,
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
        tasks = list(session.scalars(statement))
        for task in tasks:
            self.refresh_sla(session, task)
        session.commit()
        return tasks

    def get_task(self, session: Session, task_id: str) -> HumanTaskRecord | None:
        return session.get(HumanTaskRecord, task_id)

    def get_task_detail(self, session: Session, task_id: str) -> dict | None:
        task = self.get_task(session, task_id)
        if task is None:
            return None
        self.refresh_sla(session, task)
        session.commit()
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
        audit_events = list(session.scalars(
            select(AuditEventRecord)
            .where(AuditEventRecord.human_task_id == task.id)
            .order_by(AuditEventRecord.created_at.asc()),
        ))
        notifications = list(session.scalars(
            select(NotificationOutboxRecord)
            .where(NotificationOutboxRecord.human_task_id == task.id)
            .order_by(NotificationOutboxRecord.created_at.asc()),
        ))
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
            "audit_events": audit_events,
            "notifications": notifications,
        }

    def add_notification(
        self,
        session: Session,
        *,
        task: HumanTaskRecord,
        event_type: str,
        recipient_type: str,
        recipient_id: str,
        payload: dict,
    ) -> None:
        event_key = f"{task.id}:{event_type}"
        exists = session.scalar(
            select(NotificationOutboxRecord).where(
                NotificationOutboxRecord.event_key == event_key,
            ),
        )
        if exists is None:
            session.add(NotificationOutboxRecord(
                event_key=event_key,
                human_task_id=task.id,
                event_type=event_type,
                recipient_type=recipient_type,
                recipient_id=recipient_id,
                payload=payload,
                created_at=self.now(),
            ))

    def refresh_sla(
        self,
        session: Session,
        task: HumanTaskRecord,
    ) -> HumanTaskRecord:
        if task.status in TERMINAL_TASK_STATUSES:
            return task
        now = self.now()
        due_at = self.aware(task.due_at)
        escalation_at = self.aware(task.escalation_at)
        before = task.sla_status
        if now >= escalation_at:
            if task.escalated_at is None:
                group = session.get(ReviewGroupRecord, task.escalation_group_id)
                if group is None:
                    raise HumanTaskValidation("升级审核组不存在")
                task.assignee_group_id = group.id
                task.assignee_reviewer_id = None
                task.participant_snapshot = self.group_reviewer_ids(session, group.id)
                task.escalated_at = now
                task.sla_status = "已升级"
                self.audit(
                    session,
                    task=task,
                    event_type="sla_escalated",
                    actor_id="system",
                    before_status=before,
                    payload={"groupId": group.id},
                )
                self.add_notification(
                    session,
                    task=task,
                    event_type="escalated",
                    recipient_type="group",
                    recipient_id=group.id,
                    payload={"slaStatus": task.sla_status},
                )
        elif now >= due_at:
            task.sla_status = "已逾期"
            if task.overdue_recorded_at is None:
                task.overdue_recorded_at = now
                self.audit(
                    session,
                    task=task,
                    event_type="sla_overdue",
                    actor_id="system",
                    before_status=before,
                )
        elif now >= due_at - timedelta(minutes=15):
            task.sla_status = "即将到期"
            if task.due_reminder_sent_at is None:
                task.due_reminder_sent_at = now
                self.audit(
                    session,
                    task=task,
                    event_type="sla_due_soon",
                    actor_id="system",
                    before_status=before,
                )
                recipient_type = "reviewer" if task.assignee_reviewer_id else "group"
                recipient_id = task.assignee_reviewer_id or task.assignee_group_id or ""
                self.add_notification(
                    session,
                    task=task,
                    event_type="due_soon",
                    recipient_type=recipient_type,
                    recipient_id=recipient_id,
                    payload={"dueAt": due_at.isoformat()},
                )
        else:
            task.sla_status = "正常"
        task.updated_at = now
        return task

    def claim_task(
        self,
        session: Session,
        task_id: str,
        reviewer_id: str,
    ) -> HumanTaskRecord:
        task = self.get_task(session, task_id)
        if task is None:
            raise HumanTaskValidation("人工任务不存在")
        self.refresh_sla(session, task)
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
        task.updated_at = self.now()
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
        self.refresh_sla(session, task)
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
        task.updated_at = self.now()
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
        modified_content: str | None = None,
        tags: list[str] | None = None,
    ) -> tuple[dict, ReviewDecisionRecord, bool]:
        task = self.get_task(session, task_id)
        if task is None:
            raise HumanTaskValidation("人工任务不存在")
        self.refresh_sla(session, task)
        self.active_reviewer(session, reviewer_id)
        idempotent = session.scalar(
            select(ReviewDecisionRecord).where(
                ReviewDecisionRecord.idempotency_key == idempotency_key,
            ),
        )
        if idempotent is not None:
            if (
                idempotent.human_task_id != task.id
                or idempotent.reviewer_id != reviewer_id
                or idempotent.decision != decision
            ):
                raise HumanTaskConflict("幂等键已用于其他审核决定")
            detail = self.get_task_detail(session, task.id)
            if detail is None:
                raise RuntimeError("人工任务详情不可用")
            return detail, idempotent, False
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
        decision_artifact_version_id = artifact_version_id
        original_version: ArtifactVersionRecord | None = None
        modified_version: ArtifactVersionRecord | None = None
        artifact_diff: ArtifactDiffRecord | None = None
        if decision == "modify_and_approve":
            current_version = session.get(ArtifactVersionRecord, task.artifact_version_id)
            normalized = (modified_content or "").strip()
            if current_version is None:
                raise HumanTaskValidation("当前产出物版本不存在")
            if not normalized or normalized == current_version.content.strip():
                raise HumanTaskValidation("修改后通过必须提交不同的产出物内容")
            next_version = (
                session.scalar(
                    select(func.max(ArtifactVersionRecord.version)).where(
                        ArtifactVersionRecord.artifact_id == current_version.artifact_id,
                    ),
                ) or 0
            ) + 1
            new_version = ArtifactVersionRecord(
                artifact_id=current_version.artifact_id,
                version=next_version,
                parent_version_id=current_version.id,
                content=normalized,
                created_by=reviewer_id,
            )
            session.add(new_version)
            session.flush()
            diff_text = "\n".join(unified_diff(
                current_version.content.splitlines(),
                normalized.splitlines(),
                fromfile=f"artifact-v{current_version.version}",
                tofile=f"artifact-v{new_version.version}",
                lineterm="",
            ))
            diff_record = ArtifactDiffRecord(
                human_task_id=task.id,
                from_version_id=current_version.id,
                to_version_id=new_version.id,
                old_content=current_version.content,
                new_content=normalized,
                unified_diff=diff_text,
            )
            session.add(diff_record)
            session.flush()
            original_version = current_version
            modified_version = new_version
            artifact_diff = diff_record
            task.artifact_version_id = new_version.id
            decision_artifact_version_id = new_version.id
            self.audit(
                session,
                task=task,
                event_type="artifact_edited",
                actor_id=reviewer_id,
                reason=reason,
                before_status=before,
                payload={
                    "fromVersionId": current_version.id,
                    "toVersionId": new_version.id,
                },
            )
        decision_record = ReviewDecisionRecord(
            human_task_id=task.id,
            reviewer_id=reviewer_id,
            decision=decision,
            reason=reason,
            artifact_version_id=decision_artifact_version_id,
            idempotency_key=idempotency_key,
            tags=tags or [],
        )
        session.add(decision_record)
        session.flush()
        if (
            decision == "modify_and_approve"
            and original_version is not None
            and modified_version is not None
            and artifact_diff is not None
        ):
            run = session.get(WorkflowRunRecord, task.workflow_run_id)
            source_node_run = session.scalar(
                select(NodeRunRecord)
                .where(
                    NodeRunRecord.run_id == task.workflow_run_id,
                    NodeRunRecord.node_id == task.source_node_id,
                )
                .order_by(NodeRunRecord.started_at.desc()),
            )
            if run is None:
                raise HumanTaskValidation("关联运行实例不存在")
            candidate = FeedbackCandidateRecord(
                human_task_id=task.id,
                decision_id=decision_record.id,
                original_version_id=original_version.id,
                modified_version_id=modified_version.id,
                diff_id=artifact_diff.id,
                reason=reason,
                tags=tags or [],
                workflow_run_id=task.workflow_run_id,
                workflow_id=run.workflow_id,
                agent_id=source_node_run.agent_id if source_node_run else None,
                source_node_id=task.source_node_id,
                created_by=reviewer_id,
                created_at=self.now(),
            )
            session.add(candidate)
            session.flush()
            self.audit(
                session,
                task=task,
                event_type="feedback_candidate_created",
                actor_id=reviewer_id,
                reason=reason,
                before_status=before,
                payload={"candidateId": candidate.id},
            )
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
                modified_count = session.scalar(
                    select(func.count()).select_from(ReviewDecisionRecord).where(
                        ReviewDecisionRecord.human_task_id == task.id,
                        ReviewDecisionRecord.decision == "modify_and_approve",
                    ),
                ) or 0
                task.status = "修改后通过" if modified_count else "已通过"
            else:
                task.status = "审核中"
        task.updated_at = self.now()
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
        return detail, decision_record, True

    def feedback_candidate_payload(
        self,
        session: Session,
        candidate: FeedbackCandidateRecord,
    ) -> dict:
        original = session.get(ArtifactVersionRecord, candidate.original_version_id)
        modified = session.get(ArtifactVersionRecord, candidate.modified_version_id)
        diff = session.get(ArtifactDiffRecord, candidate.diff_id)
        if original is None or modified is None or diff is None:
            raise RuntimeError("反馈候选关联版本不完整")
        return {
            "id": candidate.id,
            "human_task_id": candidate.human_task_id,
            "original_version_id": candidate.original_version_id,
            "modified_version_id": candidate.modified_version_id,
            "original_content": original.content,
            "modified_content": modified.content,
            "unified_diff": diff.unified_diff,
            "reason": candidate.reason,
            "tags": candidate.tags,
            "workflow_run_id": candidate.workflow_run_id,
            "workflow_id": candidate.workflow_id,
            "agent_id": candidate.agent_id,
            "source_node_id": candidate.source_node_id,
            "created_by": candidate.created_by,
            "status": candidate.status,
            "created_at": candidate.created_at,
            "confirmed_at": candidate.confirmed_at,
        }

    def list_feedback_candidates(self, session: Session) -> list[dict]:
        candidates = list(session.scalars(
            select(FeedbackCandidateRecord)
            .order_by(FeedbackCandidateRecord.created_at.desc()),
        ))
        return [
            self.feedback_candidate_payload(session, candidate)
            for candidate in candidates
        ]

    def get_feedback_candidate(
        self,
        session: Session,
        candidate_id: str,
    ) -> dict | None:
        candidate = session.get(FeedbackCandidateRecord, candidate_id)
        return (
            self.feedback_candidate_payload(session, candidate)
            if candidate is not None
            else None
        )

    def confirm_feedback_candidate(
        self,
        session: Session,
        candidate_id: str,
        *,
        reviewer_id: str,
        reason: str,
        idempotency_key: str,
    ) -> GoldenSampleRecord:
        candidate = session.get(FeedbackCandidateRecord, candidate_id)
        if candidate is None:
            raise HumanTaskValidation("反馈候选不存在")
        reviewer = self.active_reviewer(session, reviewer_id)
        if not reviewer.is_expert:
            raise HumanTaskValidation("只有专家审核人可以确认黄金样本")
        idempotent = session.scalar(
            select(GoldenSampleRecord).where(
                GoldenSampleRecord.idempotency_key == idempotency_key,
            ),
        )
        if idempotent is not None:
            if (
                idempotent.candidate_id != candidate.id
                or idempotent.reviewer_id != reviewer_id
            ):
                raise HumanTaskConflict("幂等键已用于其他黄金样本")
            return idempotent
        existing = session.scalar(
            select(GoldenSampleRecord).where(
                GoldenSampleRecord.candidate_id == candidate.id,
            ),
        )
        if existing is not None:
            raise HumanTaskConflict("反馈候选已确认黄金样本")
        modified = session.get(ArtifactVersionRecord, candidate.modified_version_id)
        run = session.get(WorkflowRunRecord, candidate.workflow_run_id)
        task = session.get(HumanTaskRecord, candidate.human_task_id)
        if modified is None or run is None or task is None:
            raise HumanTaskValidation("黄金样本来源数据不完整")
        golden = GoldenSampleRecord(
            candidate_id=candidate.id,
            input_text=run.input_text,
            expected_output=modified.content,
            reviewer_id=reviewer_id,
            reason=reason,
            idempotency_key=idempotency_key,
            created_at=self.now(),
        )
        session.add(golden)
        session.flush()
        candidate.status = "已确认"
        candidate.confirmed_at = self.now()
        self.audit(
            session,
            task=task,
            event_type="golden_sample_confirmed",
            actor_id=reviewer_id,
            reason=reason,
            payload={"candidateId": candidate.id, "goldenSampleId": golden.id},
        )
        session.commit()
        session.refresh(golden)
        return golden
