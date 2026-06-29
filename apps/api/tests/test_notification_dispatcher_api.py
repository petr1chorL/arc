from datetime import timedelta

from sqlalchemy import select

from api_test_support import FIXED_NOW, create_authenticated_client, csrf_headers, workspace_url
from app.models import AuditEventRecord, NotificationChannelRecord, NotificationOutboxRecord, WorkspaceRecord
from app.notification_dispatcher import NotificationChannelAdapter, NotificationChannelRouter


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


class FailureCodeNotificationDispatcher:
    def __init__(self):
        self.deliveries = []

    def send(self, delivery):
        self.deliveries.append(delivery)
        return {
            "status": "failed",
            "provider_message_id": "",
            "error": "provider timed out",
            "error_code": "provider_timeout",
            "channel": "email",
        }


def add_notification(
    client,
    *,
    workspace_id,
    event_key,
    event_type="due_soon",
    status="pending",
    payload=None,
    created_at=None,
):
    notification_payload = payload or {"message": f"payload for {event_key}"}
    with client.app.state.session_factory() as session:
        record = NotificationOutboxRecord(
            workspace_id=workspace_id,
            event_key=event_key,
            human_task_id=f"task-{event_key}",
            event_type=event_type,
            recipient_type="reviewer",
            recipient_id="reviewer-1",
            payload=notification_payload,
            status=status,
            created_at=created_at or FIXED_NOW,
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return record.id


def test_lists_notification_outbox_for_current_workspace_newest_first(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'notification-outbox-list.db'}",
    )
    older_id = add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-1:older",
        created_at=FIXED_NOW - timedelta(minutes=10),
    )
    newer_id = add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-2:newer",
        created_at=FIXED_NOW,
    )
    with client.app.state.session_factory() as session:
        other_workspace = WorkspaceRecord(
            organization_id=session.scalar(select(WorkspaceRecord.organization_id)),
            name="鍏朵粬绌洪棿",
            slug="other-workspace",
            status="active",
            created_by="user-1",
        )
        session.add(other_workspace)
        session.commit()
        session.refresh(other_workspace)
        other_workspace_id = other_workspace.id
    other_id = add_notification(
        client,
        workspace_id=other_workspace_id,
        event_key="other:newer",
        created_at=FIXED_NOW + timedelta(minutes=10),
    )

    response = client.get(
        workspace_url(workspace_id, "/notifications/outbox"),
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    ids = [item["id"] for item in response.json()]
    assert ids == [newer_id, older_id]
    assert other_id not in ids


def test_filters_notification_outbox_by_status_channel_and_error_code(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'notification-outbox-filters.db'}",
    )
    failed_webhook_id = add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-1:failed-webhook",
        status="failed",
        payload={
            "message": "failed webhook",
            "dispatch": {
                "status": "failed",
                "channel": "webhook",
                "errorCode": "channel_not_configured",
                "error": "channel_not_configured:webhook",
            },
        },
    )
    pending_webhook_id = add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-2:pending-webhook",
        status="pending",
        payload={"message": "pending webhook", "channel": "webhook"},
    )
    add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-3:failed-email",
        status="failed",
        payload={
            "message": "failed email",
            "dispatch": {
                "status": "failed",
                "channel": "email",
                "errorCode": "provider_timeout",
                "error": "provider timed out",
            },
        },
    )

    failed_response = client.get(
        workspace_url(workspace_id, "/notifications/outbox?status=failed"),
        headers=csrf_headers(client),
    )
    channel_response = client.get(
        workspace_url(workspace_id, "/notifications/outbox?channel=webhook"),
        headers=csrf_headers(client),
    )
    error_response = client.get(
        workspace_url(workspace_id, "/notifications/outbox?errorCode=channel_not_configured"),
        headers=csrf_headers(client),
    )

    assert failed_response.status_code == 200
    assert [item["status"] for item in failed_response.json()] == ["failed", "failed"]
    assert channel_response.status_code == 200
    assert {item["id"] for item in channel_response.json()} == {failed_webhook_id, pending_webhook_id}
    assert error_response.status_code == 200
    assert [item["id"] for item in error_response.json()] == [failed_webhook_id]


