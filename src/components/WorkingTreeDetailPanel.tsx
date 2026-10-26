import { IconExternalLink, IconX } from '@tabler/icons-react'
import type { FileDiff, WorkingTree } from '../../shared/git.schema'
import { FileChangeRow, detailPanelClass } from './CommitDetailPanel'
import { FileLineStats } from './fileStatus'
import { filePreviewHref } from '../lib/filePreview'
import { workingHref } from '../lib/diffRoutes'

type Props = {
  working: WorkingTree
  repository: string
  variant: 'inline' | 'sidebar'
  expandedFilePath: string | null
  onToggleFile(path: string): void
  fileDiff: FileDiff | null
  isLoadingFileDiff: boolean
  fileDiffError: string | null
  diffViewTheme: 'light' | 'dark'
  onClose(): void
}

/** Reuse commit file disclosures and frame geometry without inventing a commit. */
export function WorkingTreeDetailPanel(props: Props) {
  const { working, repository, variant, expandedFilePath, onToggleFile, onClose } = props
  const Container = variant === 'inline' ? 'section' : 'aside'
  return <Container className={detailPanelClass(variant, expandedFilePath !== null)} aria-label="Uncommitted changes details">
    <header className="flex items-center gap-2 border-b border-line px-3 py-2">
      <h2 className="min-w-0 flex-1 text-[13px] font-semibold">Uncommitted changes</h2>
      <a href={workingHref(repository)} target="_blank" rel="noopener noreferrer" className="rounded p-0.5 text-faint hover:bg-rowhover hover:text-fg" aria-label="Open all uncommitted changes in a new tab" title="Open all uncommitted changes in a new tab"><IconExternalLink size={14} aria-hidden /></a>
      <button type="button" onClick={onClose} className="cursor-pointer rounded p-0.5 text-faint hover:bg-rowhover hover:text-fg" aria-label="Close the details panel" title="Close the details panel (Esc)"><IconX size={16} aria-hidden /></button>
    </header>
    <div className="min-h-0 flex-1 overflow-auto px-3 pt-2 pb-2.5">
      <p className="text-[12px] text-faint">{working.branch ?? (working.head ? 'Detached HEAD' : 'Unborn HEAD')}{working.head ? ` · Changes against ${working.head}` : ' · No commits yet'}</p>
      <h3 className="mt-2 flex items-center gap-2 text-[12px] text-dim">
        <span>{working.files.length}{working.filesTruncated ? '+' : ''} {working.files.length === 1 && !working.filesTruncated ? 'file' : 'files'} changed</span>
        <span className="ml-auto"><FileLineStats additions={working.files.reduce((sum, file) => sum + (file.additions ?? 0), 0)} deletions={working.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)} /></span>
      </h3>
      {working.files.length === 0 && <p className="py-1.5 text-faint">Working tree clean — no uncommitted changes.</p>}
      <ul className="mt-1 -ml-1">{working.files.map((file, index) => {
        const expanded = expandedFilePath === file.path
        return <FileChangeRow key={file.path} file={file} isExpanded={expanded} onToggle={() => onToggleFile(file.path)}
          diffHref={file.binary ? null : `${workingHref(repository)}#file-${index}`}
          fileHref={filePreviewHref({ kind: 'working', repo: repository, path: file.path })}
          diff={expanded ? props.fileDiff : null} isLoadingDiff={expanded && props.isLoadingFileDiff}
          diffError={expanded ? props.fileDiffError : null} diffViewTheme={props.diffViewTheme} />
      })}</ul>
      {working.filesTruncated && <p className="py-1.5 text-faint">File list truncated. Additional changes are not shown.</p>}
    </div>
  </Container>
}
