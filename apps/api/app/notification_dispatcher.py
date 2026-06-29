from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import NotificationOutboxRecord, utc_now


@dataclass(frozen=True)
class NotificationDelivery:
    id: str
    workspace_id: str | None
    event_key: str
    human_task_id: str
    event_type: str
    recipient_type: str
    recipient_id: str
    payload: dict


@dataclass(frozen=True)
class NotificationDispatchResult:
    status: str
    provider_message_id: str = ""
    error: str = ""


class NotificationDispatcher(Protocol):
    def send(self, delivery: NotificationDelivery) -> NotificationDispatchResult | dict:
        """Send one notification delivery through an external channel boundary."""


class NoopNotificationDispatcher:
    def send(self, delivery: NotificationDelivery) -> NotificationDispatchResult:
        return NotificationDispatchResult(
            status="sent",
            provider_message_id=f"noop-{delivery.id}",
        )


def normalize_dispatch_result(result: NotificationDispatchResult | dict) -> NotificationDispatchResult:
    if isinstance(result, NotificationDispatchResult):
        return result
    return NotificationDispatchResult(
        status=str(result.get("status", "failed")),
        provider_message_id=str(result.get("provider_message_id") or result.get("providerMessageId") or ""),
        error=str(result.get("error") or ""),
    )


class NotificationOutboxDispatchService:
    def __init__(
        self,
        dispatcher: NotificationDispatcher,
        *,
        clock=utc_now,
    ) -> None:
        self.dispatcher = dispatcher
        self.clock = clock

    def dispatch_pending(
        self,
        session: Session,
        *,
        workspace_id: str,
        limit: int = 20,
    ) -> dict:
        notifications = list(session.scalars(
            select(NotificationOutboxRecord)
            .where(
                NotificationOutboxRecord.workspace_id == workspace_id,
                NotificationOutboxRecord.status == "pending",
            )
            .order_by(NotificationOutboxRecord.created_at.asc(), NotificationOutboxRecord.id.asc())
            .limit(limit),
        ))
        items = []
        sent = 0
        failed = 0
        dispatched_at = self.clock()
        for notification in notifications:
            delivery = NotificationDelivery(
                id=notification.id,
                workspace_id=notification.workspace_id,
                event_key=notification.event_key,
                human_task_id=notification.human_task_id,
                event_type=notification.event_type,
                recipient_type=notification.recipient_type,
                recipient_id=notification.recipient_id,
                payload=notification.payload or {},
            )
            result = normalize_dispatch_result(self.dispatcher.send(delivery))
            status = "sent" if result.status == "sent" else "failed"
            if status == "sent":
                sent += 1
            else:
                failed += 1
            notification.status = status
            notification.payload = {
                **(notification.payload or {}),
                "dispatch": {
                    "status": status,
                    "providerMessageId": result.provider_message_id,
                    "error": result.error,
                    "dispatchedAt": serialize_datetime(dispatched_at),
                },
            }
            items.append({
                "id": notification.id,
                "event_key": notification.event_key,
                "status": status,
                "provider_message_id": result.provider_message_id,
                "error": result.error,
            })
        return {
            "processed": len(items),
            "sent": sent,
            "failed": failed,
            "items": items,
        }

    def requeue_failed(
        self,
        session: Session,
        *,
        workspace_id: str,
        notification_id: str,
        reason: str,
    ) -> NotificationOutboxRecord | None:
        notification = session.scalar(
            select(NotificationOutboxRecord).where(
                NotificationOutboxRecord.id == notification_id,
                NotificationOutboxRecord.workspace_id == workspace_id,
            ),
        )
        if notification is None:
            return None
        if notification.status != "failed":
            raise NotificationOutboxConflict("只有发送失败的通知可以重新入队")
        payload = notification.payload or {}
        previous_dispatch = payload.get("dispatch")
        history = list(payload.get("dispatchHistory") or [])
        if previous_dispatch:
            history.append(previous_dispatch)
        notification.status = "pending"
        notification.payload = {
            **payload,
            "dispatchHistory": history,
            "dispatch": {
                "status": "pending",
                "providerMessageId": "",
                "error": "",
                "requeuedAt": serialize_datetime(self.clock()),
                "reason": reason,
            },
        }
        return notification


class NotificationOutboxConflict(RuntimeError):
    pass


def serialize_datetime(value: datetime) -> str:
    return value.isoformat()
