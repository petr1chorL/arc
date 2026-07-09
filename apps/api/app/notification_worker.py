from collections.abc import Callable, Iterable
import argparse
from threading import Event
from time import sleep

from sqlalchemy.orm import Session, sessionmaker

from app.models import WorkspaceRecord
from app.notification_dispatcher import NotificationDispatcher, NotificationOutboxDispatchService


class NotificationOutboxWorker:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        dispatch_service: NotificationOutboxDispatchService,
        workspace_ids: Iterable[str],
        poll_interval_seconds: float = 2.0,
        sleeper: Callable[[float], None] = sleep,
    ):
        self.session_factory = session_factory
        self.dispatch_service = dispatch_service
        self.workspace_ids = list(workspace_ids)
        self.poll_interval_seconds = poll_interval_seconds
        self.sleeper = sleeper

    def process_once(self) -> int:
        processed = 0
        for workspace_id in self.workspace_ids:
            with self.session_factory() as session:
                summary = self.dispatch_service.dispatch_pending(
                    session,
                    workspace_id=workspace_id,
                )
                session.commit()
                processed += summary["processed"]
        return processed

    def process_until_idle(self, *, max_cycles: int = 100) -> int:
        total_processed = 0
        for _ in range(max_cycles):
            processed = self.process_once()
            total_processed += processed
            if processed == 0:
                break
        return total_processed

    def run_forever(self, *, stop_event: Event | None = None) -> None:
        stop = stop_event or Event()
        while not stop.is_set():
            processed = self.process_once()
            if processed == 0:
                self.sleeper(self.poll_interval_seconds)


def create_notification_outbox_worker(
    *,
    database_url: str | None = None,
    poll_interval_seconds: float = 2.0,
    notification_dispatcher: NotificationDispatcher | None = None,
) -> NotificationOutboxWorker:
    from app.main import create_app

    app = create_app(database_url, notification_dispatcher=notification_dispatcher)
    session_factory = app.state.session_factory
    with session_factory() as session:
        workspace_ids = list(
            session.scalars(
                WorkspaceRecord.__table__.select()
                .with_only_columns(WorkspaceRecord.__table__.c.id)
                .where(WorkspaceRecord.__table__.c.status == "active"),
            ),
        )
    return NotificationOutboxWorker(
        session_factory=session_factory,
        dispatch_service=app.state.notification_dispatch_service,
        workspace_ids=workspace_ids,
        poll_interval_seconds=poll_interval_seconds,
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Run ARC.ONE notification outbox worker.")
    parser.add_argument("--database-url", default=None)
    parser.add_argument("--poll-interval", type=float, default=2.0)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--until-idle", action="store_true")
    args = parser.parse_args(argv)
    worker = create_notification_outbox_worker(
        database_url=args.database_url,
        poll_interval_seconds=args.poll_interval,
    )
    if args.once:
        processed = worker.process_once()
        print(f"processed={processed}")
        return
    if args.until_idle:
        processed = worker.process_until_idle()
        print(f"processed={processed}")
        return
    worker.run_forever()


if __name__ == "__main__":
    main()
