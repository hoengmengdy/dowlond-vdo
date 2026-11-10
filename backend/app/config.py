"""Runtime configuration (override with environment variables)."""
from __future__ import annotations

import os
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("FBD_DATA_DIR", BASE_DIR / "data"))
DOWNLOAD_DIR = DATA_DIR / "downloads"
DB_PATH = DATA_DIR / "history.sqlite3"

MAX_URLS_PER_REQUEST = int(os.getenv("FBD_MAX_URLS", "500"))
MAX_ANALYZE_PER_REQUEST = int(os.getenv("FBD_MAX_ANALYZE", "25"))
MAX_FILE_SIZE = int(os.getenv("FBD_MAX_FILE_SIZE", str(2 * 1024**3)))  # 2 GiB per video
MAX_CONCURRENCY = 5
GLOBAL_MAX_DOWNLOADS = int(os.getenv("FBD_GLOBAL_MAX_DOWNLOADS", "5"))
ANALYZE_CONCURRENCY = int(os.getenv("FBD_ANALYZE_CONCURRENCY", "4"))
ANALYZE_TIMEOUT = float(os.getenv("FBD_ANALYZE_TIMEOUT", "45"))
SOCKET_TIMEOUT = float(os.getenv("FBD_SOCKET_TIMEOUT", "20"))
REDIRECT_TIMEOUT = float(os.getenv("FBD_REDIRECT_TIMEOUT", "10"))
JOB_TTL_SECONDS = int(os.getenv("FBD_JOB_TTL", str(24 * 3600)))
CORS_ORIGINS = [o.strip() for o in os.getenv(
    "FBD_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]


def find_ffmpeg() -> str | None:
    """Locate ffmpeg: explicit env var, PATH, then the imageio-ffmpeg bundled binary."""
    env = os.getenv("FBD_FFMPEG")
    if env and Path(env).exists():
        return env
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg  # type: ignore

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


FFMPEG_PATH = find_ffmpeg()

DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
