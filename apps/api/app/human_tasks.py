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
    UserRecord,
    WorkspaceMembershipRecord,
    WorkflowRunRecord,
    utc_now,
)


class HumanTaskConflict(RuntimeError):
    pass


class HumanTaskValidation(RuntimeError):
    pass


class HumanTaskPermission(RuntimeError):
    pass


TERMINAL_TASK_STATUSES = {"宸查€氳繃", "淇敼鍚庨€氳繃", "宸查┏鍥?", "宸查€€鍥?", "鎭㈠澶辫触"}


class HumanTaskService:
    def __init__(self, clock: Callable[[], datetime] = utc_now):
        self.clock = clock

    def now(self) -> datetime:
        current = self.clock()
        return current if current.tzinfo else current.replace(tzinfo=timezone.utc)

    @staticmethod
    def aware(value: datetime) -> datetime:
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)

    def _group_name(self, session: Session, workspace_id: str, base_name: str) -> str:
        exists = session.scalar(
            select(ReviewGroupRecord).where(ReviewGroupRecord.name == base_name),
        )
        if exists is None:
            return base_name
        return f"{base_name}-{workspace_id[:8]}"

    def ensure_default_directory(self, session: Session, workspace_id: str) -> None:
        count = session.scalar(
            select(func.count()).select_from(ReviewerRecord).where(
                ReviewerRecord.workspace_id == workspace_id,
            ),
        ) or 0
        if count:
            return
        now = self.now()
        reviewers = [
            ReviewerRecord(
                workspace_id=workspace_id,
                name="鏋楁檽",
                role="浜у搧瀹℃牳浜?",
                is_active=False,
                created_at=now,
            ),
            ReviewerRecord(
                workspace_id=workspace_id,
                name="闄堝崜",
                role="璐ㄩ噺涓撳",
                is_expert=True,
                is_active=False,
                created_at=now + timedelta(microseconds=1),
            ),
            ReviewerRecord(
                workspace_id=workspace_id,
                name="鍛ㄥ畞",
                role="瀹℃牳璐熻矗浜?",
                is_expert=True,
                is_active=False,
                created_at=now + timedelta(microseconds=2),
            ),
        ]
        session.add_all(reviewers)
        session.flush()
        product_group = ReviewGroupRecord(
            workspace_id=workspace_id,
            name=self._group_name(session, workspace_id, "浜у搧瀹℃牳缁?"),
            assignment_mode="group_claim",
            created_at=now,
        )
        escalation_group = ReviewGroupRecord(
            workspace_id=workspace_id,
            name=self._group_name(session, workspace_id, "鍗囩骇瀹℃牳缁?"),
            assignment_mode="round_robin",
            is_escalation_group=True,
            created_at=now + timedelta(microseconds=1),
        )
        session.add_all([product_group, escalation_group])
        session.flush()
        session.add_all([
            ReviewGroupMemberRecord(
                workspace_id=workspace_id,
                group_id=product_group.id,
                reviewer_id=reviewers[0].id,
            ),
            ReviewGroupMemberRecord(
                workspace_id=workspace_id,
                group_id=product_group.id,
                reviewer_id=reviewers[1].id,
                role="涓撳",
            ),
            ReviewGroupMemberRecord(
                workspace_id=workspace_id,
                group_id=escalation_group.id,
                reviewer_id=reviewers[2].id,
                role="瀹℃牳璐熻矗浜?",
            ),
        ])
        session.commit()

    def list_reviewers(self, session: Session, workspace_id: str) -> list[ReviewerRecord]:
        return list(session.scalars(
            select(ReviewerRecord)
            .where(ReviewerRecord.workspace_id == workspace_id)
            .order_by(ReviewerRecord.created_at.asc()),
        ))

    def list_groups(self, session: Session, workspace_id: str) -> list[dict]:
        groups = list(session.scalars(
            select(ReviewGroupRecord)
            .where(ReviewGroupRecord.workspace_id == workspace_id)
            .order_by(ReviewGroupRecord.created_at.asc()),
        ))
        result: list[dict] = []
        for group in groups:
            reviewer_ids = self.group_reviewer_ids(session, group.id, workspace_id)
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

    def group_reviewer_ids(
        self,
        session: Session,
        group_id: str,
        workspace_id: str,
    ) -> list[str]:
        return list(session.scalars(
            select(ReviewGroupMemberRecord.reviewer_id)
            .join(
                ReviewerRecord,
                ReviewerRecord.id == ReviewGroupMemberRecord.reviewer_id,
            )
            .where(
                ReviewGroupMemberRecord.group_id == group_id,
                ReviewGroupMemberRecord.workspace_id == workspace_id,
            )
            .order_by(ReviewerRecord.created_at.asc()),
        ))

    def default_product_group(self, session: Session, workspace_id: str) -> ReviewGroupRecord:
        group = session.scalar(
            select(ReviewGroupRecord).where(
                ReviewGroupRecord.workspace_id == workspace_id,
                ReviewGroupRecord.is_escalation_group.is_(False),
            ),
        )
        if group is None:
            raise RuntimeError("榛樿瀹℃牳缁勪笉瀛樺湪")
        return group

    def active_reviewer(
        self,
        session: Session,
        reviewer_id: str,
        workspace_id: str,
    ) -> ReviewerRecord:
        reviewer = session.scalar(
            select(ReviewerRecord).where(
                ReviewerRecord.id == reviewer_id,
                ReviewerRecord.workspace_id == workspace_id,
            ),
        )
        if (
            reviewer is None
            or not reviewer.is_active
        ):
            raise HumanTaskValidation("瀹℃牳浜轰笉瀛樺湪鎴栧凡鍋滅敤")
        return reviewer

    def active_reviewer_for_user(
        self,
        session: Session,
        workspace_id: str,
        user_id: str,
    ) -> ReviewerRecord:
        user = session.get(UserRecord, user_id)
        membership = session.scalar(
            select(WorkspaceMembershipRecord).where(
                WorkspaceMembershipRecord.workspace_id == workspace_id,
                WorkspaceMembershipRecord.user_id == user_id,
                WorkspaceMembershipRecord.status == "active",
            ),
        )
        reviewer = session.scalar(
            select(ReviewerRecord).where(
                ReviewerRecord.workspace_id == workspace_id,
                ReviewerRecord.user_id == user_id,
                ReviewerRecord.is_active.is_(True),
            ),
        )
        if (
            user is None
            or user.status != "active"
            or membership is None
            or reviewer is None
        ):
            raise HumanTaskPermission("当前用户没有有效审核资格")
        return reviewer

    def workspace_group(
        self,
        session: Session,
        workspace_id: str,
        group_id: str | None,
    ) -> ReviewGroupRecord | None:
        if not group_id:
            return None
        return session.scalar(
            select(ReviewGroupRecord).where(
                ReviewGroupRecord.id == group_id,
                ReviewGroupRecord.workspace_id == workspace_id,
            ),
        )

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
        actor_user_id = None
        if actor_id != "system":
            actor_user_id = session.scalar(
                select(ReviewerRecord.user_id).where(
                    ReviewerRecord.id == actor_id,
                    ReviewerRecord.workspace_id == task.workspace_id,
                ),
            )
        session.add(AuditEventRecord(
            workspace_id=task.workspace_id,
            human_task_id=task.id,
            actor_user_id=actor_user_id,
            action=event_type,
            target_type="human_task",
            target_id=task.id,
            outcome="success",
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
        if run.workspace_id is None:
            raise HumanTaskValidation("运行缺少 Workspace")
        self.ensure_default_directory(session, run.workspace_id)
        now = self.now()
        node_run = NodeRunRecord(
            workspace_id=run.workspace_id,
            run_id=run.id,
            node_id=node["id"],
            node_type="human",
            node_name=node["data"].get("label", node["id"]),
            status="绛夊緟瀹℃牳",
            input_text=node_input,
            output_text=node_input,
            attempts=1,
            score=score,
            started_at=now,
        )
        session.add(node_run)
        session.flush()
        artifact = ArtifactRecord(
            workspace_id=run.workspace_id,
            run_id=run.id,
            source_node_run_id=source_node_run_id,
            content=node_input,
            score=score,
        )
        session.add(artifact)
        session.flush()
        artifact_version = ArtifactVersionRecord(
            workspace_id=run.workspace_id,
            artifact_id=artifact.id,
            content=node_input,
        )
        session.add(artifact_version)
        session.flush()

        data = node.get("data", {})
        due_minutes = int(data.get("dueMinutes", 240))
        escalation_minutes = int(data.get("escalationMinutes", 480))
        if due_minutes <= 0 or escalation_minutes <= due_minutes:
            raise HumanTaskValidation("SLA 鍗囩骇鏃堕棿蹇呴』鏅氫簬鎴鏃堕棿")
        assignment_type = data.get("assignmentType", "group_claim")
        participant_snapshot = list(data.get("reviewerIds", []))
        assignee_group_id = data.get("groupId")
        group: ReviewGroupRecord | None = None
        if not participant_snapshot:
            group = (
                self.workspace_group(session, run.workspace_id, assignee_group_id)
                if assignee_group_id
                else self.default_product_group(session, run.workspace_id)
            )
            if group is None:
                raise HumanTaskValidation("瀹℃牳缁勪笉瀛樺湪")
            assignee_group_id = assignee_group_id or group.id
            participant_snapshot = self.group_reviewer_ids(
                session,
                assignee_group_id,
                run.workspace_id,
            )
        escalation_group_id = data.get("escalationGroupId")
        if not escalation_group_id:
            escalation_group = session.scalar(
                select(ReviewGroupRecord).where(
                    ReviewGroupRecord.workspace_id == run.workspace_id,
                    ReviewGroupRecord.is_escalation_group.is_(True),
                ),
            )
            escalation_group_id = escalation_group.id if escalation_group else None
        assignee_reviewer_id = None
        task_status = "寰呰棰?"
        if assignment_type == "round_robin":
            group = group or self.workspace_group(session, run.workspace_id, assignee_group_id)
            if (
                group is None
                or not participant_snapshot
            ):
                raise HumanTaskValidation("杞鍒嗛厤闇€瑕佸寘鍚垚鍛樼殑瀹℃牳缁?")
            assignee_reviewer_id = participant_snapshot[
                group.rotation_cursor % len(participant_snapshot)
            ]
            group.rotation_cursor += 1
            task_status = "瀹℃牳涓?"
        task = HumanTaskRecord(
            workspace_id=run.workspace_id,
            workflow_run_id=run.id,
            node_run_id=node_run.id,
            human_node_id=node["id"],
            source_node_id=source_node_id,
            artifact_version_id=artifact_version.id,
            title=data.get("label", "浜哄伐瀹℃牳"),
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
        run.status = "绛夊緟瀹℃牳"
        run.current_node = node_run.node_name
        run.output_text = node_input
        run.score = score
        session.commit()
        session.refresh(task)
        return node_run, task

    def list_tasks(
        self,
        session: Session,
        workspace_id: str,
        *,
        status: str | None = None,
        reviewer_id: str | None = None,
        group_id: str | None = None,
        sla_status: str | None = None,
        active: bool = False,
    ) -> list[HumanTaskRecord]:
        statement = (
            select(HumanTaskRecord)
            .where(HumanTaskRecord.workspace_id == workspace_id)
            .order_by(HumanTaskRecord.created_at.desc())
        )
        tasks = list(session.scalars(statement))
        for task in tasks:
            self.refresh_sla(session, task)
        session.commit()
        terminal_statuses = {"宸查€氳繃", "淇敼鍚庨€氳繃", "宸查┏鍥?", "宸查€€鍥?"}
        return [
            task
            for task in tasks
            if (status is None or task.status == status)
            and (reviewer_id is None or task.assignee_reviewer_id == reviewer_id)
            and (group_id is None or task.assignee_group_id == group_id)
            and (sla_status is None or task.sla_status == sla_status)
            and (not active or task.status not in terminal_statuses)
        ]

    def get_task(
        self,
        session: Session,
        workspace_id: str,
        task_id: str,
    ) -> HumanTaskRecord | None:
        return session.scalar(
            select(HumanTaskRecord).where(
                HumanTaskRecord.id == task_id,
                HumanTaskRecord.workspace_id == workspace_id,
            ),
        )

    def get_task_detail(self, session: Session, workspace_id: str, task_id: str) -> dict | None:
        task = self.get_task(session, workspace_id, task_id)
        if task is None:
            return None
        self.refresh_sla(session, task)
        session.commit()
        artifact_version = session.scalar(
            select(ArtifactVersionRecord).where(
                ArtifactVersionRecord.id == task.artifact_version_id,
                ArtifactVersionRecord.workspace_id == workspace_id,
            ),
        )
        run = session.scalar(
            select(WorkflowRunRecord).where(
                WorkflowRunRecord.id == task.workflow_run_id,
                WorkflowRunRecord.workspace_id == workspace_id,
            ),
        )
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
                workspace_id=task.workspace_id,
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
                group = self.workspace_group(session, task.workspace_id, task.escalation_group_id)
                if group is None:
                    raise HumanTaskValidation("鍗囩骇瀹℃牳缁勪笉瀛樺湪")
                task.assignee_group_id = group.id
                task.assignee_reviewer_id = None
                task.participant_snapshot = self.group_reviewer_ids(
                    session,
                    group.id,
                    task.workspace_id,
                )
                task.escalated_at = now
                task.sla_status = "宸插崌绾?"
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
            task.sla_status = "宸查€炬湡"
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
            task.sla_status = "鍗冲皢鍒版湡"
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
            task.sla_status = "姝ｅ父"
        task.updated_at = now
        return task

    def claim_task(
        self,
        session: Session,
        workspace_id: str,
        task_id: str,
        reviewer: ReviewerRecord,
    ) -> HumanTaskRecord:
        reviewer_id = reviewer.id
        task = self.get_task(session, workspace_id, task_id)
        if task is None:
            raise HumanTaskValidation("浜哄伐浠诲姟涓嶅瓨鍦?")
        self.refresh_sla(session, task)
        if task.status in TERMINAL_TASK_STATUSES:
            raise HumanTaskConflict("缁堟€佷换鍔′笉鑳借棰?")
        if reviewer_id not in task.participant_snapshot:
            raise HumanTaskConflict("瀹℃牳浜轰笉鍦ㄥ綋鍓嶄换鍔″弬涓庝汉蹇収涓?")
        if task.assignee_reviewer_id and task.assignee_reviewer_id != reviewer_id:
            raise HumanTaskConflict("浠诲姟宸茶鍏朵粬瀹℃牳浜鸿棰?")
        before = task.status
        task.assignee_reviewer_id = reviewer_id
        task.status = "瀹℃牳涓?"
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
        workspace_id: str,
        task_id: str,
        *,
        actor_reviewer: ReviewerRecord,
        reviewer_id: str | None,
        group_id: str | None,
        reason: str,
    ) -> HumanTaskRecord:
        actor_id = actor_reviewer.id
        task = self.get_task(session, workspace_id, task_id)
        if task is None:
            raise HumanTaskValidation("浜哄伐浠诲姟涓嶅瓨鍦?")
        self.refresh_sla(session, task)
        if task.status in TERMINAL_TASK_STATUSES:
            raise HumanTaskConflict("缁堟€佷换鍔′笉鑳借浆浜?")
        if bool(reviewer_id) == bool(group_id):
            raise HumanTaskValidation("蹇呴』涓斿彧鑳介€夋嫨瀹℃牳浜烘垨瀹℃牳缁?")
        before = task.status
        if reviewer_id:
            self.active_reviewer(session, reviewer_id, workspace_id)
            if reviewer_id not in task.participant_snapshot:
                task.participant_snapshot = [*task.participant_snapshot, reviewer_id]
            task.assignee_reviewer_id = reviewer_id
            task.status = "瀹℃牳涓?"
        else:
            group = self.workspace_group(session, workspace_id, group_id)
            if group is None:
                raise HumanTaskValidation("瀹℃牳缁勪笉瀛樺湪")
            task.assignee_group_id = group.id
            task.assignee_reviewer_id = None
            task.participant_snapshot = self.group_reviewer_ids(
                session,
                group.id,
                workspace_id,
            )
            task.status = "寰呰棰?"
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
        workspace_id: str,
        task_id: str,
        *,
        reviewer: ReviewerRecord,
        decision: str,
        reason: str,
        artifact_version_id: str,
        idempotency_key: str,
        modified_content: str | None = None,
        tags: list[str] | None = None,
    ) -> tuple[dict, ReviewDecisionRecord, bool]:
        reviewer_id = reviewer.id
        task = self.get_task(session, workspace_id, task_id)
        if task is None:
            raise HumanTaskValidation("浜哄伐浠诲姟涓嶅瓨鍦?")
        self.refresh_sla(session, task)
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
                raise HumanTaskConflict("骞傜瓑閿凡鐢ㄤ簬鍏朵粬瀹℃牳鍐冲畾")
            detail = self.get_task_detail(session, workspace_id, task.id)
            if detail is None:
                raise RuntimeError("浜哄伐浠诲姟璇︽儏涓嶅彲鐢?")
            return detail, idempotent, False
        if task.status in TERMINAL_TASK_STATUSES:
            raise HumanTaskConflict("缁堟€佷换鍔′笉鑳介噸澶嶅喅绛?")
        if reviewer_id not in task.participant_snapshot:
            raise HumanTaskConflict("瀹℃牳浜轰笉鍦ㄥ綋鍓嶄换鍔″弬涓庝汉蹇収涓?")
        if artifact_version_id != task.artifact_version_id:
            raise HumanTaskConflict("浜у嚭鐗╃増鏈凡鏇存柊锛岃鍒锋柊鍚庨噸璇?")
        existing = session.scalar(
            select(ReviewDecisionRecord).where(
                ReviewDecisionRecord.human_task_id == task.id,
                ReviewDecisionRecord.reviewer_id == reviewer_id,
            ),
        )
        if existing is not None:
            raise HumanTaskConflict("瀹℃牳浜哄凡鎻愪氦鍐冲畾")
        before = task.status
        decision_artifact_version_id = artifact_version_id
        original_version: ArtifactVersionRecord | None = None
        modified_version: ArtifactVersionRecord | None = None
        artifact_diff: ArtifactDiffRecord | None = None
        if decision == "modify_and_approve":
            current_version = session.scalar(
                select(ArtifactVersionRecord).where(
                    ArtifactVersionRecord.id == task.artifact_version_id,
                    ArtifactVersionRecord.workspace_id == workspace_id,
                ),
            )
            normalized = (modified_content or "").strip()
            if current_version is None:
                raise HumanTaskValidation("褰撳墠浜у嚭鐗╃増鏈笉瀛樺湪")
            if not normalized or normalized == current_version.content.strip():
                raise HumanTaskValidation("淇敼鍚庨€氳繃蹇呴』鎻愪氦涓嶅悓鐨勪骇鍑虹墿鍐呭")
            next_version = (
                session.scalar(
                    select(func.max(ArtifactVersionRecord.version)).where(
                        ArtifactVersionRecord.artifact_id == current_version.artifact_id,
                    ),
                ) or 0
            ) + 1
            new_version = ArtifactVersionRecord(
                workspace_id=task.workspace_id,
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
                workspace_id=task.workspace_id,
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
            workspace_id=task.workspace_id,
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
            run = session.scalar(
                select(WorkflowRunRecord).where(
                    WorkflowRunRecord.id == task.workflow_run_id,
                    WorkflowRunRecord.workspace_id == workspace_id,
                ),
            )
            source_node_run = session.scalar(
                select(NodeRunRecord)
                .where(
                    NodeRunRecord.run_id == task.workflow_run_id,
                    NodeRunRecord.node_id == task.source_node_id,
                )
                .order_by(NodeRunRecord.started_at.desc()),
            )
            if run is None:
                raise HumanTaskValidation("鍏宠仈杩愯瀹炰緥涓嶅瓨鍦?")
            candidate = FeedbackCandidateRecord(
                workspace_id=task.workspace_id,
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
            task.status = "宸查┏鍥?"
        elif decision == "return_for_rerun":
            task.status = "宸查€€鍥?"
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
                task.status = "淇敼鍚庨€氳繃" if modified_count else "宸查€氳繃"
            else:
                task.status = "瀹℃牳涓?"
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
        detail = self.get_task_detail(session, workspace_id, task.id)
        if detail is None:
            raise RuntimeError("浜哄伐浠诲姟璇︽儏涓嶅彲鐢?")
        return detail, decision_record, True

    def feedback_candidate_payload(
        self,
        session: Session,
        candidate: FeedbackCandidateRecord,
    ) -> dict:
        original = session.scalar(
            select(ArtifactVersionRecord).where(
                ArtifactVersionRecord.id == candidate.original_version_id,
                ArtifactVersionRecord.workspace_id == candidate.workspace_id,
            ),
        )
        modified = session.scalar(
            select(ArtifactVersionRecord).where(
                ArtifactVersionRecord.id == candidate.modified_version_id,
                ArtifactVersionRecord.workspace_id == candidate.workspace_id,
            ),
        )
        diff = session.scalar(
            select(ArtifactDiffRecord).where(
                ArtifactDiffRecord.id == candidate.diff_id,
                ArtifactDiffRecord.workspace_id == candidate.workspace_id,
            ),
        )
        if original is None or modified is None or diff is None:
            raise RuntimeError("鍙嶉鍊欓€夊叧鑱旂増鏈笉瀹屾暣")
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

    def list_feedback_candidates(self, session: Session, workspace_id: str) -> list[dict]:
        candidates = list(session.scalars(
            select(FeedbackCandidateRecord)
            .where(FeedbackCandidateRecord.workspace_id == workspace_id)
            .order_by(FeedbackCandidateRecord.created_at.desc()),
        ))
        return [
            self.feedback_candidate_payload(session, candidate)
            for candidate in candidates
        ]

    def get_feedback_candidate(
        self,
        session: Session,
        workspace_id: str,
        candidate_id: str,
    ) -> dict | None:
        candidate = session.scalar(
            select(FeedbackCandidateRecord).where(
                FeedbackCandidateRecord.id == candidate_id,
                FeedbackCandidateRecord.workspace_id == workspace_id,
            ),
        )
        return (
            self.feedback_candidate_payload(session, candidate)
            if candidate is not None
            else None
        )

    def confirm_feedback_candidate(
        self,
        session: Session,
        workspace_id: str,
        candidate_id: str,
        *,
        reviewer: ReviewerRecord,
        reason: str,
        idempotency_key: str,
    ) -> GoldenSampleRecord:
        reviewer_id = reviewer.id
        candidate = session.scalar(
            select(FeedbackCandidateRecord).where(
                FeedbackCandidateRecord.id == candidate_id,
                FeedbackCandidateRecord.workspace_id == workspace_id,
            ),
        )
        if candidate is None:
            raise HumanTaskValidation("鍙嶉鍊欓€変笉瀛樺湪")
        if not reviewer.is_expert:
            raise HumanTaskPermission("只有专家审核人可以确认黄金样本")
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
                raise HumanTaskConflict("骞傜瓑閿凡鐢ㄤ簬鍏朵粬榛勯噾鏍锋湰")
            return idempotent
        existing = session.scalar(
            select(GoldenSampleRecord).where(
                GoldenSampleRecord.candidate_id == candidate.id,
            ),
        )
        if existing is not None:
            raise HumanTaskConflict("鍙嶉鍊欓€夊凡纭榛勯噾鏍锋湰")
        modified = session.scalar(
            select(ArtifactVersionRecord).where(
                ArtifactVersionRecord.id == candidate.modified_version_id,
                ArtifactVersionRecord.workspace_id == workspace_id,
            ),
        )
        run = session.scalar(
            select(WorkflowRunRecord).where(
                WorkflowRunRecord.id == candidate.workflow_run_id,
                WorkflowRunRecord.workspace_id == workspace_id,
            ),
        )
        task = session.scalar(
            select(HumanTaskRecord).where(
                HumanTaskRecord.id == candidate.human_task_id,
                HumanTaskRecord.workspace_id == workspace_id,
            ),
        )
        if modified is None or run is None or task is None:
            raise HumanTaskValidation("榛勯噾鏍锋湰鏉ユ簮鏁版嵁涓嶅畬鏁?")
        golden = GoldenSampleRecord(
            workspace_id=task.workspace_id,
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
        candidate.status = "宸茬‘璁?"
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
