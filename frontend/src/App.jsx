import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, saveUrl } from './lib/api'
import { eta, speed } from './lib/format'
import { useDownloader } from './useDownloader'
import UrlInput from './components/UrlInput'
import VideoCard from './components/VideoCard'
import { Header, HistoryView, OUTPUT_OPTIONS, QUALITY_OPTIONS, SettingsView, StatCard, Toasts } from './components/Views'
import { Button, Card, Checkbox, Progress, Select } from './components/ui'
import { AlertIcon, BoltIcon, CheckIcon, DownloadIcon, LayersIcon, RetryIcon, StopIcon, TrashIcon, VideoIcon, ZipIcon } from './components/Icons'

const PAGE = 60
const ACTIVE = new Set(['queued', 'downloading', 'processing'])

function readLS(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback } catch { return fallback }
}
function writeLS(key, v) { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* ignore */ } }

export default function App() {
  const [view, setView] = useState('dashboard')
  const [theme, setTheme] = useState(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
  const [settings, setSettings] = useState(() => ({ quality: 'best', output: 'mp4', concurrency: 3, ...readLS('fbd.settings', {}) }))
  const [health, setHealth] = useState(null)
  const [toasts, setToasts] = useState([])
  const [filter, setFilter] = useState('all')
  const [limit, setLimit] = useState(PAGE)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try { localStorage.setItem('fbd.theme', theme) } catch { /* ignore */ }
  }, [theme])
  useEffect(() => writeLS('fbd.settings', settings), [settings])

  const notify = useCallback((msg, type = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t.slice(-3), { id, msg, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
  }, [])

  useEffect(() => {
    let alive = true
    const ping = () => api.health().then((h) => alive && setHealth(h)).catch(() => alive && setHealth(null))
    ping()
    const t = setInterval(ping, 15000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const d = useDownloader(notify)
  const { rows, itemByUrl, stats, jobId, analyzing } = d

  // Stable handlers for memoized cards (read latest state through a ref).
  const ref = useRef({})
  ref.current = { d, settings, jobId }
  const h = useMemo(() => ({
    toggle: (key, v) => ref.current.d.setSelected(new Set([key]), v),
    download: (row) => ref.current.d.download([row], ref.current.settings),
    cancel: (item) => ref.current.d.cancel([item.id]),
    retry: (item) => ref.current.d.retry([item.id]),
    remove: (row) => ref.current.d.removeRows(new Set([row.key])),
    save: (item) => saveUrl(api.fileUrl(ref.current.jobId, item.id)),
    recheck: (row) => ref.current.d.analyze(new Set([row.key])),
  }), [])

  const statusOf = (r) => itemByUrl[r.url]?.status || r.analysis
  const counts = useMemo(() => {
    const c = { all: rows.length, ready: 0, active: 0, completed: 0, failed: 0, inaccessible: 0, pending: 0, selected: 0 }
    for (const r of rows) {
      const s = statusOf(r)
      if (r.selected) c.selected++
      if (ACTIVE.has(s)) c.active++
      else if (s === 'completed') c.completed++
      else if (s === 'failed' || s === 'cancelled') c.failed++
      else if (s === 'inaccessible') c.inaccessible++
      else if (s === 'ready') c.ready++
      else c.pending++
    }
    return c
  }, [rows, itemByUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => rows.filter((r) => {
    const s = statusOf(r)
    switch (filter) {
      case 'ready': return s === 'ready'
      case 'active': return ACTIVE.has(s)
      case 'completed': return s === 'completed'
      case 'failed': return s === 'failed' || s === 'cancelled'
      case 'inaccessible': return s === 'inaccessible' || s === 'pending' || s === 'analyzing'
      default: return true
    }
  }), [rows, itemByUrl, filter]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setLimit(PAGE), [filter])

  const readyRows = rows.filter((r) => r.analysis === 'ready')
  const selectedRows = rows.filter((r) => r.selected)
  const allSelected = readyRows.length > 0 && readyRows.every((r) => r.selected)
  const someSelected = selectedRows.length > 0 && !allSelected

  const onAnalyze = async (valid) => {
    const n = d.addUrls(valid)
    if (n < valid.length) notify(`${valid.length - n} link(s) were already in the queue`, 'info')
    await d.analyze()
  }

  const clearCompleted = () => {
    const keys = new Set(rows.filter((r) => statusOf(r) === 'completed').map((r) => r.key))
    if (!keys.size) return notify('No completed videos to clear', 'info')
    if (!window.confirm(`Remove ${keys.size} completed video(s) from the queue? They will no longer be included in the ZIP.`)) return
    d.removeRows(keys)
  }

  const dlZip = () => {
    if (!jobId || !counts.completed) return notify('No completed videos to package yet', 'info')
    notify('Preparing ZIP. Your download will start shortly.', 'info')
    saveUrl(api.zipUrl(jobId))
  }

  const overall = stats?.overall_progress ?? 0
  const hasJob = !!stats && stats.total > 0

  return (
    <div className="min-h-screen">
      <Header view={view} setView={setView} theme={theme} toggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} health={health} />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {view === 'history' && <HistoryView notify={notify} />}
        {view === 'settings' && <SettingsView settings={settings} setSettings={setSettings} theme={theme} setTheme={setTheme} health={health} />}

        {view === 'dashboard' && (
          <>
            {health && !health.ffmpeg && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-500/10 dark:text-amber-200">
                <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
                FFmpeg was not found on the server. Only pre-merged streams can download, so the highest resolutions may not be available. Run <code className="font-mono">pip install imageio-ffmpeg</code> or install FFmpeg.
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <UrlInput onAnalyze={onAnalyze} analyzing={analyzing} onStop={d.stopAnalyze} onClearAll={() => rows.length && window.confirm('Clear all videos and cancel active downloads?') && d.clearAll()} notify={notify} maxUrls={health?.max_urls || 500} />
              </div>
              <Card className="flex flex-col gap-4 p-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">Download options</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Videos are never upscaled. If a source is lower than the chosen quality, the best lower version is used.</p>
                </div>
                <Select label="Quality" value={settings.quality} onChange={(v) => setSettings((s) => ({ ...s, quality: v }))} options={QUALITY_OPTIONS} />
                <Select label="Format" value={settings.output} onChange={(v) => setSettings((s) => ({ ...s, output: v }))} options={OUTPUT_OPTIONS} />
                <label className="flex flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span className="flex justify-between">Simultaneous downloads <b className="text-slate-900 dark:text-white">{settings.concurrency}</b></span>
                  <input type="range" min={1} max={5} value={settings.concurrency} onChange={(e) => setSettings((s) => ({ ...s, concurrency: Number(e.target.value) }))} className="accent-brand-600" />
                </label>
                <div className="mt-auto grid grid-cols-2 gap-2">
                  <Button variant="secondary" disabled={!selectedRows.length} onClick={() => d.download(selectedRows, settings)}>
                    <DownloadIcon /> Selected{selectedRows.length ? ` (${selectedRows.length})` : ''}
                  </Button>
                  <Button variant="primary" disabled={!readyRows.length} onClick={() => d.download(readyRows, settings)}>
                    <DownloadIcon /> Download All
                  </Button>
                </div>
              </Card>
            </div>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Total Videos" value={rows.length} sub={`${readyRows.length} ready · ${counts.inaccessible} not accessible`} tone="blue" icon={<LayersIcon className="h-5 w-5" />} />
              <StatCard label="Downloading" value={(stats?.downloading || 0) + (stats?.processing || 0)} sub={`${stats?.queued || 0} waiting in queue`} tone="indigo" icon={<BoltIcon className="h-5 w-5" />} />
              <StatCard label="Completed" value={stats?.completed || 0} sub={hasJob ? `of ${stats.total} queued` : 'No downloads yet'} tone="green" icon={<CheckIcon className="h-5 w-5" />} />
              <StatCard label="Failed" value={(stats?.failed || 0)} sub={stats?.cancelled ? `${stats.cancelled} cancelled` : 'Retry any time'} tone="red" icon={<AlertIcon className="h-5 w-5" />} />
            </div>

            {hasJob && (
              <Card className="p-5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-semibold text-slate-900 dark:text-white">Overall progress · {overall.toFixed(0)}%</span>
                  <span className="flex flex-wrap gap-x-4 text-xs text-slate-500 dark:text-slate-400">
                    <span>Speed <b className="text-slate-700 dark:text-slate-200">{speed(stats.speed)}</b></span>
                    <span>Remaining <b className="text-slate-700 dark:text-slate-200">{stats.running ? eta(stats.eta) : '—'}</b></span>
                    <span>{stats.completed + stats.failed + stats.cancelled}/{stats.total} finished</span>
                  </span>
                </div>
                <Progress value={overall} tone={stats.running ? 'brand' : stats.failed ? 'amber' : 'green'} className="h-2.5" />
              </Card>
            )}

            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Checkbox checked={allSelected} indeterminate={someSelected} disabled={!readyRows.length}
                    onChange={(v) => d.setSelected('all', v)} label="Select all" />
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">Video queue</h2>
                  <div className="flex flex-wrap gap-1">
                    {[['all', 'All'], ['ready', 'Ready'], ['active', 'Active'], ['completed', 'Completed'], ['failed', 'Failed'], ['inaccessible', 'Unavailable']].map(([id, label]) => (
                      <button key={id} onClick={() => setFilter(id)}
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${filter === id ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700'}`}>
                        {label} <span className="opacity-60">{id === 'inaccessible' ? counts.inaccessible + counts.pending : counts[id]}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="danger" disabled={!selectedRows.length} onClick={() => d.removeRows(new Set(selectedRows.map((r) => r.key)))}><TrashIcon /> Remove Selected</Button>
                  <Button size="sm" disabled={!stats?.running} onClick={() => d.cancel(null, 'Cancelled')}><StopIcon /> Cancel All</Button>
                  <Button size="sm" disabled={!counts.failed} onClick={() => d.retry(null, 'Retrying')}><RetryIcon /> Retry Failed</Button>
                </div>
              </div>

              {rows.length === 0 ? (
                <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                  <span className="rounded-2xl bg-brand-50 p-4 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"><VideoIcon className="h-8 w-8" /></span>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">Your queue is empty</p>
                  <p className="max-w-md text-sm text-slate-500">Paste public Facebook video links above and click <b>Analyze Videos</b>. Each link is checked first, and only videos that pass the check can be downloaded.</p>
                </Card>
              ) : filtered.length === 0 ? (
                <Card className="py-12 text-center text-sm text-slate-500">No videos match this filter.</Card>
              ) : (
                <div className="space-y-3">
                  {filtered.slice(0, limit).map((r) => (
                    <VideoCard key={r.key} row={r} item={itemByUrl[r.url]} quality={settings.quality}
                      onToggle={h.toggle} onDownload={h.download} onCancel={h.cancel} onRetry={h.retry}
                      onRemove={h.remove} onSave={h.save} onRecheck={h.recheck} />
                  ))}
                  {filtered.length > limit && (
                    <div className="flex justify-center pt-2">
                      <Button onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, filtered.length - limit)} more ({filtered.length - limit} hidden)</Button>
                    </div>
                  )}
                </div>
              )}
            </section>

            <Card className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 p-3 backdrop-blur">
              <span className="px-2 text-sm text-slate-600 dark:text-slate-300">
                <b className="text-slate-900 dark:text-white">{counts.completed}</b> ready to save{counts.selected ? ` · ${counts.selected} selected` : ''}
              </span>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => setView('history')}>Download History</Button>
                <Button size="sm" onClick={clearCompleted} disabled={!counts.completed}><TrashIcon /> Clear Completed</Button>
                <Button size="sm" variant="primary" onClick={dlZip} disabled={!counts.completed}><ZipIcon /> Download ZIP</Button>
              </div>
            </Card>
          </>
        )}
      </main>
      <Toasts toasts={toasts} dismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  )
}
