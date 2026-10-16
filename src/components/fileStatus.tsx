import {
  IconArrowRight,
  IconFileDiff,
  IconFileMinus,
  IconFilePlus,
  IconFileSymlink,
  IconFileUnknown,
} from '@tabler/icons-react'
import type { CommitFileChange, FileChangeStatus } from '../../shared/git.schema'

// The one description of how a changed file looks — its status icon, its status
// colour, and its added/removed line counts. Shared (ADR-0026/ADR-0028) by every
// surface that lists changed files: the docked commit panel and the full-tab
// commit and compare views, rather than a copy re-declared on each.

export const FILE_STATUS_ICONS: Record<FileChangeStatus, typeof IconFileDiff> = {
  added: IconFilePlus,
  modified: IconFileDiff,
  deleted: IconFileMinus,
  renamed: IconArrowRight,
  copied: IconArrowRight,
  'type-changed': IconFileDiff,
  unmerged: IconFileUnknown,
  unknown: IconFileUnknown,
}

export const FILE_STATUS_COLORS: Record<FileChangeStatus, string> = {
  added: 'text-[#7ee787]',
  modified: 'text-[#e3b341]',
  deleted: 'text-[#ff7b72]',
  renamed: 'text-[#d2a8ff]',
  copied: 'text-[#d2a8ff]',
  'type-changed': 'text-[#e3b341]',
  unmerged: 'text-dim',
  unknown: 'text-dim',
}

/** The status glyph for a changed file, coloured by kind and labelled for AT. */
export function FileStatusIcon({ status, size = 14 }: { status: FileChangeStatus; size?: number }) {
  const Icon = FILE_STATUS_ICONS[status]
  return <Icon size={size} className={`shrink-0 ${FILE_STATUS_COLORS[status]}`} aria-label={status} />
}

/** How a host opens one changed file in its own surface (ADR-0026: one descriptor). */
export type OpenFileHandler = (file: CommitFileChange) => void

/**
 * The "open this file in the host's own surface" control — the callback seam a
 * host (e.g. an in-app file browser) wires through `onOpenFile`. It is a DISTINCT
 * affordance from the primary file-name click and from any open-diff-in-new-tab
 * link, so it never hijacks either; a host callback or standalone preview href
 * supplies the destination on the row it opens (ADR-0031). Shared once (ADR-0026/0028) by
 * every changed-file list rather than re-declared per surface — the icon and its
 * interaction-state styling stay identical wherever the seam appears.
 */
export function OpenFileButton({
  file, onOpenFile, href, className = '',
}: {
  file: CommitFileChange
  onOpenFile?: OpenFileHandler
  href?: string | null
  className?: string
}) {
  const style = `inline-flex shrink-0 cursor-pointer items-center rounded p-0.5 text-faint transition-colors hover:bg-rowhover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent ${className}`
  if (onOpenFile) return (
    <button type="button" className={style} onClick={() => onOpenFile(file)}
      title={`open ${file.path}`} aria-label={`open ${file.path}`}>
      <IconFileSymlink size={14} aria-hidden />
    </button>
  )
  if (!href) return null
  if (file.binary) return (
    <span className={`inline-flex shrink-0 items-center rounded p-0.5 text-faint opacity-45 ${className}`}
      role="img" title={`${file.path} is binary — text preview is unavailable`}
      aria-label={`${file.path} is binary, no text preview`}>
      <IconFileSymlink size={14} aria-hidden />
    </span>
  )
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={style}
      title={`open ${file.path} full file in a new tab`} aria-label={`open ${file.path} full file in a new tab`}>
      <IconFileSymlink size={14} aria-hidden />
    </a>
  )
}

/** A one-line description of a change, e.g. `renamed: old.ts → new.ts`. */
export function describeFileChange(file: CommitFileChange): string {
  return file.previousPath !== null
    ? `${file.status}: ${file.previousPath} → ${file.path}`
    : `${file.status}: ${file.path}`
}

/** The `+N −M` line counts of a change; renders nothing when both are zero or null. */
export function FileLineStats({
  additions,
  deletions,
}: {
  additions: number | null
  deletions: number | null
}) {
  const hasAdditions = additions !== null && additions > 0
  const hasDeletions = deletions !== null && deletions > 0
  return (
    <span className="shrink-0 font-mono text-[11px] tabular-nums">
      {hasAdditions && <span className="text-[#7ee787]">+{additions}</span>}
      {hasAdditions && hasDeletions && ' '}
      {hasDeletions && <span className="text-[#ff7b72]">−{deletions}</span>}
    </span>
  )
}
