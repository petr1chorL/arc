from api_test_support import create_authenticated_client
from app.models import NotificationOutboxRecord
from app.notification_dispatcher import NotificationOutboxDispatchService
from app.notification_worker import (
    NotificationOutboxWorker,
    create_notification_outbox_worker,
    main,
)
from test_notification_dispatcher_api import FakeNotificationDispatcher, add_notification


def test_notification_outbox_worker_processes_pending_notifications(tmp_path):
    dispatcher = FakeNotificationDispatcher()
    database_url = f"sqlite:///{tmp_path / 'notification-worker.db'}"
    client, workspace_id = create_authenticated_client(
        database_url,
        notification_dispatcher=dispatcher,
    )
    notification_id = add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-1:due_soon",
    )
    worker = NotificationOutboxWorker(
        session_factory=client.app.state.session_factory,
        dispatch_service=NotificationOutboxDispatchService(dispatcher),
        workspace_ids=[workspace_id],
    )

    assert worker.process_once() == 1
    assert worker.process_until_idle(max_cycles=3) == 0

    with client.app.state.session_factory() as session:
        record = session.get(NotificationOutboxRecord, notification_id)
        assert record.status == "sent"
        assert record.payload["dispatch"]["providerMessageId"] == f"fake-{notification_id}"


def test_notification_outbox_worker_factory_builds_worker_from_database_url(tmp_path):
    dispatcher = FakeNotificationDispatcher()
    database_url = f"sqlite:///{tmp_path / 'notification-worker-factory.db'}"
    client, workspace_id = create_authenticated_client(
        database_url,
        notification_dispatcher=dispatcher,
    )
    notification_id = add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-1:due_soon",
    )

    worker = create_notification_outbox_worker(
        database_url=database_url,
        notification_dispatcher=dispatcher,
    )

    assert worker.process_once() == 1
    with client.app.state.session_factory() as session:
        record = session.get(NotificationOutboxRecord, notification_id)
        assert record.status == "sent"


def test_notification_worker_main_once_processes_and_prints_summary(tmp_path, capsys):
    database_url = f"sqlite:///{tmp_path / 'notification-worker-main.db'}"
    client, workspace_id = create_authenticated_client(database_url)
    notification_id = add_notification(
        client,
        workspace_id=workspace_id,
        event_key="task-1:due_soon",
    )

    main(["--database-url", database_url, "--once"])

    assert capsys.readouterr().out.strip() == "processed=1"
    with client.app.state.session_factory() as session:
        record = session.get(NotificationOutboxRecord, notification_id)
        assert record.status == "sent"
        assert record.payload["dispatch"]["providerMessageId"] == f"noop-{notification_id}"
