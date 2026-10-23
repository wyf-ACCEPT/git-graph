import { z } from 'zod/v4'
import type { GitActionDescription } from './gitActions'

const name = z.string().min(1).max(1024)
const revision = z.string().min(1).max(2048)
export const RepositoryActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create-branch'), commit: revision, name, checkout: z.boolean().default(false) }),
  z.object({ kind: z.literal('rename-branch'), name, newName: name }),
  z.object({ kind: z.literal('delete-branch'), name }),
  z.object({ kind: z.literal('delete-remote-branch'), name, remote: name }),
  z.object({ kind: z.literal('merge'), source: revision, mode: z.enum(['default', 'no-ff', 'ff-only']).default('no-ff') }),
  z.object({ kind: z.literal('cherry-pick'), commit: revision, mainline: z.number().int().min(1).max(64).optional() }),
  z.object({ kind: z.literal('create-tag'), commit: revision, name, annotated: z.boolean().default(true), message: z.string().max(10000).default('') }),
  z.object({ kind: z.literal('delete-tag'), name }),
  z.object({ kind: z.literal('push-tag'), name, remote: name }),
  z.object({ kind: z.literal('delete-remote-tag'), name, remote: name }),
  z.object({ kind: z.literal('operation'), operation: z.enum(['merge', 'cherry-pick']), command: z.enum(['continue', 'abort', 'skip']) }),
])
export type RepositoryAction = z.infer<typeof RepositoryActionSchema>
export const OperationStateSchema = z.object({
  branch: z.string().nullable(), head: z.string(),
  operation: z.enum(['merge', 'cherry-pick', 'other']).nullable(),
  conflicts: z.array(z.string()), remotes: z.array(z.string()), dirty: z.boolean(),
})
export type OperationState = z.infer<typeof OperationStateSchema>
export const ActionDescriptionSchema = z.object({ title: z.string(), summary: z.string(), warnings: z.array(z.string()), confirmLabel: z.string() })
export const ActionPreviewRequestSchema = z.object({ repo: z.string().default(''), action: RepositoryActionSchema })
export const ActionPreviewSchema = z.object({ token: z.string(), description: ActionDescriptionSchema, state: OperationStateSchema })
export type ActionPreview = z.infer<typeof ActionPreviewSchema>
export const ActionExecuteRequestSchema = ActionPreviewRequestSchema.extend({ token: z.string().min(1) })
export const ActionResultSchema = z.object({ state: z.enum(['completed', 'conflict', 'refused']), message: z.string(), operation: OperationStateSchema })
export type ActionResult = z.infer<typeof ActionResultSchema>

export function describeRepositoryAction(action: RepositoryAction, repository: string, state: OperationState): GitActionDescription {
  const current = state.branch ?? '(detached HEAD)'
  const repo = `in ${repository}`
  const warnings: string[] = []
  let title = ''; let summary = ''; let confirmLabel = ''
  switch (action.kind) {
    case 'create-branch':
      title = `Create branch ${action.name}?`; confirmLabel = action.checkout ? 'Create and check out' : 'Create branch'
      summary = `Create ${action.name} at commit ${action.commit.slice(0, 12)} ${repo}.${action.checkout ? ' Switch to it and update working files.' : ` Stay on ${current}.`}`; break
    case 'rename-branch':
      title = `Rename branch ${action.name}?`; confirmLabel = 'Rename branch'
      summary = `Rename local branch ${action.name} to ${action.newName} ${repo}.`
      warnings.push('The remote branch is not renamed. Existing upstream configuration is kept.'); break
    case 'delete-branch':
      title = `Delete local branch ${action.name}?`; confirmLabel = 'Delete branch'
      summary = `Delete local branch ${action.name} ${repo}.`
      warnings.push('Only merged branches can be deleted here. The remote branch is unchanged.'); break
    case 'delete-remote-branch':
      title = `Delete remote branch ${action.remote}/${action.name}?`; confirmLabel = 'Delete remote branch'
      summary = `Delete refs/heads/${action.name} on remote ${action.remote} ${repo}.`
      warnings.push('This affects other users of the remote. The deletion is refused if the remote tip changed since the local fetch. Local branches are unchanged.'); break
    case 'merge':
      title = `Merge into ${current}?`; confirmLabel = 'Merge'
      summary = `Merge ${action.source.replace(/^refs\/(heads|remotes|tags)\//, '')} into the current branch ${current} ${repo} (${action.mode === 'no-ff' ? 'create a merge commit' : action.mode === 'ff-only' ? 'fast-forward only' : 'fast-forward when possible'}).`
      warnings.push('Requires a clean working tree. If conflicts occur, resolve and stage them in your editor or terminal, then use Continue or Abort here.'); break
    case 'cherry-pick':
      title = `Cherry-pick into ${current}?`; confirmLabel = 'Cherry-pick'
      summary = `Apply commit ${action.commit.slice(0, 12)} onto ${current} as a new commit ${repo}.${action.mainline ? ` Parent ${action.mainline} is the mainline.` : ''}`
      warnings.push('Requires a clean working tree. The new commit records the original commit hash. Conflicts can be continued, skipped or aborted.'); break
    case 'create-tag':
      title = `Create tag ${action.name}?`; confirmLabel = 'Create tag'
      summary = `Create a local ${action.annotated ? 'annotated' : 'lightweight'} tag ${action.name} at ${action.commit.slice(0, 12)} ${repo}.`
      if (action.annotated) warnings.push(`Tag message: ${action.message}`)
      warnings.push('The tag is not pushed until you explicitly choose Push tag.'); break
    case 'delete-tag':
      title = `Delete local tag ${action.name}?`; confirmLabel = 'Delete tag'
      summary = `Delete local tag ${action.name} ${repo}. The remote tag is unchanged.`; break
    case 'push-tag':
      title = `Push tag ${action.name}?`; confirmLabel = 'Push tag'
      summary = `Push only tag ${action.name} to remote ${action.remote} ${repo}.`
      warnings.push('An existing different remote tag is not overwritten. No branch or other tag is pushed.'); break
    case 'delete-remote-tag':
      title = `Delete remote tag ${action.name}?`; confirmLabel = 'Delete remote tag'
      summary = `Delete tag ${action.name} on remote ${action.remote} ${repo}.`
      warnings.push('This affects shared release references. The local tag is kept. A changed remote tag is not deleted.'); break
    case 'operation':
      title = `${action.command === 'continue' ? 'Continue' : action.command === 'skip' ? 'Skip' : 'Abort'} ${action.operation}?`
      confirmLabel = action.command === 'continue' ? 'Continue' : action.command === 'skip' ? 'Skip commit' : 'Abort operation'
      summary = `${confirmLabel} on ${current} ${repo}.`
      warnings.push(action.command === 'continue' ? 'All conflicts must be resolved and staged in your editor or terminal first.' : 'Conflict-resolution work from this operation may be discarded.'); break
  }
  return { title, summary, warnings, confirmLabel }
}
