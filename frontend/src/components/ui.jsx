export function Button({ variant = 'secondary', size = 'md', className = '', children, ...p }) {
  const v = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-600/20 disabled:bg-brand-600/50',
    secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700',
    ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
    danger: 'bg-white text-red-600 border border-red-200 hover:bg-red-50 dark:bg-slate-800 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40',
  }[variant]
  const s = { sm: 'h-8 px-2.5 text-xs gap-1.5', md: 'h-10 px-4 text-sm gap-2', icon: 'h-8 w-8 justify-center' }[size]
  return (
    <button
      className={`inline-flex items-center rounded-lg font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-50 ${v} ${s} ${className}`}
      {...p}
    >
      {children}
    </button>
  )
}

export function Card({ className = '', children, ...p }) {
  return (
    <div className={`rounded-2xl border border-slate-200/80 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900 ${className}`} {...p}>
      {children}
    </div>
  )
}

export function Progress({ value, tone = 'brand', className = '', indeterminate = false }) {
  const color = { brand: 'bg-brand-500', green: 'bg-emerald-500', red: 'bg-red-500', amber: 'bg-amber-500', slate: 'bg-slate-400' }[tone]
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 ${className}`} role="progressbar" aria-valuenow={Math.round(value || 0)} aria-valuemin={0} aria-valuemax={100}>
      {indeterminate ? (
        <div className={`h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] rounded-full ${color}`} />
      ) : (
        <div className={`h-full rounded-full transition-[width] duration-500 ease-out ${color}`} style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} />
      )}
    </div>
  )
}

const BADGE = {
  pending: ['bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', 'Pending check'],
  analyzing: ['bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400', 'Checking…'],
  ready: ['bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300', 'Ready'],
  inaccessible: ['bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400', 'Not accessible'],
  queued: ['bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', 'Queued'],
  downloading: ['bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400', 'Downloading'],
  processing: ['bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300', 'Merging'],
  completed: ['bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400', 'Completed'],
  failed: ['bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400', 'Failed'],
  cancelled: ['bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300', 'Cancelled'],
}

export function StatusBadge({ status }) {
  const [cls, label] = BADGE[status] || BADGE.pending
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {(status === 'downloading' || status === 'analyzing' || status === 'processing') && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      )}
      {label}
    </span>
  )
}

export function Select({ label, value, onChange, options, className = '', ...p }) {
  return (
    <label className={`flex flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 ${className}`}>
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        {...p}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

export function Checkbox({ checked, onChange, indeterminate, disabled, label }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      disabled={disabled}
      checked={!!checked}
      ref={(el) => el && (el.indeterminate = !!indeterminate)}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 cursor-pointer rounded border-slate-300 text-brand-600 accent-brand-600 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600"
    />
  )
}