def test_dispatch_routes_explicit_channel_to_matching_adapter(tmp_path):
    in_app_dispatcher = FakeNotificationDispatcher()
    webhook_dispatcher = FakeNotificationDispatcher()
    router = NotificationChannelRouter([
        NotificationChannelAdapter("in_app", in_app_dispatcher),
        NotificationChannelAdapter("webhook", webhook_dispatcher),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'notification-channel-webhook.db'}",
        notification_dispatcher=router,
    )
    notification_id = add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-1:webhook",
        payload={"message": "send through webhook", "channel": "webhook"},
    )

    response = client.post(
        workspace_url(workspace_id, "/notifications/outbox/dispatch"),
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["sent"] == 1
    assert body["items"][0]["channel"] == "webhook"
    assert [delivery.id for delivery in webhook_dispatcher.deliveries] == [notification_id]
    assert in_app_dispatcher.deliveries == []
    with client.app.state.session_factory() as session:
        record = session.get(NotificationOutboxRecord, notification_id)
        assert record.payload["dispatch"]["channel"] == "webhook"


def test_dispatch_routes_first_channel_from_channels_list(tmp_path):
    email_dispatcher = FakeNotificationDispatcher()
    webhook_dispatcher = FakeNotificationDispatcher()
    router = NotificationChannelRouter([
        NotificationChannelAdapter("email", email_dispatcher),
        NotificationChannelAdapter("webhook", webhook_dispatcher),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'notification-channel-list.db'}",
        notification_dispatcher=router,
    )
    notification_id = add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-1:email",
        payload={"message": "send through email", "channels": ["email", "webhook"]},
    )

    response = client.post(
        workspace_url(workspace_id, "/notifications/outbox/dispatch"),
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    assert response.json()["sent"] == 1
    assert [delivery.id for delivery in email_dispatcher.deliveries] == [notification_id]
    assert webhook_dispatcher.deliveries == []


def test_dispatch_uses_in_app_channel_when_no_channel_declared(tmp_path):
    in_app_dispatcher = FakeNotificationDispatcher()
    router = NotificationChannelRouter([
        NotificationChannelAdapter("in_app", in_app_dispatcher),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'notification-channel-default.db'}",
        notification_dispatcher=router,
    )
    notification_id = add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-1:default",
    )

    response = client.post(
        workspace_url(workspace_id, "/notifications/outbox/dispatch"),
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    assert response.json()["sent"] == 1
    assert [delivery.id for delivery in in_app_dispatcher.deliveries] == [notification_id]


def test_unknown_notification_channel_fails_without_crashing_worker(tmp_path):
    in_app_dispatcher = FakeNotificationDispatcher()
    router = NotificationChannelRouter([
        NotificationChannelAdapter("in_app", in_app_dispatcher),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'notification-channel-unknown.db'}",
        notification_dispatcher=router,
    )
    notification_id = add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-1:unknown",
        payload={"message": "send through unknown channel", "channel": "sms"},
    )

    response = client.post(
        workspace_url(workspace_id, "/notifications/outbox/dispatch"),
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["processed"] == 1
    assert body["failed"] == 1
    assert body["items"][0]["id"] == notification_id
    assert body["items"][0]["channel"] == "sms"
    assert body["items"][0]["errorCode"] == "channel_not_configured"
    assert "channel_not_configured:sms" in body["items"][0]["error"]
    assert in_app_dispatcher.deliveries == []

    with client.app.state.session_factory() as session:
        record = session.get(NotificationOutboxRecord, notification_id)
        assert record.status == "failed"
        assert record.payload["dispatch"]["channel"] == "sms"
        assert record.payload["dispatch"]["errorCode"] == "channel_not_configured"
        assert "channel_not_configured:sms" in record.payload["dispatch"]["error"]


def test_disabled_notification_channel_fails_without_calling_adapter(tmp_path):
    email_dispatcher = FakeNotificationDispatcher()
    router = NotificationChannelRouter([
        NotificationChannelAdapter("email", email_dispatcher, enabled=False),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'notification-channel-disabled.db'}",
        notification_dispatcher=router,
    )
    notification_id = add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-1:disabled",
        payload={"message": "send through disabled channel", "channel": "email"},
    )

    response = client.post(
        workspace_url(workspace_id, "/notifications/outbox/dispatch"),
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["processed"] == 1
    assert body["failed"] == 1
    assert body["items"][0]["id"] == notification_id
    assert body["items"][0]["channel"] == "email"
    assert body["items"][0]["errorCode"] == "channel_disabled"
    assert "channel_disabled:email" in body["items"][0]["error"]
    assert email_dispatcher.deliveries == []


def test_default_dispatch_requires_non_default_channel_asset(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'notification-channel-asset-missing.db'}",
    )
    notification_id = add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-1:webhook-missing-asset",
        payload={"message": "send through webhook", "channel": "webhook"},
    )

    response = client.post(
        workspace_url(workspace_id, "/notifications/outbox/dispatch"),
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["processed"] == 1
    assert body["failed"] == 1
    assert body["items"][0]["id"] == notification_id
    assert body["items"][0]["channel"] == "webhook"
    assert body["items"][0]["errorCode"] == "notification_channel_missing"
    assert "notification_channel_missing:webhook" in body["items"][0]["error"]
    with client.app.state.session_factory() as session:
        record = session.get(NotificationOutboxRecord, notification_id)
        assert record.status == "failed"
        assert record.payload["dispatch"]["errorCode"] == "notification_channel_missing"


def test_default_dispatch_fails_when_channel_asset_is_disabled(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'notification-channel-asset-disabled.db'}",
    )
    with client.app.state.session_factory() as session:
        session.add(NotificationChannelRecord(
            workspace_id=workspace_id,
            name="Webhook 告警",
            channel_type="webhook",
            status="disabled",
            config={"urlRef": "WEBHOOK_URL"},
            secret_ref="WEBHOOK_SECRET",
            created_by="user-1",
        ))
        session.commit()
    notification_id = add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-1:webhook-disabled-asset",
        payload={"message": "send through webhook", "channel": "webhook"},
    )

    response = client.post(
        workspace_url(workspace_id, "/notifications/outbox/dispatch"),
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["failed"] == 1
    assert body["items"][0]["id"] == notification_id
    assert body["items"][0]["channel"] == "webhook"
    assert body["items"][0]["errorCode"] == "notification_channel_disabled"
    assert "notification_channel_disabled:webhook" in body["items"][0]["error"]
    with client.app.state.session_factory() as session:
        record = session.get(NotificationOutboxRecord, notification_id)
        assert record.payload["dispatch"]["errorCode"] == "notification_channel_disabled"


def test_default_dispatch_reports_adapter_missing_when_active_asset_has_no_adapter(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'notification-channel-active-no-adapter.db'}",
    )
    with client.app.state.session_factory() as session:
        session.add(NotificationChannelRecord(
            workspace_id=workspace_id,
            name="Webhook 告警",
            channel_type="webhook",
            status="active",
            config={"urlRef": "WEBHOOK_URL"},
            secret_ref="WEBHOOK_SECRET",
            created_by="user-1",
        ))
        session.commit()
    notification_id = add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-1:webhook-active-no-adapter",
        payload={"message": "send through webhook", "channel": "webhook"},
    )

    response = client.post(
        workspace_url(workspace_id, "/notifications/outbox/dispatch"),
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["failed"] == 1
    assert body["items"][0]["id"] == notification_id
    assert body["items"][0]["channel"] == "webhook"
    assert body["items"][0]["errorCode"] == "channel_not_configured"
    assert "channel_not_configured:webhook" in body["items"][0]["error"]


def test_dict_dispatch_result_error_code_is_normalized(tmp_path):
    email_dispatcher = FailureCodeNotificationDispatcher()
    router = NotificationChannelRouter([
        NotificationChannelAdapter("email", email_dispatcher),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'notification-dispatch-error-code.db'}",
        notification_dispatcher=router,
    )
    notification_id = add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-1:provider-timeout",
        payload={"message": "send through email", "channel": "email"},
    )

    response = client.post(
        workspace_url(workspace_id, "/notifications/outbox/dispatch"),
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["failed"] == 1
    assert body["items"][0]["id"] == notification_id
    assert body["items"][0]["channel"] == "email"
    assert body["items"][0]["errorCode"] == "provider_timeout"

    with client.app.state.session_factory() as session:
        record = session.get(NotificationOutboxRecord, notification_id)
        assert record.status == "failed"
        assert record.payload["dispatch"]["channel"] == "email"
        assert record.payload["dispatch"]["errorCode"] == "provider_timeout"


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


def test_creates_and_lists_notification_channels_for_current_workspace(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'notification-channels.db'}",
    )
    with client.app.state.session_factory() as session:
        other_workspace = WorkspaceRecord(
            organization_id=session.scalar(select(WorkspaceRecord.organization_id)),
            name="其他空间",
            slug="other-notification-space",
            status="active",
            created_by="user-1",
        )
        session.add(other_workspace)
        session.commit()
        session.refresh(other_workspace)

    first_response = client.post(
        workspace_url(workspace_id, "/notification-channels"),
        json={
            "name": "站内通知",
            "channelType": "in_app",
            "config": {"mode": "noop"},
            "secretRef": "",
        },
        headers=csrf_headers(client),
    )
    second_response = client.post(
        workspace_url(workspace_id, "/notification-channels"),
        json={
            "name": "Webhook 告警",
            "channelType": "webhook",
            "config": {"urlRef": "WEBHOOK_URL"},
            "secretRef": "WEBHOOK_SECRET",
        },
        headers=csrf_headers(client),
    )
    with client.app.state.session_factory() as session:
        session.add(NotificationChannelRecord(
            workspace_id=other_workspace.id,
            name="其他空间渠道",
            channel_type="email",
            status="active",
            config={"from": "ops@example.com"},
            secret_ref="SMTP_PASSWORD",
            created_by="user-1",
            created_at=FIXED_NOW + timedelta(minutes=1),
            updated_at=FIXED_NOW + timedelta(minutes=1),
        ))
        session.commit()

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    body = second_response.json()
    assert body["workspaceId"] == workspace_id
    assert body["name"] == "Webhook 告警"
    assert body["channelType"] == "webhook"
    assert body["status"] == "active"
    assert body["config"] == {"urlRef": "WEBHOOK_URL"}
    assert body["secretRef"] == "WEBHOOK_SECRET"
    assert body["createdAt"]
    assert body["updatedAt"]

    list_response = client.get(
        workspace_url(workspace_id, "/notification-channels"),
        headers=csrf_headers(client),
    )

    assert list_response.status_code == 200
    channels = list_response.json()
    assert [channel["id"] for channel in channels] == [
        second_response.json()["id"],
        first_response.json()["id"],
    ]
    assert {channel["name"] for channel in channels} == {"站内通知", "Webhook 告警"}


