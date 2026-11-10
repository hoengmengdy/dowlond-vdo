import { memo, useState } from 'react'
import { bytes, duration, eta, speed, QUALITY_LABEL } from '../lib/format'
import { Button, Checkbox, Progress, StatusBadge } from './ui'
import { DownloadIcon, LinkIcon, RetryIcon, VideoIcon, XIcon } from './Icons'

function Thumb({ src }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 sm:w-40 dark:from-slate-800 dark:to-slate-900">
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-slate-400 dark:text-slate-600"><VideoIcon className="h-8 w-8" /></div>
      )}
    </div>
  )
}

/**
 * One row in the queue. `row` = analysis data, `item` = live download state (if queued).
 */
function VideoCard({ row, item, quality, onToggle, onDownload, onCancel, onRetry, onRemove, onSave, onRecheck }) {
  const info = row.info
  const status = item?.status || row.analysis
  const active = ['queued', 'downloading', 'processing'].includes(item?.status)
  const maxH = info?.max_height
  const wanted = item?.quality || quality
  const capped = wanted !== 'best' && maxH && maxH < Number(wanted)
  const tone = status === 'completed' ? 'green' : status === 'failed' ? 'red' : status === 'cancelled' ? 'amber' : 'brand'

  return (
    <div className={`group flex flex-col gap-4 rounded-2xl border bg-white p-3 shadow-card transition-all duration-200 sm:flex-row sm:items-center dark:bg-slate-900 ${row.selected ? 'border-brand-300 ring-2 ring-brand-500/10 dark:border-brand-500/50' : 'border-slate-200/80 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700'}`}>
      <div className="flex items-start gap-3 sm:items-center">
        <div className="pt-1 sm:pt-0">
          <Checkbox checked={row.selected} disabled={row.analysis !== 'ready'} onChange={(v) => onToggle(row.key, v)} label="Select video" />
        </div>
        <Thumb src={info?.thumbnail || item?.thumbnail} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={status} />
          {info && <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{duration(info.duration)}</span>}
          {maxH && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">up to {maxH}p</span>}
          {(item || row.analysis === 'ready') && (
            <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-700 dark:bg-brand-500/10 dark:text-brand-400">
              {item?.resolution ? item.resolution : QUALITY_LABEL[wanted]}{item?.output === 'original' ? ' · original' : ' · MP4'}
            </span>
          )}
        </div>
        <h3 className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-white" title={info?.title || row.url}>
          {info?.title || item?.title || (row.analysis === 'inaccessible' ? 'Video unavailable' : row.analysis === 'analyzing' ? 'Checking video…' : 'Not checked yet')}
        </h3>
        <a href={row.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-xs text-slate-500 hover:text-brand-600 dark:text-slate-400">
          <LinkIcon className="h-3 w-3 shrink-0" /><span className="truncate">{row.url}</span>
        </a>

        {item && (active || status === 'completed') && (
          <div className="mt-2">
            <Progress value={item.progress} tone={tone} indeterminate={status === 'processing' || (status === 'downloading' && !item.total)} />
            <div className="mt-1 flex flex-wrap justify-between gap-x-3 text-[11px] text-slate-500 dark:text-slate-400">
              <span>
                {status === 'queued' && 'Waiting in queue…'}
                {status === 'downloading' && `${item.progress.toFixed(0)}% · ${bytes(item.downloaded)}${item.total ? ` of ${bytes(item.total)}` : ''}`}
                {status === 'processing' && 'Merging audio & video…'}
                {status === 'completed' && `${bytes(item.filesize)} · ${item.filename}`}
              </span>
              {status === 'downloading' && <span>{speed(item.speed)} · ETA {eta(item.eta)}</span>}
            </div>
          </div>
        )}
        {capped && !item?.resolution && (
          <p className="mt-1 text-[11px] text-slate-500">Source is {maxH}p max. It will download at {maxH}p, not upscaled.</p>
        )}
        {(item?.error || (!item && row.error)) && (
          <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">{item?.error || row.error}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-stretch">
        {status === 'completed' ? (
          <Button size="sm" variant="primary" onClick={() => onSave(item)}><DownloadIcon /> Save file</Button>
        ) : active ? (
          <Button size="sm" variant="secondary" onClick={() => onCancel(item)}><XIcon /> Cancel</Button>
        ) : (status === 'failed' || status === 'cancelled') ? (
          <Button size="sm" variant="primary" onClick={() => onRetry(item)}><RetryIcon /> Retry</Button>
        ) : row.analysis === 'ready' ? (
          <Button size="sm" variant="primary" onClick={() => onDownload(row)}><DownloadIcon /> Download</Button>
        ) : row.analysis === 'inaccessible' || row.analysis === 'pending' ? (
          <Button size="sm" variant="secondary" onClick={() => onRecheck(row)}><RetryIcon /> Re-check</Button>
        ) : null}
        <Button size="icon" variant="ghost" title="Remove" onClick={() => onRemove(row)} className="opacity-60 hover:opacity-100"><XIcon /></Button>
      </div>
    </div>
  )
}

export default memo(VideoCard)
