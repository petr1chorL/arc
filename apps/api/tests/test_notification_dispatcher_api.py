from sqlalchemy import select

from api_test_support import FIXED_NOW, create_authenticated_client, csrf_headers, workspace_url
from app.models import AuditEventRecord, NotificationOutboxRecord, WorkspaceRecord


class FakeNotificationDispatcher:
    def __init__(self):
        self.deliveries = []

    def send(self, delivery):
        self.deliveries.append(delivery)
        if delivery.event_type == "escalated":
            return {
                "status": "failed",
                "provider_message_id": "",
                "error": "webhook rejected",
            }
        return {
            "status": "sent",
            "provider_message_id": f"fake-{delivery.id}",
            "error": "",
        }


def add_notification(
    client,
    *,
    workspace_id,
    event_key,
    event_type="due_soon",
    status="pending",
):
    with client.app.state.session_factory() as session:
        record = NotificationOutboxRecord(
            workspace_id=workspace_id,
            event_key=event_key,
            human_task_id=f"task-{event_key}",
            event_type=event_type,
            recipient_type="reviewer",
            recipient_id="reviewer-1",
            payload={"message": f"payload for {event_key}"},
            status=status,
            created_at=FIXED_NOW,
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return record.id


def test_dispatches_pending_notifications_and_records_results(tmp_path):
    dispatcher = FakeNotificationDispatcher()
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'notification-dispatch.db'}",
        notification_dispatcher=dispatcher,
    )
    sent_id = add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-1:due_soon",
    )
    failed_id = add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-2:escalated",
        event_type="escalated",
    )
    already_sent_id = add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-3:due_soon",
        status="sent",
    )
    with client.app.state.session_factory() as session:
        other_workspace = WorkspaceRecord(
            organization_id=session.scalar(select(WorkspaceRecord.organization_id)),
            name="其他空间",
            slug="other-workspace",
            status="active",
            created_by="user-1",
        )
        session.add(other_workspace)
        session.commit()
        session.refresh(other_workspace)
        other_workspace_id = other_workspace.id
    other_notification_id = add_notification(
        client,
        workspace_id=other_workspace_id,
        event_key="other:due_soon",
    )

    response = client.post(
        workspace_url(workspace_id, "/notifications/outbox/dispatch"),
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["processed"] == 2
    assert body["sent"] == 1
    assert body["failed"] == 1
    items_by_id = {item["id"]: item for item in body["items"]}
    assert set(items_by_id) == {failed_id, sent_id}
    assert items_by_id[failed_id]["status"] == "failed"
    assert items_by_id[failed_id]["error"] == "webhook rejected"
    assert items_by_id[sent_id]["status"] == "sent"
    assert items_by_id[sent_id]["providerMessageId"] == f"fake-{sent_id}"
    assert {delivery.id for delivery in dispatcher.deliveries} == {failed_id, sent_id}

    with client.app.state.session_factory() as session:
        sent_record = session.get(NotificationOutboxRecord, sent_id)
        failed_record = session.get(NotificationOutboxRecord, failed_id)
        already_sent_record = session.get(NotificationOutboxRecord, already_sent_id)
        other_workspace_record = session.get(NotificationOutboxRecord, other_notification_id)
        assert sent_record.status == "sent"
        assert sent_record.payload["dispatch"]["providerMessageId"] == f"fake-{sent_id}"
        assert failed_record.status == "failed"
        assert failed_record.payload["dispatch"]["error"] == "webhook rejected"
        assert already_sent_record.status == "sent"
        assert "dispatch" not in already_sent_record.payload
        assert other_workspace_record.status == "pending"


def test_dispatch_returns_empty_summary_when_no_pending_notifications(tmp_path):
    dispatcher = FakeNotificationDispatcher()
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'notification-dispatch-empty.db'}",
        notification_dispatcher=dispatcher,
    )

    response = client.post(
        workspace_url(workspace_id, "/notifications/outbox/dispatch"),
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    assert response.json() == {
        "processed": 0,
        "sent": 0,
        "failed": 0,
        "items": [],
    }
    assert dispatcher.deliveries == []


def test_failed_notification_can_be_requeued_with_audit_reason(tmp_path):
    dispatcher = FakeNotificationDispatcher()
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'notification-requeue.db'}",
        notification_dispatcher=dispatcher,
    )
    notification_id = add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-1:escalated",
        event_type="escalated",
    )
    dispatch_response = client.post(
        workspace_url(workspace_id, "/notifications/outbox/dispatch"),
        headers=csrf_headers(client),
    )
    assert dispatch_response.json()["failed"] == 1

    response = client.post(
        workspace_url(workspace_id, f"/notifications/outbox/{notification_id}/requeue"),
        json={"reason": "Webhook 配置已修复，重新发送"},
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == notification_id
    assert body["status"] == "pending"
    assert body["payload"]["dispatch"]["status"] == "pending"
    assert body["payload"]["dispatch"]["reason"] == "Webhook 配置已修复，重新发送"
    assert body["payload"]["dispatchHistory"][0]["status"] == "failed"
    assert body["payload"]["dispatchHistory"][0]["error"] == "webhook rejected"

    with client.app.state.session_factory() as session:
        record = session.get(NotificationOutboxRecord, notification_id)
        assert record.status == "pending"
        assert record.payload["dispatch"]["status"] == "pending"
        audit_event = session.query(AuditEventRecord).filter_by(
            target_type="notification_outbox",
            target_id=notification_id,
            action="notification_outbox.requeue",
        ).one()
        assert audit_event.before_status == "failed"
        assert audit_event.after_status == "pending"
        assert audit_event.reason == "Webhook 配置已修复，重新发送"
        assert audit_event.payload["eventKey"] == "task-1:escalated"


def test_sent_notification_cannot_be_requeued(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'notification-requeue-sent.db'}",
    )
    notification_id = add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-1:due_soon",
        status="sent",
    )

    response = client.post(
        workspace_url(workspace_id, f"/notifications/outbox/{notification_id}/requeue"),
        json={"reason": "不应重复发送已成功通知"},
        headers=csrf_headers(client),
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "只有发送失败的通知可以重新入队"


def test_cross_workspace_notification_requeue_returns_not_found(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'notification-requeue-cross-workspace.db'}",
    )
    with client.app.state.session_factory() as session:
        other_workspace = WorkspaceRecord(
            organization_id=session.scalar(select(WorkspaceRecord.organization_id)),
            name="其他空间",
            slug="other-workspace",
            status="active",
            created_by="user-1",
        )
        session.add(other_workspace)
        session.commit()
        session.refresh(other_workspace)
        other_workspace_id = other_workspace.id
    notification_id = add_notification(
        client,
        workspace_id=other_workspace_id,
        event_key="other:due_soon",
        status="failed",
    )

    response = client.post(
        workspace_url(workspace_id, f"/notifications/outbox/{notification_id}/requeue"),
        json={"reason": "跨空间不允许"},
        headers=csrf_headers(client),
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "通知不存在"
