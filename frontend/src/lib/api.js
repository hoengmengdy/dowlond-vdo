const BASE = import.meta.env.VITE_API_BASE || ''

async function req(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(BASE + path, {
    method,
    signal,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch { /* non-JSON */ }
  if (!res.ok) {
    let msg = data?.detail ?? res.statusText
    if (Array.isArray(msg)) msg = msg.map((d) => d.msg).join('; ')
    else if (typeof msg === 'object') msg = msg.message || JSON.stringify(msg)
    const err = new Error(msg || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export const api = {
  health: () => req('/api/health'),
  analyze: (urls, signal) => req('/api/videos/analyze', { method: 'POST', body: { urls }, signal }),
  start: (body) => req('/api/downloads/start', { method: 'POST', body }),
  addItems: (jobId, body) => req(`/api/downloads/${jobId}/items`, { method: 'POST', body }),
  job: (jobId) => req(`/api/downloads/${jobId}`),
  cancel: (jobId, item_ids) => req(`/api/downloads/${jobId}/cancel`, { method: 'POST', body: { item_ids: item_ids ?? null } }),
  retry: (jobId, item_ids) => req(`/api/downloads/${jobId}/retry`, { method: 'POST', body: { item_ids: item_ids ?? null } }),
  clearItems: (jobId, item_ids) => req(`/api/downloads/${jobId}/clear`, { method: 'POST', body: { item_ids } }),
  history: (params = {}) => req('/api/history?' + new URLSearchParams(params)),
  clearHistory: () => req('/api/history', { method: 'DELETE' }),
  progressUrl: (jobId) => `${BASE}/api/downloads/${jobId}/progress`,
  zipUrl: (jobId) => `${BASE}/api/downloads/${jobId}/zip`,
  fileUrl: (jobId, itemId) => `${BASE}/api/downloads/${jobId}/items/${itemId}/file`,
}

/** Trigger a browser download without leaving the page. */
export function saveUrl(url) {
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
