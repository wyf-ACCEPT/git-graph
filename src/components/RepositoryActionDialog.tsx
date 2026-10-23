import { useRef, useState } from 'react'
import { RepositoryActionSchema, type ActionPreview, type RepositoryAction, type ActionResult, type OperationState } from '../../shared/repositoryActions'
import { ConfirmActionDialog } from './ConfirmActionDialog'
import { executeRepositoryAction, previewRepositoryAction, GitRequestError } from '../lib/api'

export type ActionSeed = { action: RepositoryAction; parentCount?: number }
const controlClass = 'mt-1 w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-45'

export function RepositoryActionDialog({ repository, seed, state, onCancel, onExecuted, onBusy }: {
  repository: string; seed: ActionSeed; state: OperationState | null
  onCancel: () => void; onExecuted: (result: ActionResult) => void; onBusy: (busy: boolean) => void
}) {
  const [action, setAction] = useState<RepositoryAction>(seed.action)
  const [preview, setPreview] = useState<ActionPreview | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const locked = useRef(false)
  const update = (patch: Record<string, unknown>) => { setAction(current => ({ ...current, ...patch }) as RepositoryAction); setError(null); setPreview(null) }
  const destructive = action.kind.startsWith('delete-') || (action.kind === 'operation' && action.command !== 'continue')
  const labels: Record<RepositoryAction['kind'], string> = {
    'create-branch': 'Create branch', 'rename-branch': 'Rename local branch', 'delete-branch': 'Delete local branch',
    'delete-remote-branch': 'Delete remote branch', merge: 'Merge into current branch', 'cherry-pick': 'Cherry-pick commit',
    'create-tag': 'Create tag', 'delete-tag': 'Delete local tag', 'push-tag': 'Push tag', 'delete-remote-tag': 'Delete remote tag', operation: 'Recover Git operation',
  }
  async function confirm() {
    if (locked.current) return
    locked.current = true; setRunning(true); onBusy(true); setError(null)
    try {
      const parsed = RepositoryActionSchema.safeParse(action)
      if (!parsed.success) { setError('Complete all required fields before reviewing this action.'); return }
      if (!preview) { setPreview(await previewRepositoryAction(repository, parsed.data)); return }
      const result = await executeRepositoryAction(repository, parsed.data, preview.token)
      if (result.state === 'refused') { setError(result.message); setPreview(null) }
      else onExecuted(result)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The Git service is unavailable.')
      if (failure instanceof GitRequestError && failure.code === 'stale-preview') setPreview(null)
    } finally { locked.current = false; setRunning(false); onBusy(false) }
  }
  const needsRemote = 'remote' in action
  return <ConfirmActionDialog
    description={preview?.description ?? { title: labels[action.kind], summary: 'Choose the options below, then review the exact target and consequence before running Git.', warnings: [], confirmLabel: 'Review action' }}
    retryLabel={preview ? 'Retry action' : 'Review action'} initialFocus={preview && destructive ? 'cancel' : 'field'} isRunning={running} error={error} onCancel={onCancel} onConfirm={() => { void confirm() }}>
    {preview ? <button type="button" disabled={running} onClick={() => { setPreview(null); setError(null) }}
      className="mt-3 cursor-pointer rounded border border-line px-2 py-1 text-dim hover:bg-rowhover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-45">Back to options</button>
      : <div className="mt-3 flex flex-col gap-3 text-[12.5px]">
        {'commit' in action && <p className="break-all text-dim">Commit: {action.commit}</p>}
        {'source' in action && <p className="break-all text-dim">Source: {action.source.replace(/^refs\/(heads|remotes|tags)\//, '')}</p>}
        {'name' in action && (action.kind === 'create-branch' || action.kind === 'create-tag'
          ? <label>Name<input className={controlClass} value={action.name} disabled={running} autoComplete="off" spellCheck={false} onChange={event => update({ name: event.target.value })} /></label>
          : <p className="break-all text-dim">{action.kind.includes('tag') ? 'Tag' : 'Branch'}: {action.name}</p>)}
        {action.kind === 'rename-branch' && <label>New branch name<input className={controlClass} value={action.newName} disabled={running} autoComplete="off" spellCheck={false} onChange={event => update({ newName: event.target.value })} /></label>}
        {action.kind === 'create-branch' && <label className="flex items-center gap-2"><input type="checkbox" checked={action.checkout} disabled={running} onChange={event => update({ checkout: event.target.checked })} />Check out the new branch</label>}
        {action.kind === 'merge' && <label>Merge behavior<select className={controlClass} value={action.mode} disabled={running} onChange={event => update({ mode: event.target.value })}>
          <option value="no-ff">Create a merge commit</option><option value="default">Fast-forward when possible</option><option value="ff-only">Fast-forward only</option>
        </select></label>}
        {action.kind === 'cherry-pick' && (seed.parentCount ?? 0) > 1 && <label>Mainline parent<select className={controlClass} value={action.mainline ?? ''} disabled={running} onChange={event => update({ mainline: event.target.value ? Number(event.target.value) : undefined })}>
          <option value="">Choose a parent…</option>{Array.from({ length: seed.parentCount! }, (_, i) => <option key={i} value={i + 1}>Parent {i + 1}{i === 0 ? ' (branch before the merge)' : ''}</option>)}
        </select></label>}
        {action.kind === 'create-tag' && <>
          <label>Tag type<select className={controlClass} value={action.annotated ? 'annotated' : 'lightweight'} disabled={running} onChange={event => update({ annotated: event.target.value === 'annotated' })}>
            <option value="annotated">Annotated tag</option><option value="lightweight">Lightweight tag</option>
          </select></label>
          {action.annotated && <label>Tag message<textarea className={`${controlClass} min-h-24 resize-none`} value={action.message} disabled={running} onChange={event => update({ message: event.target.value })} /></label>}
        </>}
        {needsRemote && <label>Remote<select className={controlClass} value={action.remote} disabled={running || action.kind === 'delete-remote-branch'} onChange={event => update({ remote: event.target.value })}>
          <option value="">Choose a remote…</option>{state?.remotes.map(remote => <option key={remote} value={remote}>{remote}</option>)}
        </select></label>}
        {action.kind === 'operation' && <p className="text-dim">Operation: {action.operation} · {action.command}</p>}
      </div>}
  </ConfirmActionDialog>
}
