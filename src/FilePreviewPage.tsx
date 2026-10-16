import { useEffect, useState } from 'react'
import { IconFileText, IconGitMerge } from '@tabler/icons-react'
import type { FileDiff } from '../shared/git.schema'
import { fetchCompareFileDiff, fetchFileDiff, fetchWorkingFileDiff } from './lib/api'
import { parseFilePreviewParams } from './lib/filePreview'
import { useTheme } from './lib/theme'
import { DiffTabFrame } from './components/DiffTabFrame'
import { CopyButton } from './components/CopyButton'
import { FileSourceView } from './components/FileSourceView'
import { ThemeToggle } from './components/ThemeToggle'

export function FilePreviewPage() {
  const { themeMode, setThemeMode } = useTheme()
  const [target] = useState(() => parseFilePreviewParams(location.search))
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [error, setError] = useState<string | null>(target === null ? 'This link is missing the file or version to preview.' : null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (target === null) return
    let cancelled = false
    setError(null)
    setDiff(null)
    const request = target.kind === 'commit'
      ? fetchFileDiff(target.repo, target.hash, target.path)
      : target.kind === 'compare'
        ? fetchCompareFileDiff(target.repo, target.head, target.path, target.base)
        : fetchWorkingFileDiff(target.repo, target.path)
    request.then((loaded) => { if (!cancelled) setDiff(loaded) })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load this file.') })
    return () => { cancelled = true }
  }, [target, attempt])
  useEffect(() => {
    if (target !== null) document.title = `${target.path.split('/').pop()} · file · Git Graph`
  }, [target])
  const version = target?.kind === 'commit' ? `commit ${target.hash}`
    : target?.kind === 'compare' ? `branch ${target.head}` : 'working tree snapshot'
  const versionLabel = target?.kind === 'commit' ? `commit ${target.hash.slice(0, 12)}` : version
  return (
    <DiffTabFrame header={<>
      <IconFileText size={18} className="shrink-0 text-accent" aria-hidden />
      <h1 className="min-w-0 flex-1 truncate font-mono text-[12.5px]" title={target?.path}>
        {target?.path ?? 'File preview'}
      </h1>
      {target !== null && <CopyButton value={target.path} label="file path" />}
      <ThemeToggle themeMode={themeMode} onSelectThemeMode={setThemeMode} />
      <div className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-dim">
        <span title={version}>Read-only · {versionLabel}</span>
        <span className="inline-flex min-w-0 items-center gap-1.5 text-faint">
          <IconGitMerge size={14} className="shrink-0" aria-hidden />{target?.repo || '(root)'}
        </span>
      </div>
    </>}>
      {error !== null ? <div role="alert">
        <p>{error}</p>
        {target !== null && <button type="button" onClick={() => setAttempt((value) => value + 1)}
          className="mt-3 cursor-pointer rounded border border-line px-3 py-1.5 hover:bg-rowhover focus-visible:outline-2 focus-visible:outline-accent">Retry</button>}
      </div> : diff === null ? <p role="status" className="text-dim">Loading file…</p> : <FileSourceView diff={diff} />}
    </DiffTabFrame>
  )
}