def test_notification_channel_create_rejects_duplicate_name_and_non_object_config(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'notification-channel-guards.db'}",
    )
    create_response = client.post(
        workspace_url(workspace_id, "/notification-channels"),
        json={
            "name": "Webhook 告警",
            "channelType": "webhook",
            "config": {"urlRef": "WEBHOOK_URL"},
            "secretRef": "WEBHOOK_SECRET",
        },
        headers=csrf_headers(client),
    )
    duplicate_response = client.post(
        workspace_url(workspace_id, "/notification-channels"),
        json={
            "name": "Webhook 告警",
            "channelType": "webhook",
            "config": {"urlRef": "OTHER_WEBHOOK_URL"},
            "secretRef": "OTHER_WEBHOOK_SECRET",
        },
        headers=csrf_headers(client),
    )
    invalid_config_response = client.post(
        workspace_url(workspace_id, "/notification-channels"),
        json={
            "name": "数组配置",
            "channelType": "webhook",
            "config": ["not", "an", "object"],
            "secretRef": "WEBHOOK_SECRET",
        },
        headers=csrf_headers(client),
    )

    assert create_response.status_code == 200
    assert duplicate_response.status_code == 409
    assert duplicate_response.json()["detail"] == "通知渠道名称已存在"
    assert invalid_config_response.status_code == 422


