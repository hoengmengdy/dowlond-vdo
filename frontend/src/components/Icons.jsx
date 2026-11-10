const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', viewBox: '0 0 24 24' }
const I = (paths) => ({ className = 'h-4 w-4', ...p }) => (
  <svg {...base} className={className} aria-hidden="true" {...p}>{paths}</svg>
)

export const DownloadIcon = I(<><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>)
export const RetryIcon = I(<><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 21v-5h5" /></>)
export const XIcon = I(<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>)
export const ClipboardIcon = I(<><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></>)
export const UploadIcon = I(<><path d="M12 21V9" /><path d="m7 14 5-5 5 5" /><path d="M5 3h14" /></>)
export const SearchIcon = I(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>)
export const TrashIcon = I(<><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></>)
export const ZipIcon = I(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M10 9h1M10 12h1M10 15h1" /></>)
export const SunIcon = I(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>)
export const MoonIcon = I(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />)
export const VideoIcon = I(<><rect x="2" y="5" width="14" height="14" rx="2" /><path d="m22 7-6 5 6 5z" /></>)
export const CheckIcon = I(<path d="M20 6 9 17l-5-5" />)
export const AlertIcon = I(<><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></>)
export const ClockIcon = I(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>)
export const StopIcon = I(<rect x="6" y="6" width="12" height="12" rx="2" />)
export const LinkIcon = I(<><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>)
export const BoltIcon = I(<path d="M13 2 3 14h9l-1 8 10-12h-9z" />)
export const LayersIcon = I(<><path d="m12 2 10 5-10 5L2 7z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" /></>)
