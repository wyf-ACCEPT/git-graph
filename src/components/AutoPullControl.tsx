import { IconRefresh, IconLoader2 } from '@tabler/icons-react'
import type { PullResult } from '../../shared/pull'

export function AutoPullControl({ enabled, running, paused, available, result, onToggle, onPull }: {
  enabled: boolean; running: boolean; paused: boolean; available: boolean
  result: PullResult | null; onToggle: (enabled: boolean) => void; onPull: () => void
}) {
  const message = running ? 'Pulling current branch…' : result?.message ?? (enabled ? 'Every 5m · clean only' : 'Automatic pull is off.')
  const disabled = !available || running || paused
  return <div className="flex flex-wrap items-center gap-2 text-[12px]">
    <button type="button" role="switch" aria-checked={enabled} aria-label="Auto pull every 5 minutes"
      disabled={!available || running} onClick={() => onToggle(!enabled)}
      title={!available ? 'Select a repository first.' : running ? 'Waiting for the current pull to finish.' : 'Automatically fast-forward the current branch only when the working tree is clean.'}
      className={`cursor-pointer rounded-md border px-2 py-1 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 ${enabled ? 'border-accent bg-accent/15 text-accent hover:bg-accent/25' : 'border-line text-dim hover:bg-rowhover'}`}>
      Auto pull · 5m
    </button>
    <button type="button" disabled={disabled} aria-label="Pull current branch now"
      title={!available ? 'Select a repository first.' : running ? 'Waiting for the current pull to finish.' : paused ? 'Waiting for the current Git action or confirmation.' : 'Pull current branch now (clean worktree, fast-forward only).'}
      onClick={onPull}
      className="flex size-7 cursor-pointer items-center justify-center rounded-md border border-line text-dim hover:bg-rowhover focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45">
      {running ? <IconLoader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <IconRefresh size={15} aria-hidden />}
    </button>
    <span role={result?.state === 'error' && !running ? 'alert' : 'status'} title={result?.checkedAt ? `${message} · ${result.checkedAt}` : message}
      className={`w-48 max-w-full truncate ${result?.state === 'error' && !running ? 'font-medium text-fg' : 'text-faint'}`}>
      {message}
    </span>
  </div>
}
