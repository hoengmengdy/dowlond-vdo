"""Strict Facebook URL validation + SSRF-safe short-link resolution.

Only an explicit allow-list of Facebook hosts is ever contacted by this server.
Short links (fb.watch, /share/...) are resolved hop by hop with redirects
disabled, and every hop is re-validated against the allow-list.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import httpx

from . import config

FB_HOSTS = {
    "facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com",
    "mbasic.facebook.com", "business.facebook.com",
}
SHORT_HOSTS = {"fb.watch", "www.fb.watch"}
ALLOWED_HOSTS = FB_HOSTS | SHORT_HOSTS
MAX_URL_LENGTH = 2048

_ID = r"(?:\d+|pfbid[A-Za-z0-9]+)"
# Paths on facebook.com that point directly at a video.
DIRECT_PATTERNS = [
    re.compile(rf"^/reel/(?P<id>\d+)/?$"),
    re.compile(rf"^/[^/]+/videos/(?:[^/]+/)?(?P<id>{_ID})/?$"),
    re.compile(rf"^/watch/live/?$"),
    re.compile(rf"^/watch/?$"),
    re.compile(rf"^/(?:video/)?video\.php$"),
    re.compile(rf"^/video/embed$"),
    re.compile(rf"^/[^/]+/posts/(?P<id>{_ID})/?$"),
    re.compile(rf"^/groups/[^/]+/(?:permalink|posts)/(?P<id>{_ID})/?$"),
    re.compile(rf"^/permalink\.php$"),
    re.compile(rf"^/story\.php$"),
]
# Paths that need a redirect lookup before yt-dlp can handle them.
SHARE_PATTERNS = [
    re.compile(r"^/share/(?:v|r|p)/[A-Za-z0-9_-]+/?$"),
]
QUERY_ID_KEYS = ("v", "video_id", "story_fbid")


class UrlError(ValueError):
    pass


@dataclass
class ParsedUrl:
    url: str          # normalized URL
    key: str          # dedupe key
    needs_resolve: bool


def _host(netloc: str) -> str:
    return netloc.lower().rstrip(".")


def parse_facebook_url(raw: str) -> ParsedUrl:
    s = (raw or "").strip().strip("<>\"'")
    if not s:
        raise UrlError("Empty line")
    if len(s) > MAX_URL_LENGTH:
        raise UrlError("URL is too long")
    if not re.match(r"^https?://", s, re.I):
        if re.match(r"^(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch)/", s, re.I):
            s = "https://" + s
        else:
            raise UrlError("Not a URL (must start with https://)")
    try:
        parts = urlsplit(s)
    except ValueError as e:
        raise UrlError(f"Malformed URL: {e}") from None
    if parts.username or parts.password:
        raise UrlError("Credentials in URL are not allowed")
    try:
        port = parts.port
    except ValueError:
        raise UrlError("Invalid port") from None
    if port not in (None, 80, 443):
        raise UrlError("Custom ports are not allowed")
    host = _host(parts.hostname or "")
    if host not in ALLOWED_HOSTS:
        raise UrlError("Not a Facebook link (allowed: facebook.com, m.facebook.com, fb.watch)")

    path = re.sub(r"/{2,}", "/", parts.path or "/")
    query = parse_qs(parts.query, keep_blank_values=False)

    if host in SHORT_HOSTS:
        if not re.fullmatch(r"/[A-Za-z0-9_-]{4,40}/?", path):
            raise UrlError("Invalid fb.watch short link")
        norm = urlunsplit(("https", "fb.watch", path.rstrip("/") + "/", "", ""))
        return ParsedUrl(norm, "short:" + path.strip("/"), True)

    for pat in SHARE_PATTERNS:
        if pat.match(path):
            norm = urlunsplit(("https", "www.facebook.com", path.rstrip("/") + "/", "", ""))
            return ParsedUrl(norm, "share:" + path.strip("/"), True)

    for pat in DIRECT_PATTERNS:
        m = pat.match(path)
        if not m:
            continue
        vid = m.groupdict().get("id")
        keep = {}
        for k in QUERY_ID_KEYS + ("id",):
            if k in query and re.fullmatch(r"[A-Za-z0-9]+", query[k][0]):
                keep[k] = query[k][0]
                vid = vid or (query[k][0] if k in QUERY_ID_KEYS else None)
        if not vid:
            raise UrlError("Link has no video ID")
        norm = urlunsplit(("https", "www.facebook.com", path, urlencode(keep), ""))
        return ParsedUrl(norm, "id:" + vid, False)

    raise UrlError("Facebook link does not look like a video (expected /watch, /reel, /videos, fb.watch…)")


async def resolve_short_link(url: str) -> str:
    """Follow redirects manually, allowing only Facebook hosts, until a direct video URL appears."""
    current = url
    async with httpx.AsyncClient(
        follow_redirects=False,
        timeout=config.REDIRECT_TIMEOUT,
        headers={"User-Agent": "Mozilla/5.0 (FB Bulk Downloader)"},
    ) as client:
        for _ in range(6):
            resp = await client.head(current)
            if resp.status_code in (405, 403):
                resp = await client.get(current)
            if resp.status_code not in (301, 302, 303, 307, 308):
                break
            loc = resp.headers.get("location")
            if not loc:
                break
            nxt = str(httpx.URL(current).join(loc))
            try:
                parsed = parse_facebook_url(nxt)  # host/path must stay inside the allow-list
            except UrlError:
                raise UrlError("Short link redirects to a non-video page (login may be required)") from None
            if not parsed.needs_resolve:
                return parsed.url
            current = parsed.url
    raise UrlError("Short link could not be resolved to a public video (it may require login)")
