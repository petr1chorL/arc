from collections.abc import Callable, Iterable
import argparse
from threading import Event
from time import sleep

from sqlalchemy.orm import Session, sessionmaker

from app.execution import ExecutionService
from app.model_gateway import ModelGateway
from app.models import WorkspaceRecord


class ExecutionQueueWorker:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        execution_service: ExecutionService,
        workspace_ids: Iterable[str],
        worker_id: str = "execution-worker",
        poll_interval_seconds: float = 2.0,
        sleeper: Callable[[float], None] = sleep,
    ):
        self.session_factory = session_factory
        self.execution_service = execution_service
        self.workspace_ids = list(workspace_ids)
        self.worker_id = worker_id
        self.poll_interval_seconds = poll_interval_seconds
        self.sleeper = sleeper

    def process_once(self) -> int:
        processed = 0
        for workspace_id in self.workspace_ids:
            with self.session_factory() as session:
                run = self.execution_service.process_next_execution_job(
                    session=session,
                    workspace_id=workspace_id,
                    worker_id=self.worker_id,
                )
                if run is not None:
                    processed += 1
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


def create_execution_queue_worker(
    *,
    database_url: str | None = None,
    worker_id: str = "execution-worker",
    poll_interval_seconds: float = 2.0,
    model_gateway: ModelGateway | None = None,
) -> ExecutionQueueWorker:
    from app.main import create_app

    app = create_app(database_url, model_gateway=model_gateway)
    session_factory = app.state.session_factory
    with session_factory() as session:
        workspace_ids = list(
            session.scalars(
                WorkspaceRecord.__table__.select()
                .with_only_columns(WorkspaceRecord.__table__.c.id)
                .where(WorkspaceRecord.__table__.c.status == "active"),
            ),
        )
    return ExecutionQueueWorker(
        session_factory=session_factory,
        execution_service=app.state.execution_service,
        workspace_ids=workspace_ids,
        worker_id=worker_id,
        poll_interval_seconds=poll_interval_seconds,
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Run ARC.ONE execution queue worker.")
    parser.add_argument("--database-url", default=None)
    parser.add_argument("--worker-id", default="execution-worker")
    parser.add_argument("--poll-interval", type=float, default=2.0)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--until-idle", action="store_true")
    args = parser.parse_args(argv)
    worker = create_execution_queue_worker(
        database_url=args.database_url,
        worker_id=args.worker_id,
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
