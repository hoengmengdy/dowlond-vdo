// Client-side pre-validation (fast feedback). The server re-validates everything strictly.
const FB_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'mbasic.facebook.com', 'business.facebook.com'])
const SHORT_HOSTS = new Set(['fb.watch', 'www.fb.watch'])
const ID = '(\\d+|pfbid[A-Za-z0-9]+)'

const DIRECT = [
  new RegExp(`^/reel/(\\d+)/?$`),
  new RegExp(`^/[^/]+/videos/(?:[^/]+/)?${ID}/?$`),
  /^\/watch(?:\/live)?\/?$/,
  /^\/(?:video\/)?video\.php$/,
  /^\/video\/embed$/,
  new RegExp(`^/[^/]+/posts/${ID}/?$`),
  new RegExp(`^/groups/[^/]+/(?:permalink|posts)/${ID}/?$`),
  /^\/permalink\.php$/,
  /^\/story\.php$/,
]
const SHARE = /^\/share\/(?:v|r|p)\/[A-Za-z0-9_-]+\/?$/

/** Returns { ok, url, key, error } */
export function checkUrl(raw) {
  let s = raw.trim().replace(/^[<"']+|[>"']+$/g, '')
  if (!s) return { ok: false, error: 'Empty line' }
  if (s.length > 2048) return { ok: false, error: 'URL is too long' }
  if (!/^https?:\/\//i.test(s)) {
    if (/^(www\.|m\.|web\.)?(facebook\.com|fb\.watch)\//i.test(s)) s = 'https://' + s
    else return { ok: false, error: 'Not a URL (must start with https://)' }
  }
  let u
  try { u = new URL(s) } catch { return { ok: false, error: 'Malformed URL' } }
  if (u.username || u.password) return { ok: false, error: 'Credentials in URL are not allowed' }
  if (u.port && !['80', '443'].includes(u.port)) return { ok: false, error: 'Custom ports are not allowed' }
  const host = u.hostname.toLowerCase()
  const path = u.pathname.replace(/\/{2,}/g, '/')

  if (SHORT_HOSTS.has(host)) {
    if (!/^\/[A-Za-z0-9_-]{4,40}\/?$/.test(path)) return { ok: false, error: 'Invalid fb.watch short link' }
    const id = path.replace(/\//g, '')
    return { ok: true, url: `https://fb.watch/${id}/`, key: 'short:' + id }
  }
  if (!FB_HOSTS.has(host)) return { ok: false, error: 'Not a Facebook link (facebook.com, m.facebook.com or fb.watch only)' }
  if (SHARE.test(path)) {
    const p = path.replace(/\/$/, '')
    return { ok: true, url: `https://www.facebook.com${p}/`, key: 'share:' + p }
  }
  for (const re of DIRECT) {
    const m = path.match(re)
    if (!m) continue
    const keep = new URLSearchParams()
    let id = m[1]
    for (const k of ['v', 'video_id', 'story_fbid', 'id']) {
      const val = u.searchParams.get(k)
      if (val && /^[A-Za-z0-9]+$/.test(val)) {
        keep.set(k, val)
        if (!id && k !== 'id') id = val
      }
    }
    if (!id) return { ok: false, error: 'Link has no video ID' }
    const q = keep.toString()
    return { ok: true, url: `https://www.facebook.com${path}${q ? '?' + q : ''}`, key: 'id:' + id }
  }
  return { ok: false, error: 'Facebook link, but not a video URL (expected /watch, /reel, /videos, fb.watch…)' }
}

/** Split free text / TXT / CSV into candidate tokens. */
export function tokenize(text) {
  return text
    .split(/[\r\n]+/)
    .flatMap((line) => {
      const found = line.match(/(?:https?:\/\/|(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch)\/)[^\s,;"'<>]+/gi)
      if (found) return found
      const t = line.trim()
      return t ? [t.replace(/^[",;\s]+|[",;\s]+$/g, '')] : []
    })
    .filter(Boolean)
}

/** Parse input into unique valid URLs + invalid entries + duplicate count. */
export function parseInput(text) {
  const valid = []
  const invalid = []
  const seen = new Set()
  let duplicates = 0
  for (const tok of tokenize(text)) {
    const r = checkUrl(tok)
    if (!r.ok) { invalid.push({ input: tok, error: r.error }); continue }
    if (seen.has(r.key)) { duplicates++; continue }
    seen.add(r.key)
    valid.push({ input: tok, url: r.url, key: r.key })
  }
  return { valid, invalid, duplicates }
}
