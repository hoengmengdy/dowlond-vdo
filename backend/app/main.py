"""FB Bulk Video Downloader — FastAPI application."""
from __future__ import annotations

import asyncio
import json
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import yt_dlp
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from . import config, db, engine, validation
from .jobs import JobManager
from .ratelimit import limit

manager: JobManager


@asynccontextmanager
async def lifespan(app: FastAPI):
    global manager
    db.init()
    manager = JobManager()
    cleaner = asyncio.create_task(manager.cleanup_loop())
    yield
    cleaner.cancel()
    await manager.shutdown()


app = FastAPI(title="FB Bulk Video Downloader", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"],
)

_analyze_sem = asyncio.Semaphore(config.ANALYZE_CONCURRENCY)


# ---------- models ----------
class AnalyzeRequest(BaseModel):
    urls: list[str] = Field(min_length=1)

    @field_validator("urls")
    @classmethod
    def _cap(cls, v: list[str]) -> list[str]:
        if len(v) > config.MAX_ANALYZE_PER_REQUEST:
            raise ValueError(f"At most {config.MAX_ANALYZE_PER_REQUEST} URLs per analyze request "
                             "(the UI batches larger lists automatically)")
        return v


class StartItem(BaseModel):
    url: str
    title: str | None = Field(default=None, max_length=300)
    thumbnail: str | None = Field(default=None, max_length=4096)
    duration: float | None = None


class StartRequest(BaseModel):
    items: list[StartItem] = Field(min_length=1)
    quality: Literal["best", "1080", "720", "480"] = "best"
    output: Literal["mp4", "original"] = "mp4"
    concurrency: int = Field(default=3, ge=1, le=config.MAX_CONCURRENCY)

    @field_validator("items")
    @classmethod
    def _cap(cls, v: list[StartItem]) -> list[StartItem]:
        if len(v) > config.MAX_URLS_PER_REQUEST:
            raise ValueError(f"At most {config.MAX_URLS_PER_REQUEST} videos per job")
        return v


class ItemSelection(BaseModel):
    item_ids: list[str] | None = None


def _job_or_404(job_id: str):
    job = manager.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found (it may have expired)")
    return job


def _safe_thumb(url: str | None) -> str | None:
    """Only pass through https thumbnails from Facebook's CDN; the browser loads them directly."""
    if not url:
        return None
    from urllib.parse import urlsplit
    p = urlsplit(url)
    host = (p.hostname or "").lower()
    if p.scheme == "https" and (host.endswith(".fbcdn.net") or host.endswith(".facebook.com")):
        return url
    return None


# ---------- endpoints ----------
@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "yt_dlp": yt_dlp.version.__version__,
        "ffmpeg": bool(config.FFMPEG_PATH),
        "max_concurrency": config.MAX_CONCURRENCY,
        "max_file_size": config.MAX_FILE_SIZE,
        "max_urls": config.MAX_URLS_PER_REQUEST,
        "max_analyze_batch": config.MAX_ANALYZE_PER_REQUEST,
        "active_jobs": sum(1 for j in manager.jobs.values() if j.running),
        "time": time.time(),
    }


@app.post("/api/videos/analyze", dependencies=[Depends(limit("analyze", 60, 60))])
async def analyze(req: AnalyzeRequest):
    async def one(raw: str) -> dict:
        base = {"input": raw}
        try:
            parsed = validation.parse_facebook_url(raw)
            url = parsed.url
            if parsed.needs_resolve:
                url = await validation.resolve_short_link(parsed.url)
            async with _analyze_sem:
                info = await asyncio.wait_for(asyncio.to_thread(engine.analyze, url),
                                              timeout=config.ANALYZE_TIMEOUT)
            info["thumbnail"] = _safe_thumb(info.get("thumbnail"))
            return base | {"url": url, "accessible": True, "error": None, **info}
        except validation.UrlError as e:
            return base | {"accessible": False, "error": str(e), "kind": "invalid"}
        except asyncio.TimeoutError:
            return base | {"accessible": False, "error": "Timed out while checking this video", "kind": "timeout"}
        except engine.EngineError as e:
            return base | {"accessible": False, "error": str(e), "kind": "inaccessible"}
        except Exception as e:  # noqa: BLE001
            return base | {"accessible": False, "error": engine.friendly_error(e), "kind": "error"}

    results = await asyncio.gather(*(one(u) for u in req.urls))
    return {"results": results}


