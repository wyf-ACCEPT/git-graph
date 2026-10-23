import { createHash } from 'node:crypto'
import type { BranchSync } from '../../shared/branchSync'
import { fetchRemote, runRemoteCommand } from './pull'

type Output = { stdout: string; stderr: string; exitCode: number }
export function createBranchSyncService({ resolveRepository, runGit, busyRepositories, networkTimeoutMs = 30_000 }: {
  resolveRepository: (id: string) => Promise<{ absolutePath: string } | undefined>
  runGit: (path: string, args: string[]) => Promise<Output>
  busyRepositories: Set<string>; networkTimeoutMs?: number
}) {
  async function inspect(path: string, originBranch?: string) {
    const head = await runGit(path, ['symbolic-ref', '-q', 'HEAD'])
    const branch = originBranch ?? (head.exitCode === 0 ? head.stdout.trim().slice(11) : null)
    const empty: BranchSync = { branch, upstream: null, ahead: 0, behind: 0, canPull: false, canPush: false, reason: 'Check out a branch with a remote upstream.' }
    if (!branch || (await runGit(path, ['check-ref-format', `refs/heads/${branch}`])).exitCode) return { status: empty }
    const listing = await runGit(path, ['for-each-ref', '--format=%(refname)%1f%(upstream)%1f%(upstream:remotename)%1f%(upstream:remoteref)%1f%(objectname)', `refs/heads/${branch}`])
    const fields = listing.stdout.trim().split('\n').map(line => line.split('\x1f')).find(f => f[0] === `refs/heads/${branch}`)
    if (!fields) return { status: empty }
    const [, configured, remote, destination, sha] = fields
    const upstream = originBranch ? `refs/remotes/origin/${branch}` : configured
    if (!upstream || (!originBranch && (!remote || remote === '.'))) return { status: empty }
    const counts = await runGit(path, ['rev-list', '--left-right', '--count', `refs/heads/${branch}...${upstream}`, '--'])
    if (counts.exitCode) return { status: { ...empty, reason: 'The upstream branch is unavailable. Refresh and retry.' } }
    const [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number)
    const diverged = ahead > 0 && behind > 0
    return { remote, destination, sha, status: { branch, upstream, ahead, behind,
      canPull: behind > 0 && ahead === 0, canPush: ahead > 0 && behind === 0,
      reason: diverged ? 'Local and remote history have diverged. Resolve this in your Git client.' : ahead ? `${ahead} commit(s) ahead of ${upstream.replace('refs/remotes/', '')}.` : behind ? `${behind} commit(s) behind ${upstream.replace('refs/remotes/', '')}.` : 'Branch is up to date.',
    } satisfies BranchSync }
  }
  async function branchSync(id: string, originBranch?: string) {
    const repo = await resolveRepository(id)
    if (!repo) return null
    const status = (await inspect(repo.absolutePath, originBranch)).status
    const [refs, head] = await Promise.all([
      runGit(repo.absolutePath, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes', 'refs/tags']),
      runGit(repo.absolutePath, ['rev-parse', '--verify', 'HEAD']),
    ])
    if (refs.exitCode !== 0) throw new Error('Could not inspect repository refs.')
    const revision = createHash('sha256').update(refs.stdout).update(head.stdout).update(status.branch ?? '').digest('hex')
    return { ...status, revision }
  }
  async function push(id: string, expectedBranch: string) {
    const repo = await resolveRepository(id)
    if (!repo) return null
    const path = repo.absolutePath
    const fail = (message: string) => ({ success: false, message })
    if (busyRepositories.has(path)) return fail('Another Git action is running. Try again when it finishes.')
    busyRepositories.add(path)
    try {
      const initial = await inspect(path)
      if (initial.status.branch !== expectedBranch || !initial.status.canPush || !initial.remote || !initial.destination?.startsWith('refs/heads/') || !initial.sha) return fail('Push skipped: refresh the graph; the current branch must be ahead of its upstream.')
      const fetched = await fetchRemote(path, initial.remote, networkTimeoutMs)
      if (fetched.exitCode) return fail(`Push cancelled before upload: ${fetched.stderr}`)
      const current = await inspect(path)
      if (current.status.branch !== expectedBranch || current.sha !== initial.sha || current.remote !== initial.remote || current.destination !== initial.destination || !current.status.canPush) return fail('Push skipped: the branch or remote changed. Refresh and retry.')
      // Pin the source commit and destination; Git rejects non-fast-forward updates.
      // Disable user-configured mirror/follow-tags so this action sends one branch only.
      const result = await runRemoteCommand(path, ['-c', `remote.${current.remote}.mirror=false`, 'push', '--porcelain', '--no-force', '--no-follow-tags', '--recurse-submodules=no', '--', current.remote!, `${current.sha}:${current.destination}`], networkTimeoutMs, 'Push timed out; remote acceptance is unknown. Refresh and verify the remote before retrying.')
      const message = (result.stderr || result.stdout).replace(/(https?:\/\/)[^\s/]*@/gi, '$1[redacted]@').trim().slice(0, 2000)
      return result.exitCode ? fail(`Push refused: ${message}`) : { success: true, message: `Pushed ${expectedBranch} to ${current.status.upstream?.replace('refs/remotes/', '')}.` }
    } catch { return fail('Push failed. Refresh to check remote state before retrying.') }
    finally { busyRepositories.delete(path) }
  }
  return { branchSync, push }
}
