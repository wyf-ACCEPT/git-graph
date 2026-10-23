import { IconRefresh, IconLoader2, IconArrowDown, IconArrowUp } from '@tabler/icons-react'
import type { BranchSync } from '../../shared/branchSync'
import type { PullResult } from '../../shared/pull'

export function AutoPullControl({ enabled, running, paused, available, result, onToggle, onPull, sync, onBranchPull, onPush, busyLabel }: {
  busyLabel?: string
  sync?: BranchSync | null; onBranchPull?: () => void; onPush?: () => void
  enabled: boolean; running: boolean; paused: boolean; available: boolean
  result: PullResult | null; onToggle: (enabled: boolean) => void; onPull: () => void
}) {
  const message = running ? (busyLabel ?? 'Fetching all remotes…') : result?.message ?? (enabled ? 'Every 5m · all remotes' : 'Automatic pull is off.')
  const disabled = !available || running || paused
  return <div className="flex flex-wrap items-center gap-2 text-[12px]">
    <button type="button" role="switch" aria-checked={enabled} aria-label="Auto pull all remotes every 5 minutes"
      disabled={!available || running} onClick={() => onToggle(!enabled)}
      title={!available ? 'Select a repository first.' : running ? 'Waiting for the current Git action to finish.' : 'Fetch all branches from every remote of this repository every 5 minutes. Local branches and working files are unchanged.'}
      className={`cursor-pointer rounded-md border px-2 py-1 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 ${enabled ? 'border-accent bg-accent/15 text-accent hover:bg-accent/25' : 'border-line text-dim hover:bg-rowhover'}`}>
      Auto pull · 5m
    </button>
    <button type="button" disabled={disabled} aria-label="Fetch all remotes"
      title={!available ? 'Select a repository first.' : running ? 'Waiting for the current Git action to finish.' : paused ? 'Waiting for the current Git action or confirmation.' : 'Fetch all branches from every remote of this repository. Local branches and working files are unchanged.'}
      onClick={onPull}
      className="flex size-7 cursor-pointer items-center justify-center rounded-md border border-line text-dim hover:bg-rowhover focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45">
      {running ? <IconLoader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <IconRefresh size={15} aria-hidden />}
    </button>
    {([{ label: 'Pull branch', icon: IconArrowDown, active: sync?.canPull, action: onBranchPull },
      { label: 'Push branch', icon: IconArrowUp, active: sync?.canPush, action: onPush }] as const).map(({ label, icon: Icon, active, action }) => (
      <button key={label} type="button" aria-label={label} disabled={disabled || !active || !action}
        title={`${label === 'Pull branch' ? 'Pull current branch (fast-forward only)' : 'Push current branch (no force)'}${sync?.branch ? ` ${sync.branch}` : ''}: ${sync?.reason ?? 'Fetch all remotes to refresh branch status.'}`}
        onClick={action}
        className="flex size-7 cursor-pointer items-center justify-center rounded-md border border-line text-accent hover:bg-rowhover focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:text-faint disabled:opacity-45">
        <Icon size={15} aria-hidden />
      </button>
    ))}
    <span role={result?.state === 'error' && !running ? 'alert' : 'status'} title={result?.checkedAt ? `${message} · ${result.checkedAt}` : message}
      className={`w-48 max-w-full truncate ${result?.state === 'error' && !running ? 'font-medium text-fg' : 'text-faint'}`}>
      {message}
    </span>
  </div>
}
