import { IconCircleCheck } from '@tabler/icons-react'
import type { WorkingTree } from '../../shared/git.schema'
import { GRAPH_NODE_COLUMN_X, ROW_HEIGHT } from './graphGeometry'
import { FileLineStats } from './fileStatus'

// Shared working-tree label with the same diff-link/handler seams as before.
// CommitGraph can render it alongside a connected synthetic SVG node. Standalone
// hosts retain a matching gray marker; a clean tree retains the check icon.
const MARKER_SIZE = 16
const markerStyle = { left: GRAPH_NODE_COLUMN_X - MARKER_SIZE / 2 }

const ROW_CLASS = 'relative flex items-center gap-2 border-b border-line pr-4'

export type UncommittedChangesRowProps = {
  /** The repository's uncommitted changes, as the working-tree route reports them. */
  working: WorkingTree
  /** Hide the dirty marker when CommitGraph owns the connected SVG node. */
  showMarker?: boolean
  /**
   * Left inset for the text, matching the commit rows' `graphContentLeft` for
   * the graph's current lane count.
   */
  contentLeft: number
  /**
   * Where to open the change set. A host with a standalone diff tab passes its
   * URL (this repo's `/working` route) and the row renders a real link — so
   * cmd/middle-click and "open in new tab" work; a host with **no** diff-tab
   * routes passes null and wires {@link onOpen} instead. Same href-or-handler
   * seam `CommitDetailPanel` already offers its two open-diff controls.
   */
  href?: string | null
  /**
   * Open the change set in the host's own surface (nightshift-ui's in-app diff
   * modal). Takes precedence over {@link href} when both are given.
   */
  onOpen?: (() => void) | null
}

export function UncommittedChangesRow({
  working,
  showMarker = true,
  contentLeft,
  href = null,
  onOpen = null,
}: UncommittedChangesRowProps) {
  const fileCount = working.files.length
  const additions = working.files.reduce((sum, file) => sum + (file.additions ?? 0), 0)
  const deletions = working.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)

  // A clean tree has nothing to open. The row stays (ADR-0025) and says so,
  // rather than vanishing and leaving the reader unsure whether it was ever
  // checked.
  if (fileCount === 0) {
    return (
      <div
        className={`${ROW_CLASS} text-faint`}
        style={{ height: ROW_HEIGHT, paddingLeft: contentLeft }}
        title="working tree clean — no uncommitted changes to view"
      >
        <IconCircleCheck
          size={MARKER_SIZE}
          className="absolute top-1/2 -translate-y-1/2"
          style={markerStyle}
          aria-hidden
        />
        <span className="text-[12px]">Working tree clean</span>
      </div>
    )
  }

  const label = `view ${fileCount} uncommitted change${fileCount === 1 ? '' : 's'}`
  const body = (
    <>
      {showMarker && <svg width={MARKER_SIZE} height={MARKER_SIZE} aria-hidden
        className="absolute top-1/2 -translate-y-1/2" style={markerStyle}>
        <circle cx={MARKER_SIZE / 2} cy={MARKER_SIZE / 2} r={5} fill="var(--color-canvas)" stroke="var(--color-dim)" strokeWidth={2} />
      </svg>}
      <span className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-accent">
        Uncommitted changes
        <span className="ml-2 text-faint">
          {fileCount} file{fileCount === 1 ? '' : 's'}
          {working.filesTruncated && '+'}
        </span>
      </span>
      <FileLineStats additions={additions} deletions={deletions} />
    </>
  )

  // A handler-driven host gets a real button, not a link with a dead href: the
  // row opens an in-app modal, which is not a navigation and must not offer
  // "open in new tab".
  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`${ROW_CLASS} w-full cursor-pointer bg-transparent hover:bg-rowhover`}
        style={{ height: ROW_HEIGHT, paddingLeft: contentLeft }}
        title={`${label} in the diff view`}
      >
        {body}
      </button>
    )
  }

  return (
    <a
      href={href ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      className={`${ROW_CLASS} hover:bg-rowhover`}
      style={{ height: ROW_HEIGHT, paddingLeft: contentLeft }}
      title={`${label} in a new tab`}
    >
      {body}
    </a>
  )
}
