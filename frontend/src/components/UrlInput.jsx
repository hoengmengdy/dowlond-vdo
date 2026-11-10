import { useMemo, useRef, useState } from 'react'
import { parseInput } from '../lib/urls'
import { Button, Card } from './ui'
import { AlertIcon, ClipboardIcon, SearchIcon, StopIcon, TrashIcon, UploadIcon } from './Icons'

const PLACEHOLDER = `Paste Facebook video links — one per line

https://www.facebook.com/watch/?v=123456789
https://www.facebook.com/reel/123456789
https://www.facebook.com/example/videos/123456789
https://fb.watch/abcDEF123/`

export default function UrlInput({ onAnalyze, analyzing, onStop, onClearAll, notify, maxUrls = 500 }) {
  const [text, setText] = useState('')
  const [showInvalid, setShowInvalid] = useState(true)
  const fileRef = useRef(null)
  const parsed = useMemo(() => parseInput(text), [text])

  const append = (chunk) => setText((t) => (t && !t.endsWith('\n') ? t + '\n' : t) + chunk.trim() + '\n')

  const paste = async () => {
    try {
      const clip = await navigator.clipboard.readText()
      if (!clip.trim()) return notify('Clipboard is empty', 'info')
      append(clip)
    } catch {
      notify('Clipboard access was blocked — press Ctrl+V in the box instead', 'info')
    }
  }

  const importFile = async (e) => {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    for (const f of files) {
      if (f.size > 5 * 1024 * 1024) { notify(`${f.name} is larger than 5 MB`, 'error'); continue }
      if (!/\.(txt|csv)$/i.test(f.name)) { notify(`${f.name}: only .txt or .csv files are supported`, 'error'); continue }
      append(await f.text())
      notify(`Imported ${f.name}`, 'success')
    }
  }

  const submit = () => {
    if (!parsed.valid.length) return notify('No valid Facebook video links found', 'error')
    if (parsed.valid.length > maxUrls) return notify(`Too many links — the limit is ${maxUrls} per batch`, 'error')
    onAnalyze(parsed.valid)
    // Keep only the invalid lines so the user can fix them.
    setText(parsed.invalid.map((i) => i.input).join('\n'))
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim()).length

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Bulk URL input</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">facebook.com, m.facebook.com and fb.watch links · TXT/CSV import · duplicates removed automatically</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={paste}><ClipboardIcon /> Paste Links</Button>
          <Button size="sm" onClick={() => fileRef.current?.click()}><UploadIcon /> Import TXT/CSV</Button>
          <input ref={fileRef} type="file" accept=".txt,.csv,text/plain,text/csv" multiple hidden onChange={importFile} />
          <Button size="sm" variant="danger" onClick={() => { setText(''); onClearAll() }}><TrashIcon /> Clear All</Button>
        </div>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit() }}
        placeholder={PLACEHOLDER}
        spellCheck={false}
        className="h-44 w-full resize-y rounded-xl border border-slate-200 bg-slate-50/60 p-3 font-mono text-[13px] leading-6 text-slate-800 placeholder:text-slate-400 transition focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-500/10 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-100 dark:placeholder:text-slate-600 dark:focus:bg-slate-950"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Chip tone="slate">{lines} line{lines === 1 ? '' : 's'}</Chip>
          <Chip tone="blue">{parsed.valid.length} valid</Chip>
          {parsed.duplicates > 0 && <Chip tone="amber">{parsed.duplicates} duplicate{parsed.duplicates > 1 ? 's' : ''} removed</Chip>}
          {parsed.invalid.length > 0 && (
            <button onClick={() => setShowInvalid((s) => !s)}><Chip tone="red">{parsed.invalid.length} invalid {showInvalid ? '▾' : '▸'}</Chip></button>
          )}
        </div>
        {analyzing ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">Checking {analyzing.done}/{analyzing.total}…</span>
            <Button variant="secondary" onClick={onStop}><StopIcon /> Stop</Button>
          </div>
        ) : (
          <Button variant="primary" onClick={submit} disabled={!parsed.valid.length} title="Ctrl+Enter">
            <SearchIcon /> Analyze Videos{parsed.valid.length ? ` (${parsed.valid.length})` : ''}
          </Button>
        )}
      </div>

      {showInvalid && parsed.invalid.length > 0 && (
        <ul className="mt-3 max-h-40 space-y-1 overflow-auto rounded-xl border border-red-100 bg-red-50/60 p-3 text-xs dark:border-red-900/40 dark:bg-red-950/20">
          {parsed.invalid.slice(0, 200).map((inv, i) => (
            <li key={i} className="flex gap-2">
              <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
              <span className="min-w-0">
                <span className="break-all font-mono text-slate-700 dark:text-slate-300">{inv.input.slice(0, 160)}</span>
                <span className="text-red-600 dark:text-red-400"> — {inv.error}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Chip({ tone, children }) {
  const t = {
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    blue: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    red: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  }[tone]
  return <span className={`rounded-full px-2.5 py-1 font-semibold ${t}`}>{children}</span>
}