async def _validated_entries(req: StartRequest) -> tuple[list[dict], list[dict]]:
    entries, errors, seen = [], [], set()
    for it in req.items:
        try:
            parsed = validation.parse_facebook_url(it.url)
        except validation.UrlError as e:
            errors.append({"url": it.url, "error": str(e)})
            continue
        if parsed.needs_resolve:
            try:
                parsed = validation.parse_facebook_url(await validation.resolve_short_link(parsed.url))
            except validation.UrlError as e:
                errors.append({"url": it.url, "error": str(e)})
                continue
        if parsed.key in seen:
            continue
        seen.add(parsed.key)
        entries.append({"url": parsed.url, "title": it.title, "thumbnail": _safe_thumb(it.thumbnail),
                        "duration": it.duration})
    if not entries:
        raise HTTPException(422, {"message": "No valid URLs to download", "errors": errors})
    return entries, errors


@app.post("/api/downloads/start", dependencies=[Depends(limit("start", 20, 60))])
async def start(req: StartRequest):
    entries, errors = await _validated_entries(req)
    job = manager.create(entries, req.quality, req.output, req.concurrency)
    return {"rejected": errors, **job.snapshot()}


@app.post("/api/downloads/{job_id}/items", dependencies=[Depends(limit("start", 20, 60))])
async def add_items(job_id: str, req: StartRequest):
    """Add more videos to an existing job (keeps one queue + one ZIP per session)."""
    job = _job_or_404(job_id)
    entries, errors = await _validated_entries(req)
    try:
        added = manager.add_items(job, entries, req.quality, req.output)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    return {"rejected": errors, "added": [it.id for it in added], **job.snapshot()}


@app.get("/api/downloads/{job_id}")
async def get_job(job_id: str):
    return _job_or_404(job_id).snapshot()


@app.get("/api/downloads/{job_id}/progress")
async def progress(job_id: str, request: Request):
    """Server-Sent Events: emits only items that changed since the last event (delta updates)."""
    job = _job_or_404(job_id)

    async def stream():
        last = 0
        idle = 0
        yield "retry: 2000\n\n"
        while True:
            if await request.is_disconnected():
                return
            snap = job.snapshot(since_rev=last)
            if snap["items"] or idle >= 20:  # heartbeat every ~10s
                last = max(last, snap["rev"])
                yield f"event: update\ndata: {json.dumps(snap, separators=(',', ':'))}\n\n"
                idle = 0
            else:
                idle += 1
            await asyncio.sleep(0.5)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/downloads/{job_id}/cancel")
async def cancel(job_id: str, sel: ItemSelection | None = None):
    job = _job_or_404(job_id)
    return {"cancelled": manager.cancel(job, sel.item_ids if sel else None)}


@app.post("/api/downloads/{job_id}/retry", dependencies=[Depends(limit("retry", 30, 60))])
async def retry(job_id: str, sel: ItemSelection | None = None):
    job = _job_or_404(job_id)
    return {"retried": manager.retry(job, sel.item_ids if sel else None)}


@app.post("/api/downloads/{job_id}/clear")
async def clear_items(job_id: str, sel: ItemSelection):
    job = _job_or_404(job_id)
    return {"removed": manager.remove_items(job, sel.item_ids or [])}


@app.get("/api/downloads/{job_id}/items/{item_id}/file")
async def item_file(job_id: str, item_id: str):
    job = _job_or_404(job_id)
    it = job.items.get(item_id)
    if not it or it.status != "completed" or not it.filepath:
        raise HTTPException(404, "File not available")
    path = Path(it.filepath).resolve()
    if job.dir.resolve() not in path.parents or not path.exists():
        raise HTTPException(404, "File not available")
    return FileResponse(path, filename=it.filename, media_type="application/octet-stream")


@app.get("/api/downloads/{job_id}/zip", dependencies=[Depends(limit("zip", 10, 60))])
async def zip_job(job_id: str):
    job = _job_or_404(job_id)
    try:
        path = await asyncio.to_thread(manager.build_zip, job)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e)) from None
    return FileResponse(path, filename=path.name, media_type="application/zip")


@app.get("/api/history")
async def history(limit_: int = Query(100, alias="limit", ge=1, le=500), offset: int = Query(0, ge=0),
                  status: str | None = Query(None, pattern="^(queued|completed|failed|cancelled)$")):
    return await asyncio.to_thread(db.list_history, limit_, offset, status)


@app.delete("/api/history")
async def clear_history():
    return {"deleted": await asyncio.to_thread(db.clear)}


@app.exception_handler(HTTPException)
async def http_exc(_: Request, exc: HTTPException):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)


# Serve the built frontend (frontend/dist) when present, so one process runs everything.
_dist = config.BASE_DIR.parent / "frontend" / "dist"
if _dist.exists():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")
