"""
refresh_engine.py
─────────────────

Background-job runner for /api/refresh. Lets the HTTP request return in <50 ms
with a {job_id}, while the actual heavy work runs in a daemon thread. The
frontend then polls /api/refresh/status/{job_id} for progress.

WHY THIS EXISTS
───────────────
Even after parallelizing market_data.refresh_all (1.5–3 min → 10–20 s for
32 tickers), having the HTTP request block for 10–20 s is a bad UX:
  • The user can't see anything until it finishes.
  • Any browser timeout (default ~30 s on uvicorn) is a hard cliff.
  • You can't show per-ticker progress.

This module decouples submission from completion. The browser:
  1. POSTs /api/refresh                   → gets {job_id} in ~5 ms
  2. Immediately re-renders cached cards from /api/dashboard
  3. Polls /api/refresh/status/{job_id}   → shows live progress
  4. When status="complete", re-fetches /api/dashboard to pick up new scores

DESIGN
──────
• Single global RefreshManager (process-local; perfect for a local-first app).
• At most ONE refresh job runs at a time. A second POST returns the existing
  job_id — refreshes are idempotent.
• Jobs are kept in memory only. After 1 hour they're auto-evicted.
• Thread-safe: state mutations go through a Lock.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from .market_data import refresh_all

log = logging.getLogger("ktrade.refresh.engine")


# ── Per-job state ─────────────────────────────────────────────────────────────

class RefreshJob:
    """Lightweight value object holding live state for one refresh run."""

    def __init__(self, job_id: str):
        self.job_id:        str       = job_id
        self.status:        str       = "pending"        # pending | running | complete | failed
        self.phase:         str       = "queued"          # queued | bootstrap | ticker | complete
        self.started_at:    str       = _now_iso()
        self.finished_at:   Optional[str] = None
        self.total:         int       = 0
        self.completed:     int       = 0
        self.failed:        int       = 0
        self.current:       Optional[str] = None
        self.recent:        list[str] = []                 # last 8 tickers processed (for UI ticker)
        self.errors:        list[dict] = []
        self.duration_s:    Optional[float] = None
        self.result_summary: dict = {}

    def to_dict(self) -> dict:
        return {
            "jobId":          self.job_id,
            "status":         self.status,
            "phase":          self.phase,
            "startedAt":      self.started_at,
            "finishedAt":     self.finished_at,
            "total":          self.total,
            "completed":      self.completed,
            "failed":         self.failed,
            "current":        self.current,
            "recent":         self.recent,
            "errors":         self.errors[:20],     # cap response size
            "durationSeconds": self.duration_s,
            "resultSummary":   self.result_summary,
        }


# ── Manager ───────────────────────────────────────────────────────────────────

class RefreshManager:
    """Process-wide registry of refresh jobs."""

    JOB_TTL_SECONDS = 3600   # auto-evict completed jobs after 1 hour

    def __init__(self):
        self._jobs:      dict[str, RefreshJob] = {}
        self._lock:      threading.RLock        = threading.RLock()
        self._active_id: Optional[str]          = None

    # ── Public API ────────────────────────────────────────────────────────────

    def start(self) -> str:
        """
        Start a new refresh job (or return the existing one if a refresh is
        already in flight). Returns the job_id immediately.
        """
        with self._lock:
            self._evict_old()
            # If a job is currently running, return that one — refreshes coalesce.
            if self._active_id and self._jobs.get(self._active_id, RefreshJob("?")).status in ("pending", "running"):
                return self._active_id

            job = RefreshJob(uuid.uuid4().hex[:12])
            self._jobs[job.job_id] = job
            self._active_id = job.job_id

        # Fire off worker thread *outside* the lock.
        threading.Thread(target=self._run, args=(job.job_id,), daemon=True, name=f"refresh-{job.job_id}").start()
        return job.job_id

    def status(self, job_id: str) -> Optional[dict]:
        with self._lock:
            job = self._jobs.get(job_id)
            return job.to_dict() if job else None

    def latest(self) -> Optional[dict]:
        """Convenience: return whichever job ran most recently."""
        with self._lock:
            if not self._jobs:
                return None
            # Latest by started_at lexicographically (ISO timestamps sort correctly)
            latest = max(self._jobs.values(), key=lambda j: j.started_at)
            return latest.to_dict()

    # ── Internal ──────────────────────────────────────────────────────────────

    def _run(self, job_id: str) -> None:
        """Worker entry point. Catches everything so threads never crash silently."""
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job.status = "running"

        started = time.time()
        try:
            result = refresh_all(progress_callback=lambda state: self._on_progress(job_id, state),
                                 do_news=True, background_news=True)
            with self._lock:
                job = self._jobs[job_id]
                job.status = "complete"
                job.phase = "complete"
                job.finished_at = _now_iso()
                job.duration_s = round(time.time() - started, 2)
                job.result_summary = {
                    "refreshedCount":  len(result.get("refreshed", [])),
                    "failedCount":     len(result.get("failed", [])),
                    "snapshotsSaved":  result.get("snapshots_saved", 0),
                    "marketLabel":     (result.get("market") or {}).get("label", ""),
                    "durationSeconds": result.get("duration_seconds"),
                }
        except Exception as exc:
            log.exception(f"refresh job {job_id} crashed")
            with self._lock:
                job = self._jobs.get(job_id)
                if job:
                    job.status = "failed"
                    job.phase = "complete"
                    job.finished_at = _now_iso()
                    job.duration_s = round(time.time() - started, 2)
                    job.errors.append({"symbol": "", "reason": f"Crash: {exc}"})
        finally:
            with self._lock:
                # Clear active pointer so the next /api/refresh can start a new run.
                if self._active_id == job_id:
                    self._active_id = None

    def _on_progress(self, job_id: str, state: dict) -> None:
        """Called from refresh_all worker threads — must be thread-safe."""
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            phase = state.get("phase")
            if phase:
                job.phase = phase
            if state.get("total"):
                job.total = state["total"]
            if state.get("completed") is not None:
                job.completed = state["completed"]
            current = state.get("current")
            if current:
                job.current = current
                # Keep a small rolling window for the UI to show recent tickers
                job.recent.append(current)
                job.recent = job.recent[-8:]
            if state.get("ok") is False:
                job.failed += 1
                job.errors.append({"symbol": current or "", "reason": state.get("reason") or ""})

    def _evict_old(self) -> None:
        """Drop completed jobs older than TTL so memory doesn't grow forever."""
        now = time.time()
        to_drop = []
        for jid, job in self._jobs.items():
            if job.status in ("complete", "failed") and job.finished_at:
                try:
                    finished = datetime.fromisoformat(job.finished_at.replace("Z", "+00:00")).timestamp()
                    if now - finished > self.JOB_TTL_SECONDS:
                        to_drop.append(jid)
                except Exception:
                    pass
        for jid in to_drop:
            self._jobs.pop(jid, None)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Module-level singleton ────────────────────────────────────────────────────

manager = RefreshManager()
