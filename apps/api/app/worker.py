from collections.abc import Callable, Iterable
from threading import Event
from time import sleep

from sqlalchemy.orm import Session, sessionmaker

from app.execution import ExecutionService


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
