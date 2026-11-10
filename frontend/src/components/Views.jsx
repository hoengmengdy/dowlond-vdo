import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { bytes, when, QUALITY_LABEL } from '../lib/format'
import { Button, Card, Select, StatusBadge } from './ui'
import { MoonIcon, RetryIcon, SunIcon, TrashIcon } from './Icons'

export function Header({ view, setView, theme, toggleTheme, health }) {
  const tabs = [['dashboard', 'Dashboard'], ['history', 'Download History'], ['settings', 'Settings']]
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <button onClick={() => setView('dashboard')} className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md shadow-brand-600/30">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v10" /><path d="m7.5 9.5 4.5 4.5 4.5-4.5" /><path d="M5 19h14" /></svg>
          </span>
          <span className="hidden text-[15px] font-bold tracking-tight text-slate-900 sm:block dark:text-white">FB Bulk <span className="text-brand-600">Downloader</span></span>
        </button>
        <nav className="ml-2 flex flex-1 gap-1 overflow-x-auto">
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => setView(id)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${view === id ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'}`}>
              {label}
            </button>
          ))}
        </nav>
        <span title={health ? `yt-dlp ${health.yt_dlp} · FFmpeg ${health.ffmpeg ? 'available' : 'missing'}` : 'Backend offline'}
          className="hidden items-center gap-1.5 text-xs font-medium text-slate-500 md:flex">
          <span className={`h-2 w-2 rounded-full ${health ? 'bg-emerald-500' : 'bg-red-500'}`} />{health ? 'Server online' : 'Server offline'}
        </span>
        <Button size="icon" variant="ghost" onClick={toggleTheme} title="Toggle light / dark mode">
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </Button>
      </div>
    </header>
  )
}

export function StatCard({ label, value, sub, tone, icon }) {
  const t = {
    blue: 'from-brand-500/10 text-brand-600 dark:text-brand-400',
    indigo: 'from-indigo-500/10 text-indigo-600 dark:text-indigo-400',
    green: 'from-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    red: 'from-red-500/10 text-red-600 dark:text-red-400',
  }[tone]
  return (
    <Card className="relative overflow-hidden p-4">
      <div className={`absolute inset-0 bg-gradient-to-br to-transparent opacity-60 ${t}`} />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
        </div>
        <span className={`rounded-lg bg-white/70 p-2 dark:bg-slate-800/70 ${t.split(' ').slice(1).join(' ')}`}>{icon}</span>
      </div>
    </Card>
  )
}

