"""yt-dlp wrapper: metadata extraction and single-video download (blocking; run in threads)."""
from __future__ import annotations

import os
import re
import threading
import unicodedata
from pathlib import Path
from typing import Any, Callable

import yt_dlp
from yt_dlp.utils import DownloadCancelled, DownloadError

from . import config

QUALITIES = ("best", "1080", "720", "480")
OUTPUT_FORMATS = ("mp4", "original")


class Cancelled(Exception):
    pass


class EngineError(Exception):
    pass


class _QuietLogger:
    def debug(self, msg: str) -> None: ...
    def info(self, msg: str) -> None: ...
    def warning(self, msg: str) -> None: ...
    def error(self, msg: str) -> None: ...


def _base_opts() -> dict[str, Any]:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "logger": _QuietLogger(),
        "noplaylist": True,
        "playlist_items": "1",
        "socket_timeout": config.SOCKET_TIMEOUT,
        "retries": 3,
        "fragment_retries": 3,
        "cachedir": False,
        "allowed_extractors": ["facebook.*"],  # never fall back to the generic extractor
        "check_formats": False,
        "overwrites": True,
        "restrictfilenames": True,
    }
    if config.FFMPEG_PATH:
        opts["ffmpeg_location"] = config.FFMPEG_PATH
    return opts


def friendly_error(exc: BaseException) -> str:
    msg = re.sub(r"\x1b\[[0-9;]*m", "", str(exc))
    msg = re.sub(r"^ERROR:\s*", "", msg)
    msg = re.sub(r"^\[[^\]]+\]\s*[\w-]*:?\s*", "", msg)
    low = msg.lower()
    if "login" in low or "log in" in low or "cookies" in low or "private" in low:
        return "Video is private or requires login — only public videos can be downloaded"
    if "unsupported url" in low or "no suitable extractor" in low:
        return "Unsupported Facebook URL"
    if "cannot parse data" in low or "no video formats" in low or "unable to extract" in low:
        return "No public video found at this URL (removed, restricted, or not a video)"
    if "timed out" in low or "timeout" in low:
        return "Connection to Facebook timed out"
    if "http error 404" in low or "not found" in low:
        return "Video not found (404)"
    if "http error 429" in low or "rate" in low and "limit" in low:
        return "Facebook is rate-limiting requests — try again later or lower concurrency"
    if "drm" in low:
        return "Video is DRM-protected and cannot be downloaded"
    return msg[:300] or "Unknown error"


def _pick_entry(info: dict[str, Any]) -> dict[str, Any]:
    if info.get("_type") == "playlist":
        entries = [e for e in (info.get("entries") or []) if e]
        if not entries:
            raise EngineError("No public video found at this URL")
        return entries[0]
    return info


def _video_heights(formats: list[dict[str, Any]]) -> list[int]:
    hs = {int(f["height"]) for f in formats
          if f.get("height") and f.get("vcodec") != "none" and not f.get("has_drm")}
    return sorted(hs, reverse=True)


def analyze(url: str) -> dict[str, Any]:
    opts = _base_opts() | {"skip_download": True}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = _pick_entry(ydl.extract_info(url, download=False) or {})
    except (DownloadError, EngineError) as e:
        raise EngineError(friendly_error(e)) from None

    formats = info.get("formats") or []
    if formats and all(f.get("has_drm") for f in formats):
        raise EngineError("Video is DRM-protected and cannot be downloaded")
    if not formats and not info.get("url"):
        raise EngineError("No downloadable formats are publicly available")

    heights = _video_heights(formats) or ([int(info["height"])] if info.get("height") else [])
    exts = sorted({f.get("ext") for f in formats if f.get("vcodec") != "none" and f.get("ext")})
    sizes = [f.get("filesize") or f.get("filesize_approx") for f in formats]
    sizes = [s for s in sizes if s]
    available = ["best"] + [q for q in ("1080", "720", "480") if any(h >= int(q) for h in heights)]
    return {
        "video_id": info.get("id"),
        "title": (info.get("title") or info.get("fulltitle") or "Facebook video")[:300],
        "thumbnail": info.get("thumbnail"),
        "duration": info.get("duration"),
        "uploader": info.get("uploader") or info.get("channel"),
        "webpage_url": info.get("webpage_url") or url,
        "heights": heights,
        "max_height": heights[0] if heights else None,
        "available_qualities": available,
        "source_exts": exts,
        "approx_size": max(sizes) if sizes else None,
    }


def build_format_opts(quality: str, output: str) -> dict[str, Any]:
    """Format selection that never upscales: `res:N` sorts toward the closest *existing* height ≤ N."""
    has_ffmpeg = bool(config.FFMPEG_PATH)
    sort: list[str] = []
    if quality != "best":
        sort.append(f"res:{int(quality)}")
    if output == "mp4":
        sort += ["vcodec:h264", "ext:mp4:m4a"]
    opts: dict[str, Any] = {"format_sort": sort}
    if has_ffmpeg:
        opts["format"] = "bv*+ba/b"
        if output == "mp4":
            opts["merge_output_format"] = "mp4"
            opts["postprocessors"] = [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}]
    else:
        opts["format"] = "b"  # pre-muxed only: merging needs ffmpeg
    return opts


