"""In-memory job manager with a bounded asyncio download queue."""
from __future__ import annotations

import asyncio
import itertools
import shutil
import threading
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import config, db, engine

_rev = itertools.count(1)
TERMINAL = {"completed", "failed", "cancelled"}


def next_rev() -> int:
    return next(_rev)


@dataclass
class Item:
    id: str
    url: str
    title: str | None = None
    thumbnail: str | None = None
    duration: float | None = None
    quality: str = "best"
    output: str = "mp4"
    status: str = "queued"  # queued|downloading|processing|completed|failed|cancelled
    phase: str | None = None
    downloaded: float = 0
    total: float | None = None
    speed: float | None = None
    eta: float | None = None
    error: str | None = None
    filename: str | None = None
    filepath: str | None = None
    filesize: int | None = None
    resolution: str | None = None
    attempts: int = 0
    started_at: float | None = None
    finished_at: float | None = None
    rev: int = field(default_factory=next_rev)
    cancel: threading.Event = field(default_factory=threading.Event, repr=False)

    def touch(self) -> None:
        self.rev = next_rev()

    @property
    def progress(self) -> float:
        if self.status == "completed":
            return 100.0
        if self.total:
            return max(0.0, min(99.9, self.downloaded / self.total * 100))
        return 0.0

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id, "url": self.url, "title": self.title, "thumbnail": self.thumbnail,
            "duration": self.duration, "quality": self.quality, "output": self.output,
            "status": self.status, "phase": self.phase,
            "progress": round(self.progress, 1), "downloaded": self.downloaded, "total": self.total,
            "speed": self.speed, "eta": self.eta, "error": self.error, "filename": self.filename,
            "filesize": self.filesize, "resolution": self.resolution, "attempts": self.attempts,
            "rev": self.rev,
        }


@dataclass
class Job:
    id: str
    quality: str
    output: str
    concurrency: int
    items: dict[str, Item]
    created_at: float = field(default_factory=time.time)
    task: asyncio.Task | None = field(default=None, repr=False)
    zip_cache: tuple[int, str] | None = None  # (fingerprint, path)

    @property
    def dir(self) -> Path:
        return config.DOWNLOAD_DIR / self.id

    def stats(self) -> dict[str, Any]:
        items = list(self.items.values())
        c = {s: 0 for s in ("queued", "downloading", "processing", "completed", "failed", "cancelled")}
        for it in items:
            c[it.status] += 1
        active = [it for it in items if it.status in ("downloading", "processing")]
        speed = sum(it.speed or 0 for it in active)
        # Overall progress: finished items count as 100%, active ones by their own percentage.
        n = len(items) or 1
        overall = sum(100 if it.status in TERMINAL else it.progress for it in items) / n
        remaining = [it for it in items if it.status in ("queued", "downloading", "processing")]
        eta = None
        if speed > 0 and remaining and all(it.total or it.status == "queued" for it in remaining):
            left = sum((it.total or 0) - it.downloaded for it in remaining if it.status != "queued")
            done = [it.filesize for it in items if it.status == "completed" and it.filesize]
            avg = (sum(done) / len(done)) if done else None
            queued = sum(1 for it in remaining if it.status == "queued")
            if queued == 0 or avg:
                eta = (left + queued * (avg or 0)) / speed
        return {
            "total": len(items), **c, "active": len(active), "speed": speed or None,
            "eta": eta, "overall_progress": round(overall, 1),
            "running": self.running,
        }

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    def snapshot(self, since_rev: int = 0) -> dict[str, Any]:
        items = [it.public() for it in self.items.values() if it.rev > since_rev]
        return {
            "job_id": self.id, "quality": self.quality, "output": self.output,
            "concurrency": self.concurrency, "created_at": self.created_at,
            "stats": self.stats(), "items": items,
            "rev": max((it.rev for it in self.items.values()), default=0),
        }


