from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from croniter import croniter
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.execution import ExecutionService
from app.models import (
    ScheduleDispatchRecord,
    WorkflowRunRecord,
    WorkflowScheduleRecord,
    WorkflowVersionRecord,
    utc_now,
)


class ScheduleValidationError(ValueError):
    pass


def next_cron_occurrence(
    cron_expression: str,
    timezone_name: str,
    *,
    after: datetime | None = None,
) -> datetime:
    expression = cron_expression.strip()
    if len(expression.split()) != 5 or not croniter.is_valid(expression):
        raise ScheduleValidationError("cronExpression 必须是有效的五段 Cron 表达式")
    try:
        schedule_timezone = ZoneInfo(timezone_name.strip())
    except (ZoneInfoNotFoundError, ValueError):
        raise ScheduleValidationError("timezone 必须是有效的 IANA 时区") from None
    base = after or utc_now()
    if base.tzinfo is None:
        base = base.replace(tzinfo=timezone.utc)
    localized = base.astimezone(schedule_timezone)
    return croniter(expression, localized).get_next(datetime).astimezone(timezone.utc)


class ScheduleService:
    def find_version(
        self,
        session: Session,
        *,
        workspace_id: str,
        workflow_id: str,
        workflow_version: str,
    ) -> WorkflowVersionRecord:
        version = session.scalar(
            select(WorkflowVersionRecord).where(
                WorkflowVersionRecord.workspace_id == workspace_id,
                WorkflowVersionRecord.workflow_id == workflow_id,
                WorkflowVersionRecord.version == workflow_version,
            ),
        )
        if version is None:
            raise ScheduleValidationError("当前 Workspace 中不存在该已发布工作流版本")
        return version

    def create(
        self,
        session: Session,
        *,
        workspace_id: str,
        name: str,
        workflow_id: str,
        workflow_version: str,
        cron_expression: str,
        timezone_name: str,
        input_text: str,
        status: str,
        created_by: str,
    ) -> WorkflowScheduleRecord:
        version = self.find_version(
            session,
            workspace_id=workspace_id,
            workflow_id=workflow_id,
            workflow_version=workflow_version,
        )
        now = utc_now()
        next_run_at = next_cron_occurrence(
            cron_expression,
            timezone_name,
            after=now,
        )
        if status not in {"active", "paused"}:
            raise ScheduleValidationError("status 只能是 active 或 paused")
        record = WorkflowScheduleRecord(
            workspace_id=workspace_id,
            name=name.strip(),
            workflow_id=workflow_id,
            workflow_version_id=version.id,
            workflow_version=version.version,
            cron_expression=cron_expression.strip(),
            timezone=timezone_name.strip(),
            input_text=input_text,
            status=status,
            next_run_at=next_run_at if status == "active" else None,
            created_by=created_by,
            created_at=now,
            updated_at=now,
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return record

    def update(
        self,
        session: Session,
        record: WorkflowScheduleRecord,
        *,
        changes: dict,
    ) -> WorkflowScheduleRecord:
        workflow_id = changes.get("workflow_id", record.workflow_id)
        workflow_version = changes.get("workflow_version", record.workflow_version)
        if "workflow_id" in changes or "workflow_version" in changes:
            version = self.find_version(
                session,
                workspace_id=record.workspace_id,
                workflow_id=workflow_id,
                workflow_version=workflow_version,
            )
            record.workflow_id = workflow_id
            record.workflow_version_id = version.id
            record.workflow_version = version.version
        if "name" in changes:
            record.name = changes["name"].strip()
        if "input_text" in changes:
            record.input_text = changes["input_text"]
        if "cron_expression" in changes:
            record.cron_expression = changes["cron_expression"].strip()
        if "timezone" in changes:
            record.timezone = changes["timezone"].strip()
        next_run_at = next_cron_occurrence(
            record.cron_expression,
            record.timezone,
            after=utc_now(),
        )
        record.next_run_at = next_run_at if record.status == "active" else None
        record.updated_at = utc_now()
        session.commit()
        session.refresh(record)
        return record

    def set_status(
        self,
        session: Session,
        record: WorkflowScheduleRecord,
        status: str,
    ) -> WorkflowScheduleRecord:
        record.status = status
        record.updated_at = utc_now()
        record.next_run_at = (
            next_cron_occurrence(record.cron_expression, record.timezone, after=record.updated_at)
            if status == "active"
            else None
        )
        session.commit()
        session.refresh(record)
        return record

    def dispatch_due(
        self,
        *,
        session: Session,
        workspace_id: str,
        execution_service: ExecutionService,
        now: datetime | None = None,
        limit: int = 20,
    ) -> int:
        current_time = now or utc_now()
        schedules = list(
            session.scalars(
                select(WorkflowScheduleRecord)
                .where(
                    WorkflowScheduleRecord.workspace_id == workspace_id,
                    WorkflowScheduleRecord.status == "active",
                    WorkflowScheduleRecord.next_run_at.is_not(None),
                    WorkflowScheduleRecord.next_run_at <= current_time,
                )
                .order_by(WorkflowScheduleRecord.next_run_at.asc())
                .limit(limit),
            ),
        )
        enqueued = 0
        for schedule in schedules:
            scheduled_for = schedule.next_run_at
            schedule.next_run_at = next_cron_occurrence(
                schedule.cron_expression,
                schedule.timezone,
                after=current_time,
            )
            dispatch = self._dispatch(
                session=session,
                schedule=schedule,
                scheduled_for=scheduled_for,
                execution_service=execution_service,
            )
            if dispatch is not None and dispatch.status == "enqueued":
                enqueued += 1
        return enqueued

    def trigger_now(
        self,
        *,
        session: Session,
        schedule: WorkflowScheduleRecord,
        execution_service: ExecutionService,
    ) -> ScheduleDispatchRecord:
        dispatch = self._dispatch(
            session=session,
            schedule=schedule,
            scheduled_for=utc_now(),
            execution_service=execution_service,
        )
        if dispatch is None:
            raise RuntimeError("调度触发记录已存在")
        return dispatch

    def _dispatch(
        self,
        *,
        session: Session,
        schedule: WorkflowScheduleRecord,
        scheduled_for: datetime,
        execution_service: ExecutionService,
    ) -> ScheduleDispatchRecord | None:
        dispatch = ScheduleDispatchRecord(
            workspace_id=schedule.workspace_id,
            schedule_id=schedule.id,
            scheduled_for=scheduled_for,
            status="dispatching",
        )
        try:
            with session.begin_nested():
                session.add(dispatch)
                session.flush()
        except IntegrityError:
            session.expire_all()
            return None

        if schedule.last_run_id:
            previous_run = session.scalar(
                select(WorkflowRunRecord).where(
                    WorkflowRunRecord.id == schedule.last_run_id,
                    WorkflowRunRecord.workspace_id == schedule.workspace_id,
                ),
            )
            if previous_run is not None and previous_run.completed_at is None:
                dispatch.status = "skipped"
                dispatch.reason = "overlap: previous scheduled run is still active"
                schedule.last_scheduled_for = scheduled_for
                schedule.updated_at = utc_now()
                session.commit()
                session.refresh(dispatch)
                return dispatch

        try:
            run = execution_service.enqueue_workflow_version(
                session=session,
                workspace_id=schedule.workspace_id,
                workflow_id=schedule.workflow_id,
                workflow_version=schedule.workflow_version,
                input_text=schedule.input_text,
                created_by=f"schedule:{schedule.id}",
            )
        except Exception as error:
            dispatch.status = "failed"
            dispatch.reason = str(error)[:1000]
            schedule.last_scheduled_for = scheduled_for
            schedule.updated_at = utc_now()
            session.commit()
            session.refresh(dispatch)
            return dispatch

        dispatch.status = "enqueued"
        dispatch.run_id = run.id
        schedule.last_scheduled_for = scheduled_for
        schedule.last_run_id = run.id
        schedule.updated_at = utc_now()
        session.commit()
        session.refresh(dispatch)
        return dispatch
