from __future__ import annotations

import logging
from queue import Queue
from threading import Event, Lock, Thread
from typing import Callable

logger = logging.getLogger("twin_core.workers")


class SerialWorker:
    def __init__(self, name: str, handler: Callable[[str], None]) -> None:
        self.name = name
        self._handler = handler
        self._queue: Queue[str | None] = Queue()
        self._stop = Event()
        self._pending: set[str] = set()
        self._pending_lock = Lock()
        self._thread: Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = Thread(target=self._run, name=self.name, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if not self._thread:
            return
        self._stop.set()
        self._queue.put(None)
        self._thread.join(timeout=2.0)

    def enqueue(self, item_id: str) -> bool:
        with self._pending_lock:
            if item_id in self._pending:
                return False
            self._pending.add(item_id)
        self._queue.put(item_id)
        return True

    def _run(self) -> None:
        while not self._stop.is_set():
            item_id = self._queue.get()
            if item_id is None:
                self._queue.task_done()
                break
            try:
                self._handler(item_id)
            except Exception:
                logger.exception("worker_item_failed worker=%s item_id=%s", self.name, item_id)
            finally:
                with self._pending_lock:
                    self._pending.discard(item_id)
                self._queue.task_done()


class WorkerManager:
    def __init__(
        self,
        *,
        enqueue_runs_for_recovery: Callable[[set[str]], list[str]],
        enqueue_playbooks_for_recovery: Callable[[], list[str]],
        run_handler: Callable[[str], None],
        playbook_handler: Callable[[str], None],
    ) -> None:
        self.run_worker = SerialWorker("run-worker", run_handler)
        self.playbook_worker = SerialWorker("playbook-worker", playbook_handler)
        self._recover_runs = enqueue_runs_for_recovery
        self._recover_playbooks = enqueue_playbooks_for_recovery

    def start(self) -> None:
        self.run_worker.start()
        self.playbook_worker.start()

    def stop(self) -> None:
        self.playbook_worker.stop()
        self.run_worker.stop()

    def enqueue_run(self, run_id: str) -> bool:
        return self.run_worker.enqueue(run_id)

    def enqueue_playbook(self, job_id: str) -> bool:
        return self.playbook_worker.enqueue(job_id)

    def recover_pending(self) -> None:
        recovered_job_ids = set(self._recover_playbooks())
        for run_id in self._recover_runs(recovered_job_ids):
            self.enqueue_run(run_id)
        for job_id in recovered_job_ids:
            self.enqueue_playbook(job_id)