def test_disables_notification_channel_and_records_audit_event(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'notification-channel-disable.db'}",
    )
    create_response = client.post(
        workspace_url(workspace_id, "/notification-channels"),
        json={
            "name": "Webhook 告警",
            "channelType": "webhook",
            "config": {"urlRef": "WEBHOOK_URL"},
            "secretRef": "WEBHOOK_SECRET",
        },
        headers=csrf_headers(client),
    )
    channel_id = create_response.json()["id"]

    response = client.post(
        workspace_url(workspace_id, f"/notification-channels/{channel_id}/disable"),
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == channel_id
    assert body["status"] == "disabled"
    with client.app.state.session_factory() as session:
        audit_event = session.query(AuditEventRecord).filter_by(
            target_type="notification_channel",
            target_id=channel_id,
            action="notification_channel.disable",
        ).one()
        assert audit_event.before_status == "active"
        assert audit_event.after_status == "disabled"
        assert audit_event.payload["name"] == "Webhook 告警"
        assert audit_event.payload["channelType"] == "webhook"


def test_cross_workspace_notification_channel_disable_returns_not_found(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'notification-channel-cross-workspace.db'}",
    )
    with client.app.state.session_factory() as session:
        other_workspace = WorkspaceRecord(
            organization_id=session.scalar(select(WorkspaceRecord.organization_id)),
            name="其他空间",
            slug="other-notification-disable",
            status="active",
            created_by="user-1",
        )
        session.add(other_workspace)
        session.commit()
        session.refresh(other_workspace)
    with client.app.state.session_factory() as session:
        record = NotificationChannelRecord(
            workspace_id=other_workspace.id,
            name="其他空间渠道",
            channel_type="webhook",
            status="active",
            config={"urlRef": "OTHER_WEBHOOK_URL"},
            secret_ref="OTHER_WEBHOOK_SECRET",
            created_by="user-1",
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        channel_id = record.id

    response = client.post(
        workspace_url(workspace_id, f"/notification-channels/{channel_id}/disable"),
        headers=csrf_headers(client),
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "通知渠道不存在"
