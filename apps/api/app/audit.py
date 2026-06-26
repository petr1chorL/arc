from dataclasses import dataclass

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditEventRecord


@dataclass(frozen=True)
class AuditActor:
    organization_id: str | None
    workspace_id: str | None
    actor_user_id: str | None
    session_id: str | None


class AuditService:
    def record(
        self,
        session: Session,
        *,
        actor: AuditActor,
        action: str,
        target_type: str,
        target_id: str | None,
        outcome: str,
        request: Request | None = None,
        metadata: dict | None = None,
        workspace_id: str | None = None,
    ) -> AuditEventRecord:
        event = AuditEventRecord(
            organization_id=actor.organization_id,
            workspace_id=workspace_id if workspace_id is not None else actor.workspace_id,
            actor_user_id=actor.actor_user_id,
            session_id=actor.session_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            outcome=outcome,
            ip_address=request.client.host if request and request.client else None,
            event_metadata=metadata or {},
        )
        session.add(event)
        session.flush()
        return event
