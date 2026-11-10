"""Tiny in-memory sliding-window rate limiter (per client IP, per bucket)."""
from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

_hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)


def limit(bucket: str, max_calls: int, per_seconds: float):
    async def dep(request: Request) -> None:
        ip = request.client.host if request.client else "unknown"
        q = _hits[(bucket, ip)]
        now = time.monotonic()
        while q and q[0] <= now - per_seconds:
            q.popleft()
        if len(q) >= max_calls:
            retry = int(per_seconds - (now - q[0])) + 1
            raise HTTPException(429, f"Too many requests — retry in {retry}s",
                                headers={"Retry-After": str(retry)})
        q.append(now)

    return dep
