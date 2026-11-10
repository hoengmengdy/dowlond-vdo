export function bytes(n) {
  if (n == null || !isFinite(n)) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

export const speed = (n) => (n ? `${bytes(n)}/s` : '—')

export function duration(sec) {
  if (sec == null || !isFinite(sec)) return '—'
  sec = Math.max(0, Math.round(sec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

export const eta = (sec) => (sec == null || !isFinite(sec) ? '—' : duration(sec))

export function when(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

export const QUALITY_LABEL = { best: 'Best available', 1080: '1080p', 720: '720p', 480: '480p' }