_SAFE_RE = re.compile(r"[^A-Za-z0-9 ._()\-]+")
_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}


def safe_filename(title: str, ext: str, max_len: int = 80) -> str:
    s = unicodedata.normalize("NFKD", title or "video").encode("ascii", "ignore").decode()
    s = _SAFE_RE.sub("_", s).strip(" ._") or "video"
    s = re.sub(r"\s{2,}", " ", re.sub(r"[_ ]*_[_ ]*", "_", s))[:max_len].rstrip(" ._") or "video"
    if s.upper() in _RESERVED:
        s = f"_{s}"
    ext = re.sub(r"[^A-Za-z0-9]", "", ext or "mp4")[:5] or "mp4"
    return f"{s}.{ext}"


def unique_path(directory: Path, name: str) -> Path:
    p = directory / name
    stem, suffix = p.stem, p.suffix
    i = 1
    while p.exists():
        p = directory / f"{stem} ({i}){suffix}"
        i += 1
    return p


def download(
    url: str,
    item_id: str,
    job_dir: Path,
    quality: str,
    output: str,
    cancel: threading.Event,
    on_progress: Callable[[dict[str, Any]], None],
) -> dict[str, Any]:
    parts: dict[str, list[float]] = {}  # filename -> [downloaded, total]

    def hook(d: dict[str, Any]) -> None:
        if cancel.is_set():
            raise DownloadCancelled("Cancelled by user")
        fn = d.get("filename") or d.get("tmpfilename") or "?"
        done = float(d.get("downloaded_bytes") or 0)
        total = float(d.get("total_bytes") or d.get("total_bytes_estimate") or 0)
        if d.get("status") == "finished":
            total = total or done
            done = total
        parts[fn] = [done, total]
        if done > config.MAX_FILE_SIZE:
            raise DownloadCancelled("__too_large__")
        on_progress({
            "phase": "downloading",
            "part": len(parts),
            "downloaded": sum(p[0] for p in parts.values()),
            "total": sum(p[1] for p in parts.values()) or None,
            "speed": d.get("speed"),
            "eta": d.get("eta"),
        })

    def pp_hook(d: dict[str, Any]) -> None:
        if cancel.is_set():
            raise DownloadCancelled("Cancelled by user")
        if d.get("status") == "started":
            on_progress({"phase": "processing"})

    opts = _base_opts() | build_format_opts(quality, output) | {
        "outtmpl": str(job_dir / f".{item_id}.%(ext)s"),
        "paths": {"home": str(job_dir), "temp": str(job_dir)},
        "max_filesize": config.MAX_FILE_SIZE,
        "progress_hooks": [hook],
        "postprocessor_hooks": [pp_hook],
        "writethumbnail": False,
        "continuedl": True,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = _pick_entry(ydl.extract_info(url, download=True) or {})
    except DownloadCancelled as e:
        _cleanup(job_dir, item_id)
        if "__too_large__" in str(e):
            raise EngineError(f"File exceeds the {config.MAX_FILE_SIZE // 1024**2} MB size limit") from None
        raise Cancelled() from None
    except (DownloadError, EngineError) as e:
        _cleanup(job_dir, item_id)
        if cancel.is_set():
            raise Cancelled() from None
        raise EngineError(friendly_error(e)) from None

    reqs = info.get("requested_downloads") or []
    path = Path(reqs[0]["filepath"]) if reqs and reqs[0].get("filepath") else None
    if not path or not path.exists():
        _cleanup(job_dir, item_id)
        raise EngineError(f"File exceeds the {config.MAX_FILE_SIZE // 1024**2} MB size limit "
                          "or no compatible format was found")

    final = unique_path(job_dir, safe_filename(info.get("title") or "facebook_video", path.suffix.lstrip(".")))
    os.replace(path, final)
    w = info.get("width") or (reqs[0].get("width") if reqs else None)
    h = info.get("height") or (reqs[0].get("height") if reqs else None)
    if not (w and h):
        fmts = info.get("requested_formats") or []
        vf = next((f for f in fmts if f.get("vcodec") != "none" and f.get("height")), None)
        if vf:
            w, h = vf.get("width"), vf.get("height")
    return {
        "filepath": str(final),
        "filename": final.name,
        "filesize": final.stat().st_size,
        "resolution": f"{w}x{h}" if w and h else (f"{h}p" if h else None),
        "height": h,
        "ext": final.suffix.lstrip("."),
        "title": info.get("title"),
        "thumbnail": info.get("thumbnail"),
    }


def _cleanup(job_dir: Path, item_id: str) -> None:
    for p in job_dir.glob(f".{item_id}.*"):
        try:
            p.unlink()
        except OSError:
            pass
