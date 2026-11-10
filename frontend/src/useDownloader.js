import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './lib/api'

const LS_KEY = 'fbd.session.v1'
const ANALYZE_BATCH = 10
const ANALYZE_PARALLEL = 2
const ACTIVE = new Set(['queued', 'downloading', 'processing'])

function load() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {} } catch { return {} }
}

/**
 * Central state for the dashboard.
 * rows  — videos the user added (analysis state + metadata)
 * items — server-side download items for the current job (keyed by item id, updated via SSE deltas)
 */
export function useDownloader(notify) {
  const saved = useRef(load()).current
  const [rows, setRows] = useState(() =>
    (saved.rows || []).map((r) => (r.analysis === 'analyzing' ? { ...r, analysis: 'pending' } : r)))
  const [jobId, setJobId] = useState(saved.jobId || null)
  const [items, setItems] = useState({})
  const [stats, setStats] = useState(null)
  const [analyzing, setAnalyzing] = useState(null) // {done,total}
  const abortRef = useRef(null)

  // ---- persistence (debounced) ----
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify({ rows, jobId })) } catch { /* storage unavailable */ }
    }, 400)
    return () => clearTimeout(t)
  }, [rows, jobId])

  // ---- live progress via Server-Sent Events ----
  useEffect(() => {
    if (!jobId) return undefined
    let closed = false
    const es = new EventSource(api.progressUrl(jobId))
    es.addEventListener('update', (ev) => {
      const snap = JSON.parse(ev.data)
      setStats(snap.stats)
      if (snap.items.length) {
        setItems((prev) => {
          const next = { ...prev }
          for (const it of snap.items) next[it.id] = it
          return next
        })
      }
    })
    es.onerror = async () => {
      if (closed) return
      try { await api.job(jobId) } catch (e) {
        if (e.status === 404) {
          es.close()
          setJobId(null); setItems({}); setStats(null)
          notify?.('Previous download session expired on the server.', 'info')
        }
      }
    }
    return () => { closed = true; es.close() }
  }, [jobId, notify])

  // latest download item per URL
  const itemByUrl = useMemo(() => {
    const m = {}
    for (const it of Object.values(items)) {
      const cur = m[it.url]
      if (!cur || it.rev > cur.rev) m[it.url] = it
    }
    return m
  }, [items])

  // ---- rows ----
  const addUrls = useCallback((valid) => {
    let added = 0
    setRows((prev) => {
      const keys = new Set(prev.map((r) => r.key))
      const fresh = []
      for (const v of valid) {
        if (keys.has(v.key)) continue
        keys.add(v.key)
        fresh.push({ key: v.key, input: v.input, url: v.url, analysis: 'pending', selected: false, info: null, error: null })
      }
      added = fresh.length
      return [...prev, ...fresh]
    })
    return added
  }, [])

  const patchRows = (patches) => setRows((prev) => prev.map((r) => (patches[r.key] ? { ...r, ...patches[r.key] } : r)))

  const analyze = useCallback(async (onlyKeys) => {
    const targets = (await new Promise((res) => setRows((prev) => { res(prev); return prev })))
      .filter((r) => (onlyKeys ? onlyKeys.has(r.key) : r.analysis === 'pending'))
    if (!targets.length) return
    const ctrl = new AbortController()
    abortRef.current = ctrl
    let done = 0
    setAnalyzing({ done, total: targets.length })
    patchRows(Object.fromEntries(targets.map((r) => [r.key, { analysis: 'analyzing', error: null }])))

    const batches = []
    for (let i = 0; i < targets.length; i += ANALYZE_BATCH) batches.push(targets.slice(i, i + ANALYZE_BATCH))
    const seenIds = new Set()
    let cursor = 0
    const worker = async () => {
      while (cursor < batches.length && !ctrl.signal.aborted) {
        const batch = batches[cursor++]
        const patches = {}
        try {
          const { results } = await api.analyze(batch.map((r) => r.url), ctrl.signal)
          results.forEach((res, i) => {
            const row = batch[i]
            if (res.accessible) {
              const dup = res.video_id && seenIds.has(res.video_id)
              if (res.video_id) seenIds.add(res.video_id)
              patches[row.key] = dup
                ? { analysis: 'inaccessible', error: 'Duplicate — same video as another link in the list', info: res }
                : { analysis: 'ready', url: res.url, info: res, error: null, selected: true }
            } else {
              patches[row.key] = { analysis: 'inaccessible', error: res.error, info: null, selected: false }
            }
          })
        } catch (e) {
          if (ctrl.signal.aborted) break
          for (const row of batch) patches[row.key] = { analysis: 'pending', error: `Check failed: ${e.message}` }
          if (e.status === 429) notify?.(e.message, 'error')
        }
        done += batch.length
        patchRows(patches)
        setAnalyzing({ done, total: targets.length })
      }
    }
    await Promise.all(Array.from({ length: Math.min(ANALYZE_PARALLEL, batches.length) }, worker))
    if (ctrl.signal.aborted) {
      setRows((prev) => prev.map((r) => (r.analysis === 'analyzing' ? { ...r, analysis: 'pending' } : r)))
    }
    setAnalyzing(null)
    abortRef.current = null
  }, [notify])

  const stopAnalyze = useCallback(() => abortRef.current?.abort(), [])

  const setSelected = useCallback((keys, value) => {
    setRows((prev) => prev.map((r) => (keys === 'all' || keys.has(r.key) ? { ...r, selected: value && r.analysis === 'ready' } : r)))
  }, [])

  // ---- downloads ----
  const download = useCallback(async (targetRows, { quality, output, concurrency }) => {
    const list = targetRows.filter((r) => r.analysis === 'ready' && !ACTIVE.has(itemByUrl[r.url]?.status))
    if (!list.length) { notify?.('Nothing to download — analyze videos first, or they are already in the queue.', 'info'); return }
    const body = {
      items: list.map((r) => ({ url: r.url, title: r.info?.title, thumbnail: r.info?.thumbnail, duration: r.info?.duration })),
      quality, output, concurrency: Number(concurrency),
    }
    const apply = (snap) => {
      setStats(snap.stats)
      setItems((prev) => { const n = { ...prev }; for (const it of snap.items) n[it.id] = it; return n })
    }
    try {
      let snap
      if (jobId) {
        try { snap = await api.addItems(jobId, body) } catch (e) { if (e.status !== 404) throw e }
      }
      if (!snap) {
        snap = await api.start(body)
        setItems({})
        setJobId(snap.job_id)
      }
      apply(snap)
      if (snap.rejected?.length) notify?.(`${snap.rejected.length} link(s) rejected by the server`, 'error')
      notify?.(`Queued ${list.length} video${list.length > 1 ? 's' : ''}`, 'success')
    } catch (e) {
      notify?.(e.message, 'error')
    }
  }, [jobId, itemByUrl, notify])

  const act = useCallback(async (fn, ids, msg) => {
    if (!jobId) return
    try {
      const r = await fn(jobId, ids)
      const n = Object.values(r)[0]
      if (msg) notify?.(n ? `${msg} (${n})` : 'Nothing to do', n ? 'success' : 'info')
    } catch (e) { notify?.(e.message, 'error') }
  }, [jobId, notify])

  const cancel = useCallback((ids, msg) => act(api.cancel, ids, msg), [act])
  const retry = useCallback((ids, msg) => act(api.retry, ids, msg), [act])

  const removeRows = useCallback(async (keys) => {
    const target = rows.filter((r) => keys.has(r.key))
    const activeIds = target.map((r) => itemByUrl[r.url]).filter((it) => it && ACTIVE.has(it.status)).map((it) => it.id)
    if (jobId && activeIds.length) await api.cancel(jobId, activeIds).catch(() => {})
    const doneIds = target.map((r) => itemByUrl[r.url]).filter((it) => it && !ACTIVE.has(it.status)).map((it) => it.id)
    if (jobId && doneIds.length) await api.clearItems(jobId, doneIds).catch(() => {})
    setRows((prev) => prev.filter((r) => !keys.has(r.key)))
    if (doneIds.length) setItems((prev) => { const n = { ...prev }; doneIds.forEach((id) => delete n[id]); return n })
  }, [rows, itemByUrl, jobId])

  const clearAll = useCallback(async () => {
    stopAnalyze()
    if (jobId) await api.cancel(jobId).catch(() => {})
    setRows([]); setItems({}); setStats(null); setJobId(null)
  }, [jobId, stopAnalyze])

  return {
    rows, items, itemByUrl, stats, jobId, analyzing,
    addUrls, analyze, stopAnalyze, setSelected, download, cancel, retry, removeRows, clearAll,
  }
}