class JobManager:
    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}
        self.global_sem = asyncio.Semaphore(config.GLOBAL_MAX_DOWNLOADS)

    def create(self, entries: list[dict[str, Any]], quality: str, output: str, concurrency: int) -> Job:
        job_id = uuid.uuid4().hex[:12]
        job = Job(job_id, quality, output, max(1, min(config.MAX_CONCURRENCY, concurrency)), {})
        job.dir.mkdir(parents=True, exist_ok=True)
        self.jobs[job_id] = job
        self.add_items(job, entries, quality, output)
        return job

    def add_items(self, job: Job, entries: list[dict[str, Any]], quality: str, output: str) -> list[Item]:
        """Append videos to a job. A URL already queued/active in this job is not added twice."""
        active = {it.url for it in job.items.values() if it.status not in TERMINAL}
        if len(job.items) + len(entries) > config.MAX_URLS_PER_REQUEST * 4:
            raise ValueError("Job is too large — clear completed videos or start a new session")
        added = []
        for e in entries:
            if e["url"] in active:
                continue
            active.add(e["url"])
            iid = uuid.uuid4().hex[:10]
            it = Item(id=iid, url=e["url"], title=e.get("title"), thumbnail=e.get("thumbnail"),
                      duration=e.get("duration"), quality=quality, output=output)
            job.items[iid] = it
            self._record(job, it)
            added.append(it)
        if added:
            self.start(job)
        return added

    def get(self, job_id: str) -> Job | None:
        return self.jobs.get(job_id)

    def start(self, job: Job) -> None:
        if not job.running:
            job.task = asyncio.create_task(self._run(job))

    async def _run(self, job: Job) -> None:
        claimed: set[str] = set()

        def next_item() -> Item | None:
            for it in job.items.values():
                if it.status == "queued" and it.id not in claimed:
                    claimed.add(it.id)
                    return it
            return None

        async def worker() -> None:
            # A fixed pool of `concurrency` workers pulls from the queue: never more in flight.
            while (it := next_item()) is not None:
                try:
                    async with self.global_sem:
                        if it.status == "queued":  # may have been cancelled while waiting
                            await self._download(job, it)
                finally:
                    claimed.discard(it.id)

        while any(it.status == "queued" for it in job.items.values()):
            await asyncio.gather(*(worker() for _ in range(job.concurrency)))
            # Loop again in case items were re-queued (retry) as the workers wound down.

    async def _download(self, job: Job, it: Item) -> None:
        it.status, it.phase, it.error = "downloading", "starting", None
        it.downloaded, it.total, it.speed, it.eta = 0, None, None, None
        it.attempts += 1
        it.started_at = time.time()
        it.cancel.clear()
        it.touch()

        def on_progress(p: dict[str, Any]) -> None:
            if p.get("phase") == "processing":
                it.status, it.phase, it.speed, it.eta = "processing", "processing", None, None
            else:
                it.phase = "downloading"
                it.downloaded = p.get("downloaded") or 0
                it.total = p.get("total")
                it.speed = p.get("speed")
                it.eta = p.get("eta")
            it.touch()

        try:
            res = await asyncio.to_thread(engine.download, it.url, it.id, job.dir, it.quality,
                                          it.output, it.cancel, on_progress)
        except engine.Cancelled:
            it.status, it.error = "cancelled", None
        except engine.EngineError as e:
            it.status, it.error = "failed", str(e)
        except Exception as e:  # noqa: BLE001
            it.status, it.error = "failed", engine.friendly_error(e)
        else:
            it.status = "completed"
            it.filepath, it.filename, it.filesize = res["filepath"], res["filename"], res["filesize"]
            it.resolution = res["resolution"]
            it.title = it.title or res["title"]
            it.thumbnail = it.thumbnail or res["thumbnail"]
            it.downloaded = it.total = res["filesize"]
            job.zip_cache = None
        it.phase, it.speed, it.eta = None, None, None
        it.finished_at = time.time()
        it.touch()
        await asyncio.to_thread(self._record, job, it)

    def cancel(self, job: Job, item_ids: list[str] | None) -> int:
        n = 0
        for it in job.items.values():
            if item_ids and it.id not in item_ids:
                continue
            if it.status == "queued":
                it.status = "cancelled"
                it.finished_at = time.time()
                it.touch()
                self._record(job, it)
                n += 1
            elif it.status in ("downloading", "processing"):
                it.cancel.set()
                n += 1
        return n

    def retry(self, job: Job, item_ids: list[str] | None) -> int:
        n = 0
        for it in job.items.values():
            if item_ids and it.id not in item_ids:
                continue
            if it.status in ("failed", "cancelled"):
                it.status, it.error, it.downloaded, it.total = "queued", None, 0, None
                it.touch()
                n += 1
        if n:
            self.start(job)
        return n

    def remove_items(self, job: Job, item_ids: list[str]) -> int:
        n = 0
        for iid in item_ids:
            it = job.items.get(iid)
            if it and it.status in TERMINAL:
                del job.items[iid]
                n += 1
        return n

    def build_zip(self, job: Job) -> Path:
        done = [it for it in job.items.values() if it.status == "completed" and it.filepath
                and Path(it.filepath).exists()]
        if not done:
            raise FileNotFoundError("No completed videos to package")
        fp = hash(tuple(sorted(it.id for it in done)))
        if job.zip_cache and job.zip_cache[0] == fp and Path(job.zip_cache[1]).exists():
            return Path(job.zip_cache[1])
        out = job.dir / f"fb_videos_{job.id}.zip"
        tmp = out.with_suffix(".zip.part")
        names: set[str] = set()
        # Videos are already compressed: store them (fast, no CPU burn).
        with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
            for it in done:
                name = it.filename or Path(it.filepath).name
                base, i = name, 1
                while name in names:
                    stem, _, ext = base.rpartition(".")
                    name = f"{stem} ({i}).{ext}"
                    i += 1
                names.add(name)
                zf.write(it.filepath, arcname=name)
        tmp.replace(out)
        job.zip_cache = (fp, str(out))
        return out

    def _record(self, job: Job, it: Item) -> None:
        db.upsert({
            "item_id": it.id, "job_id": job.id, "url": it.url, "title": it.title,
            "thumbnail": it.thumbnail, "status": it.status, "quality": it.quality,
            "resolution": it.resolution, "filesize": it.filesize, "filename": it.filename,
            "error": it.error, "created_at": job.created_at, "finished_at": it.finished_at,
        })

    async def cleanup_loop(self) -> None:
        while True:
            await asyncio.sleep(600)
            cutoff = time.time() - config.JOB_TTL_SECONDS
            for jid, job in list(self.jobs.items()):
                if job.created_at < cutoff and not job.running:
                    shutil.rmtree(job.dir, ignore_errors=True)
                    self.jobs.pop(jid, None)

    async def shutdown(self) -> None:
        for job in self.jobs.values():
            for it in job.items.values():
                it.cancel.set()