export function HistoryView({ notify }) {
  const [data, setData] = useState({ total: 0, items: [] })
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const PAGE = 50

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { limit: PAGE, offset: page * PAGE }
      if (status) params.status = status
      setData(await api.history(params))
    } catch (e) { notify(e.message, 'error') }
    setLoading(false)
  }, [page, status, notify])

  useEffect(() => { load() }, [load])

  const clear = async () => {
    if (!window.confirm('Delete all download history? Downloaded files are not affected.')) return
    try { const r = await api.clearHistory(); notify(`Deleted ${r.deleted} history entries`, 'success'); setPage(0); load() } catch (e) { notify(e.message, 'error') }
  }

  const pages = Math.max(1, Math.ceil(data.total / PAGE))
  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Download History</h2>
          <p className="text-xs text-slate-500">{data.total} entries, stored locally in SQLite</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Select label="Status" value={status} onChange={(v) => { setStatus(v); setPage(0) }}
            options={[{ value: '', label: 'All' }, { value: 'completed', label: 'Completed' }, { value: 'failed', label: 'Failed' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'queued', label: 'Queued' }]} />
          <Button onClick={load} disabled={loading}><RetryIcon /> Refresh</Button>
          <Button variant="danger" onClick={clear} disabled={!data.total}><TrashIcon /> Clear History</Button>
        </div>
      </div>
      {data.items.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-500">{loading ? 'Loading…' : 'No downloads yet.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
              <tr><th className="py-2 pr-3">Video</th><th className="px-3">Status</th><th className="px-3">Quality</th><th className="px-3">Size</th><th className="px-3">Finished</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.items.map((h) => (
                <tr key={h.item_id} className="align-top transition hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="max-w-md py-2.5 pr-3">
                    <p className="truncate font-medium text-slate-800 dark:text-slate-100">{h.title || h.filename || 'Untitled video'}</p>
                    <a href={h.url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-slate-500 hover:text-brand-600">{h.url}</a>
                    {h.error && <p className="text-xs text-red-600 dark:text-red-400">{h.error}</p>}
                  </td>
                  <td className="px-3 py-2.5"><StatusBadge status={h.status} /></td>
                  <td className="px-3 py-2.5 text-xs text-slate-600 dark:text-slate-300">{h.resolution || QUALITY_LABEL[h.quality] || '—'}</td>
                  <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600 dark:text-slate-300">{bytes(h.filesize)}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">{when(h.finished_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-slate-500">Page {page + 1} / {pages}</span>
          <Button size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </Card>
  )
}

export function SettingsView({ settings, setSettings, theme, setTheme, health }) {
  const set = (k) => (v) => setSettings((s) => ({ ...s, [k]: v }))
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="p-5 lg:col-span-2">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Download defaults</h2>
        <p className="mb-5 text-xs text-slate-500">Changes apply to videos you queue from now on.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Quality" value={settings.quality} onChange={set('quality')} options={QUALITY_OPTIONS} />
          <Select label="Output format" value={settings.output} onChange={set('output')} options={OUTPUT_OPTIONS} />
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500 sm:col-span-2 dark:text-slate-400">
            Simultaneous downloads: <span className="text-sm font-bold text-slate-900 dark:text-white">{settings.concurrency}</span>
            <input type="range" min={1} max={health?.max_concurrency || 5} value={settings.concurrency}
              onChange={(e) => set('concurrency')(Number(e.target.value))} className="accent-brand-600" />
            <span className="text-[11px] font-normal">Applies when a new download session starts. Lower values are gentler on your connection and on Facebook rate limits.</span>
          </label>
          <Select label="Theme" value={theme} onChange={setTheme} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Server</h2>
        {health ? (
          <dl className="mt-3 space-y-2 text-sm">
            {[
              ['Status', 'Online'], ['yt-dlp', health.yt_dlp],
              ['FFmpeg', health.ffmpeg ? 'Available (merging & MP4 remux on)' : 'Missing. Only pre-merged streams can download'],
              ['Max file size', bytes(health.max_file_size)], ['Max videos per job', health.max_urls],
              ['Active jobs', health.active_jobs],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium text-slate-800 dark:text-slate-200">{v}</dd></div>
            ))}
          </dl>
        ) : <p className="mt-3 text-sm text-red-600">Backend is unreachable. Start it with <code>uvicorn app.main:app --port 8765</code>.</p>}
        <p className="mt-5 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          Only download public videos that you own or have permission to save, as Facebook's terms allow. This tool does not log in, does not bypass private/restricted content, and does not remove DRM.
        </p>
      </Card>
    </div>
  )
}

export const QUALITY_OPTIONS = [
  { value: 'best', label: 'Best available quality' },
  { value: '1080', label: '1080p (if available)' },
  { value: '720', label: '720p (if available)' },
  { value: '480', label: '480p (if available)' },
]
export const OUTPUT_OPTIONS = [
  { value: 'mp4', label: 'MP4 (most compatible)' },
  { value: 'original', label: 'Original format' },
]

export function Toasts({ toasts, dismiss }) {
  const tone = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200',
    info: 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
  }
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2">
      {toasts.map((t) => (
        <button key={t.id} onClick={() => dismiss(t.id)}
          className={`pointer-events-auto animate-[toast_.2s_ease-out] rounded-xl border px-4 py-3 text-left text-sm font-medium shadow-lg ${tone[t.type] || tone.info}`}>
          {t.msg}
        </button>
      ))}
    </div>
  )
}
