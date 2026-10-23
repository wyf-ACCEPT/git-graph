import { createHash } from 'node:crypto'
import { readFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { RepositoryAction, OperationState } from '../../shared/repositoryActions'
import { describeRepositoryAction } from '../../shared/repositoryActions'
import { runRemoteCommand } from './pull'

type Output = { stdout: string; stderr: string; exitCode: number }
type RunGit = (path: string, args: string[]) => Promise<Output>
class ActionFailure extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
const cleanError = (message: string) => message.replace(/(https?:\/\/)[^\s/]*@/gi, '$1[redacted]@').trim().slice(0, 4000)
const fail = (code: string, message: string): never => { throw new ActionFailure(code, message) }
const nulList = (text: string) => text.split('\0').filter(Boolean)

export function createRepositoryActions({ resolveRepository, runGit, resolveCommit, busyRepositories, networkTimeoutMs = 30_000 }: {
  resolveRepository: (id: string) => Promise<{ absolutePath: string; name: string } | undefined>
  runGit: RunGit
  resolveCommit: (path: string, hash: string) => Promise<string | null>
  busyRepositories: Set<string>; networkTimeoutMs?: number
}) {
  async function checked(path: string, args: string[]) {
    const result = await runGit(path, args)
    if (result.exitCode !== 0) fail('git-refused', cleanError(result.stderr || result.stdout) || 'Git refused the action.')
    return result.stdout
  }
  async function marker(path: string, name: string) {
    const location = await checked(path, ['rev-parse', '--git-path', name])
    const absolute = resolve(path, location.trim())
    try { await access(absolute); return absolute } catch { return null }
  }
  async function snapshot(path: string) {
    const [head, branch, status, refs, remotes, conflicts, staged] = await Promise.all([
      runGit(path, ['rev-parse', '--verify', 'HEAD']), runGit(path, ['symbolic-ref', '-q', 'HEAD']),
      checked(path, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']),
      checked(path, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(symref)', 'refs/heads', 'refs/remotes', 'refs/tags']),
      checked(path, ['remote']), checked(path, ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '--diff-filter=U', '-z']),
      checked(path, ['diff', '--no-ext-diff', '--no-textconv', '--cached', '--raw', '--no-abbrev', '-z']),
    ])
    const markerNames = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer']
    const markers = await Promise.all(markerNames.map(async name => {
      const location = await marker(path, name)
      if (!location) return null
      try { return `${name}:${await readFile(location, 'utf8')}` } catch { return name }
    }))
    const active = markers.filter((value): value is string => value !== null)
    const operation = active.some(x => x.startsWith('MERGE_HEAD:')) ? 'merge' : active.some(x => x.startsWith('CHERRY_PICK_HEAD:')) ? 'cherry-pick' : active.length ? 'other' : null
    const state: OperationState = { branch: branch.exitCode === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, '') : null,
      head: head.exitCode === 0 ? head.stdout.trim() : '', operation, conflicts: nulList(conflicts), remotes: remotes.split('\n').filter(Boolean), dirty: status.length > 0 }
    const listed = refs.split('\n').filter(Boolean).map(line => { const [name, object, symbolic] = line.split('\0'); return { name: name!, object: object!, symbolic: symbolic! } })
    return { state, listed, fingerprint: createHash('sha256').update(JSON.stringify({ state, refs, status, staged, active })).digest('hex') }
  }
  async function validName(path: string, name: string, kind: 'branch' | 'tag') {
    if (name.startsWith('-') || name === 'HEAD' || (await runGit(path, ['check-ref-format', `refs/${kind === 'branch' ? 'heads' : 'tags'}/${name}`])).exitCode !== 0) fail('invalid-name', `Invalid ${kind} name.`)
    return name
  }
  async function prepare(path: string, action: RepositoryAction) {
    const snap = await snapshot(path)
    const { state, listed } = snap
    const getRef = (name: string) => listed.find(ref => ref.name === name && !ref.symbolic) ?? fail('missing-ref', `The reference ${name} is unavailable. Refresh and retry.`)
    const getCommit = async (hash: string) => await resolveCommit(path, hash) ?? fail('missing-commit', 'This commit is not reachable in the repository. Refresh and retry.')
    const requireRemote = (name: string) => { if (!state.remotes.includes(name)) fail('missing-remote', 'Select an existing remote.'); return name }
    if (action.kind !== 'operation' && state.operation) fail('operation-active', 'Finish or abort the current Git operation first.')
    if (action.kind === 'rename-branch' || action.kind === 'delete-branch') {
      const top = (await checked(path, ['rev-parse', '--show-toplevel'])).trim()
      const worktrees = nulList(await checked(path, ['worktree', 'list', '--porcelain', '-z']))
      let worktree = ''
      for (const field of worktrees) {
        if (field.startsWith('worktree ')) worktree = field.slice(9)
        if (field === `branch refs/heads/${action.name}` && resolve(worktree) !== resolve(top)) fail('other-worktree', 'This branch is checked out in another worktree. Manage it from that worktree.')
      }
    }
    let target = ''; let remoteExpected = ''
    switch (action.kind) {
      case 'create-branch':
        await validName(path, action.name, 'branch'); target = await getCommit(action.commit)
        if (listed.some(ref => ref.name === `refs/heads/${action.name}`)) fail('branch-exists', 'A local branch with this name already exists.')
        if (action.checkout && state.dirty) fail('worktree-dirty', 'Commit or stash your changes before creating and checking out a branch.')
        break
      case 'rename-branch':
        getRef(`refs/heads/${action.name}`); await validName(path, action.newName, 'branch')
        if (listed.some(ref => ref.name === `refs/heads/${action.newName}`)) fail('branch-exists', 'The new branch name is already in use.')
        break
      case 'delete-branch':
        getRef(`refs/heads/${action.name}`)
        if (state.branch === action.name) fail('current-branch', 'Check out another branch before deleting this branch.')
        break
      case 'delete-remote-branch': {
        requireRemote(action.remote); await validName(path, action.name, 'branch')
        const full = `refs/remotes/${action.remote}/${action.name}`
        const owner = [...state.remotes].sort((a, b) => b.length - a.length).find(name => full.startsWith(`refs/remotes/${name}/`))
        if (owner !== action.remote) fail('wrong-remote', 'This tracking branch belongs to a different remote.')
        remoteExpected = getRef(full).object; break
      }
      case 'merge': {
        if (!state.branch || !state.head) fail('no-branch', 'Check out a local branch first.')
        if (state.dirty) fail('worktree-dirty', 'Commit or stash your changes before merging.')
        if (/^[0-9a-f]{4,64}$/i.test(action.source)) target = await getCommit(action.source)
        else {
          const ref = getRef(action.source)
          const commit = await checked(path, ['rev-parse', '--verify', '--end-of-options', `${ref.name}^{commit}`])
          target = commit.trim()
        }
        if (target === state.head) fail('already-current', 'This source already points to the current commit.')
        break
      }
      case 'cherry-pick': {
        if (!state.branch || !state.head) fail('no-branch', 'Check out a local branch first.')
        if (state.dirty) fail('worktree-dirty', 'Commit or stash your changes before cherry-picking.')
        target = await getCommit(action.commit)
        const parents = (await checked(path, ['rev-list', '--parents', '-n', '1', target])).trim().split(/\s+/).slice(1)
        if (parents.length > 1 && (!action.mainline || action.mainline > parents.length)) fail('mainline-required', 'Choose which parent of this merge commit is the mainline.')
        if (parents.length <= 1 && action.mainline) fail('invalid-mainline', 'Mainline selection only applies to merge commits.')
        // Cherry-pick lacks merge's --no-overwrite-ignore option. Refuse any
        // ignored file/directory collision before invoking the sequencer.
        const ignored = nulList(await checked(path, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z']))
        const changed = nulList(await checked(path, ['diff-tree', '--no-commit-id', '--no-renames', '--name-only', '-r', '-z', ...(parents.length ? [parents[(action.mainline ?? 1) - 1]!, target] : ['--root', target])]))
        if (ignored.some(file => changed.some(name => file === name || file.startsWith(name + '/') || name.startsWith(file + '/')))) fail('ignored-collision', 'An ignored local file overlaps this commit. Move it out of the way before cherry-picking.')
        break
      }
      case 'create-tag':
        await validName(path, action.name, 'tag'); target = await getCommit(action.commit)
        if (listed.some(ref => ref.name === `refs/tags/${action.name}`)) fail('tag-exists', 'This local tag already exists.')
        if (action.annotated && !action.message.trim()) fail('message-required', 'An annotated tag needs a message.')
        break
      case 'delete-tag': getRef(`refs/tags/${action.name}`); break
      case 'push-tag': requireRemote(action.remote); target = getRef(`refs/tags/${action.name}`).object; break
      case 'delete-remote-tag': requireRemote(action.remote); remoteExpected = getRef(`refs/tags/${action.name}`).object; break
      case 'operation':
        if (state.operation !== action.operation) fail('operation-changed', 'The Git operation changed or has already finished. Refresh and retry.')
        if (action.command === 'skip' && action.operation !== 'cherry-pick') fail('invalid-operation', 'Only cherry-pick supports skipping a commit.')
        if (action.command === 'continue' && state.conflicts.length) fail('unresolved-conflicts', 'Resolve and stage all conflicted files in your editor or terminal before continuing.')
        break
    }
    const token = createHash('sha256').update(JSON.stringify({ path, action, fingerprint: snap.fingerprint, target, remoteExpected })).digest('hex')
    return { token, target, remoteExpected, state }
  }
  async function outcome<T>(operation: () => Promise<T>) {
    try { return { ok: true as const, value: await operation() } }
    catch (error) { return { ok: false as const, code: error instanceof ActionFailure ? error.code : 'git-failed', message: cleanError(error instanceof Error ? error.message : 'Git failed.') } }
  }
  async function operationState(id: string) {
    const repository = await resolveRepository(id)
    if (!repository) return null
    return (await snapshot(repository.absolutePath)).state
  }
  async function previewAction(id: string, action: RepositoryAction) {
    const repository = await resolveRepository(id)
    if (!repository) return null
    return outcome(async () => {
      const prepared = await prepare(repository.absolutePath, action)
      return { token: prepared.token, state: prepared.state, description: describeRepositoryAction(action, repository.name, prepared.state) }
    })
  }
  async function executeAction(id: string, action: RepositoryAction, token: string) {
    const repository = await resolveRepository(id)
    if (!repository) return null
    const path = repository.absolutePath
    if (busyRepositories.has(path)) return { ok: false as const, code: 'repository-busy', message: 'Another Git action is running. Wait and retry.' }
    busyRepositories.add(path)
    try {
      return await outcome(async () => {
        const prepared = await prepare(path, action)
        if (prepared.token !== token) fail('stale-preview', 'The repository changed since this action was reviewed. Review the action again before confirming.')
        const { target, remoteExpected } = prepared
        let args: string[] = []
        let remoteArgs: string[] | null = null
        let completedMessage = ''
        switch (action.kind) {
          case 'create-branch':
            args = action.checkout ? ['switch', '--no-overwrite-ignore', '-c', action.name, target] : ['branch', '--', action.name, target]
            completedMessage = `Created branch ${action.name}${action.checkout ? ' and checked it out' : ''}.`; break
          case 'rename-branch': args = ['branch', '-m', '--', action.name, action.newName]; completedMessage = `Renamed ${action.name} to ${action.newName}.`; break
          case 'delete-branch': args = ['branch', '-d', '--', action.name]; completedMessage = `Deleted local branch ${action.name}.`; break
          case 'merge': {
            const sourceLabel = action.source.replace(/^refs\/(heads|remotes|tags)\//, '')
            const message = `Merge ${action.source.startsWith('refs/') ? 'branch' : 'commit'} '${sourceLabel}' into ${prepared.state.branch}`
            args = ['-c', 'merge.autostash=false', 'merge', '--no-edit', '--no-autostash', '--no-squash', '--no-overwrite-ignore', action.mode === 'no-ff' ? '--no-ff' : action.mode === 'ff-only' ? '--ff-only' : '--ff', '-m', message, target]
            completedMessage = `Merged ${sourceLabel} into ${prepared.state.branch}.`; break
          }
          case 'cherry-pick':
            args = ['cherry-pick', '--no-edit', '-x', ...(action.mainline ? ['-m', String(action.mainline)] : []), target]
            completedMessage = `Cherry-picked ${target.slice(0, 12)} into ${prepared.state.branch}.`; break
          case 'create-tag':
            args = ['tag', ...(action.annotated ? ['-a', '-m', action.message] : ['--no-sign']), '--', action.name, target]
            completedMessage = `Created local tag ${action.name}.`; break
          case 'delete-tag': args = ['tag', '-d', '--', action.name]; completedMessage = `Deleted local tag ${action.name}.`; break
          case 'push-tag':
            remoteArgs = ['-c', `remote.${action.remote}.mirror=false`, 'push', '--porcelain', '--no-force', '--no-follow-tags', '--recurse-submodules=no', '--', action.remote, `${target}:refs/tags/${action.name}`]
            completedMessage = `Pushed tag ${action.name} to ${action.remote}.`; break
          case 'delete-remote-branch':
          case 'delete-remote-tag': {
            const ref = `refs/${action.kind === 'delete-remote-branch' ? 'heads' : 'tags'}/${action.name}`
            // Exact leases protect a reviewed remote deletion from concurrent updates.
            remoteArgs = ['-c', `remote.${action.remote}.mirror=false`, 'push', '--porcelain', '--no-follow-tags', '--recurse-submodules=no', `--force-with-lease=${ref}:${remoteExpected}`, '--', action.remote, `:${ref}`]
            completedMessage = `Deleted ${ref} on ${action.remote}. Local branches and tags are kept.`; break
          }
          case 'operation': args = [action.operation, `--${action.command}`]; completedMessage = action.command === 'continue' ? `Completed ${action.operation}.` : action.command === 'abort' ? `Aborted ${action.operation}.` : 'Skipped cherry-pick commit.'; break
        }
        const result = remoteArgs ? await runRemoteCommand(path, remoteArgs, networkTimeoutMs, 'Remote action timed out; remote acceptance is unknown. Fetch and review remote state before retrying.') : await runGit(path, ['-c', 'core.editor=true', ...args])
        const current = (await snapshot(path)).state
        if (result.exitCode !== 0) {
          return { state: current.operation === 'merge' || current.operation === 'cherry-pick' ? 'conflict' as const : 'refused' as const,
            message: cleanError(result.stderr || result.stdout) || 'Git refused the action.', operation: current }
        }
        return { state: 'completed' as const, message: completedMessage, operation: current }
      })
    } finally { busyRepositories.delete(path) }
  }
  return { previewAction, executeAction, operationState }
}
