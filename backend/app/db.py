"""SQLite-backed download history."""
from __future__ import annotations

import sqlite3
import threading
import time
from typing import Any

from . import config

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS history (
    item_id     TEXT PRIMARY KEY,
    job_id      TEXT NOT NULL,
    url         TEXT NOT NULL,
    title       TEXT,
    thumbnail   TEXT,
    status      TEXT NOT NULL,
    quality     TEXT,
    resolution  TEXT,
    filesize    INTEGER,
    filename    TEXT,
    error       TEXT,
    created_at  REAL NOT NULL,
    finished_at REAL
);
CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC);
"""


def init() -> None:
    global _conn
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    _conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
    _conn.row_factory = sqlite3.Row
    with _lock:
        _conn.executescript(SCHEMA)
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.commit()


def upsert(row: dict[str, Any]) -> None:
    assert _conn is not None
    cols = ["item_id", "job_id", "url", "title", "thumbnail", "status", "quality",
            "resolution", "filesize", "filename", "error", "created_at", "finished_at"]
    vals = [row.get(c) for c in cols]
    updates = ", ".join(f"{c}=excluded.{c}" for c in cols[1:])
    with _lock:
        _conn.execute(
            f"INSERT INTO history ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))}) "
            f"ON CONFLICT(item_id) DO UPDATE SET {updates}", vals)
        _conn.commit()


def list_history(limit: int = 100, offset: int = 0, status: str | None = None) -> dict[str, Any]:
    assert _conn is not None
    where, args = "", []
    if status:
        where, args = "WHERE status = ?", [status]
    with _lock:
        total = _conn.execute(f"SELECT COUNT(*) FROM history {where}", args).fetchone()[0]
        rows = _conn.execute(
            f"SELECT * FROM history {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            [*args, limit, offset]).fetchall()
    return {"total": total, "items": [dict(r) for r in rows]}


def clear() -> int:
    assert _conn is not None
    with _lock:
        n = _conn.execute("DELETE FROM history").rowcount
        _conn.commit()
    return n


def now() -> float:
    return time.time()
