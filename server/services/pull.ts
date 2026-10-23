import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { AUTO_PULL_INTERVAL_MS, type PullResult } from '../../shared/pull'

type GitOutput = { stdout: string; stderr: string; exitCode: number }
type RunGit = (path: string, args: string[]) => Promise<GitOutput>
type Repository = { absolutePath: string; name: string }

const sanitizeError = (text: string) => text.replace(/(https?:\/\/)[^\s/]*@/gi, '$1[redacted]@').trim().slice(0, 2000)

/** Only the download phase is timed out; never terminate a working-tree update. */
export function fetchRemote(path: string, remote: string, timeoutMs: number): Promise<GitOutput> {
  return runRemoteCommand(path, ['fetch', '--quiet', '--no-recurse-submodules', '--no-write-fetch-head', '--', remote], timeoutMs,
    'The remote fetch timed out. No local fast-forward was attempted.')
}

export async function runRemoteCommand(path: string, args: string[], timeoutMs: number, timeoutMessage: string): Promise<GitOutput> {
  const child = Bun.spawn(['git', '-C', path, ...args], {
    detached: true,
    stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', SSH_ASKPASS_REQUIRE: 'never' },
  })
  let timedOut = false
  let hardStop: ReturnType<typeof setTimeout> | undefined
  const stop = (signal: 'SIGTERM' | 'SIGKILL') => {
    try { process.kill(-child.pid, signal) } catch { try { child.kill(signal) } catch { /* Already stopped. */ } }
  }
  const timer = setTimeout(() => {
    timedOut = true
    stop('SIGTERM')
    hardStop = setTimeout(() => stop('SIGKILL'), 1000)
  }, timeoutMs)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    return { stdout, stderr: timedOut ? timeoutMessage : sanitizeError(stderr), exitCode: timedOut ? 124 : exitCode }
  } finally {
    clearTimeout(timer)
    if (hardStop !== undefined) clearTimeout(hardStop)
  }
}

export function createPullService({ resolveRepository, runGit, busyRepositories, now = Date.now, networkTimeoutMs = 30_000 }: {
  resolveRepository: (identifier: string) => Promise<Repository | undefined>
  runGit: RunGit
  busyRepositories: Set<string>
  now?: () => number
  networkTimeoutMs?: number
}) {
  const lastAttempt = new Map<string, number>()
  const lastFetchAttempt = new Map<string, number>()

  async function snapshot(path: string) {
    const [branch, head, status, directory] = await Promise.all([
      runGit(path, ['symbolic-ref', '-q', 'HEAD']),
      runGit(path, ['rev-parse', '--verify', 'HEAD']),
      runGit(path, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']),
      runGit(path, ['rev-parse', '--git-dir']),
    ])
    if (status.exitCode !== 0 || directory.exitCode !== 0) throw new Error(status.stderr || directory.stderr)
    const gitDirectory = resolve(path, directory.stdout.trim())
    const inProgress = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer']
      .some((marker) => existsSync(join(gitDirectory, marker)))
    const ref = branch.exitCode === 0 ? branch.stdout.trim() : ''
    const tracking = ref ? await runGit(path, ['for-each-ref', '--format=%(upstream)%1f%(upstream:remotename)', ref]) : null
    // for-each-ref uses %1f rather than pretty-format's %x1f escape.
    const fields = tracking?.exitCode === 0 ? tracking.stdout.trim().split('\x1f') : []
    return { ref, head: head.exitCode === 0 ? head.stdout.trim() : '', dirty: status.stdout.length > 0, inProgress,
      upstream: fields[0] ?? '', remote: fields[1] ?? '' }
  }

  async function pull(identifier: string, { manual = false, expectedBranch, originBranch }: { manual?: boolean; expectedBranch?: string; originBranch?: string } = {}) {
    const repository = await resolveRepository(identifier)
    if (!repository) return { ok: false as const, reason: 'unknown-repository' as const }
    const path = repository.absolutePath
    let branch: string | null = null
    let fetched = false
    const result = (state: PullResult['state'], code: string, message: string) => ({
      ok: true as const, result: { state, code, message, branch, fetched, checkedAt: new Date(now()).toISOString() },
    })
    if (busyRepositories.has(path)) return result('skipped', 'busy', 'Pull skipped: another Git action is running.')
    const previous = lastAttempt.get(path)
    if (!manual && previous !== undefined && now() - previous < AUTO_PULL_INTERVAL_MS) {
      return result('skipped', 'recently-checked', 'Already checked recently in another tab.')
    }
    busyRepositories.add(path)
    lastAttempt.set(path, now())
    try {
      let initial = await snapshot(path)
      if (expectedBranch && initial.ref !== `refs/heads/${expectedBranch}`) return result('skipped', 'branch-changed', 'Pull skipped: the checked-out branch changed. Refresh and retry.')
      if (originBranch) {
        if (initial.dirty || initial.inProgress) return result('skipped', 'dirty', 'Pull skipped: finish the Git operation and commit or stash your changes first.')
        const valid = await runGit(path, ['check-ref-format', `refs/heads/${originBranch}`])
        const local = await runGit(path, ['show-ref', '--verify', '--quiet', `refs/heads/${originBranch}`])
        const remote = await runGit(path, ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${originBranch}`])
        if (valid.exitCode || local.exitCode || remote.exitCode || originBranch === 'HEAD') return result('skipped', 'unknown-branch', 'The local or origin branch no longer exists.')
        if (initial.ref !== `refs/heads/${originBranch}`) {
          const switched = await runGit(path, ['switch', '--no-guess', '--no-overwrite-ignore', '--', originBranch])
          if (switched.exitCode) return result('error', 'switch-refused', sanitizeError(switched.stderr))
        }
        initial = await snapshot(path)
        if (initial.ref !== `refs/heads/${originBranch}`) return result('skipped', 'branch-changed', 'The branch changed. Refresh and retry.')
      }
      branch = initial.ref.startsWith('refs/heads/') ? initial.ref.slice('refs/heads/'.length) : null
      if (initial.inProgress) return result('skipped', 'operation-in-progress', 'Pull skipped: finish the merge, rebase, or cherry-pick first.')
      if (initial.dirty) return result('skipped', 'dirty', 'Pull skipped: the working tree has uncommitted changes.')
      if (!branch || !initial.head) return result('skipped', 'no-branch', 'Pull skipped: check out a branch with commits first.')
      const pullRemote = originBranch ? 'origin' : initial.remote
      const pullUpstream = originBranch ? `refs/remotes/origin/${originBranch}` : initial.upstream
      if (!pullUpstream || !pullRemote || pullRemote === '.') return result('skipped', 'no-upstream', 'Pull skipped: this branch has no remote upstream.')
      const remotes = await runGit(path, ['remote'])
      if (remotes.exitCode !== 0 || !remotes.stdout.split('\n').includes(pullRemote)) {
        return result('skipped', 'no-upstream', 'Pull skipped: the upstream remote is unavailable.')
      }
      const downloaded = await fetchRemote(path, pullRemote, networkTimeoutMs)
      if (downloaded.exitCode !== 0) return result('error', downloaded.exitCode === 124 ? 'timeout' : 'fetch-failed', `Pull failed: ${downloaded.stderr || 'remote fetch failed'}`)
      fetched = true
      const current = await snapshot(path)
      if (current.ref !== initial.ref || current.head !== initial.head || current.upstream !== initial.upstream || current.remote !== initial.remote) {
        return result('skipped', 'branch-changed', 'Fetched; pull skipped because the branch changed during download.')
      }
      if (current.dirty || current.inProgress) return result('skipped', 'dirty', 'Fetched; pull skipped because the working tree changed during download.')
      const upstream = await runGit(path, ['rev-parse', '--verify', '--end-of-options', `${pullUpstream}^{commit}`])
      if (upstream.exitCode !== 0) return result('skipped', 'upstream-missing', 'Fetched; the upstream branch is no longer available.')
      const target = upstream.stdout.trim()
      if (target === current.head) return result('up-to-date', 'current', `${branch} is up to date.`)
      const canAdvance = await runGit(path, ['merge-base', '--is-ancestor', current.head, target])
      if (canAdvance.exitCode !== 0) {
        const isAhead = await runGit(path, ['merge-base', '--is-ancestor', target, current.head])
        if (isAhead.exitCode === 0) return result('up-to-date', 'ahead', `${branch} has local commits; nothing to pull.`)
        return result('skipped', 'diverged', 'Fetched; pull skipped because local and upstream history have diverged.')
      }
      // Recheck immediately before updating files. The service-wide writer lock
      // prevents this app's checkouts from changing the branch during a pull.
      const final = await snapshot(path)
      if (final.ref !== current.ref || final.head !== current.head || final.upstream !== current.upstream || final.remote !== current.remote || final.dirty || final.inProgress) {
        return result('skipped', 'worktree-changed', 'Fetched; pull skipped because the repository changed before fast-forwarding.')
      }
      const merged = await runGit(path, ['-c', 'merge.autostash=false', 'merge', '--ff-only', '--no-squash', '--no-edit', '--no-autostash', '--no-overwrite-ignore', '--no-stat', target])
      if (merged.exitCode !== 0) return result('error', 'update-refused', `Pull refused: ${sanitizeError(merged.stderr || merged.stdout)}`)
      const completed = await snapshot(path)
      if (completed.ref !== current.ref || completed.head !== target) return result('error', 'unexpected-head', 'Git finished, but the branch changed. Review the repository before retrying.')
      return result('updated', 'fast-forward', `Pulled ${branch} to ${target.slice(0, 8)}.`)
    } catch (error) {
      return result('error', 'git-failed', `Pull failed: ${sanitizeError(error instanceof Error ? error.message : 'Git failed')}`)
    } finally {
      busyRepositories.delete(path)
    }
  }
  /** Refresh every configured remote without touching local branches or files. */
  async function fetchAll(identifier: string, { manual = false }: { manual?: boolean } = {}) {
    const repository = await resolveRepository(identifier)
    if (!repository) return { ok: false as const, reason: 'unknown-repository' as const }
    const path = repository.absolutePath
    let fetched = false
    const result = (state: PullResult['state'], code: string, message: string) => ({
      ok: true as const, result: { state, code, message, branch: null, fetched, checkedAt: new Date(now()).toISOString() },
    })
    if (busyRepositories.has(path)) return result('skipped', 'busy', 'Sync skipped: another Git action is running.')
    const previous = lastFetchAttempt.get(path)
    if (!manual && previous !== undefined && now() - previous < AUTO_PULL_INTERVAL_MS) return result('skipped', 'recently-checked', 'All remotes were checked recently in another tab.')
    busyRepositories.add(path)
    lastFetchAttempt.set(path, now())
    try {
      const remotes = await runGit(path, ['remote'])
      if (remotes.exitCode !== 0) return result('error', 'git-failed', `Sync failed: ${sanitizeError(remotes.stderr)}`)
      const names = remotes.stdout.split('\n').filter(Boolean)
      if (names.length === 0) return result('skipped', 'no-remotes', 'This repository has no configured remotes.')
      const failures: string[] = []
      const before = await runGit(path, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes', 'refs/tags'])
      for (const remote of names) {
        // Explicit branch mapping includes branches even for single-branch clones,
        // overrides custom fetch destinations, and never writes refs/heads.
        // Explicit remote iteration also includes remotes marked skipFetchAll.
        fetched = true
        const download = await runRemoteCommand(path, ['-c', 'fetch.pruneTags=false', 'fetch', '--quiet', '--prune', '--no-prune-tags', '--refmap=', '--no-recurse-submodules', '--no-write-fetch-head', '--', remote,
          `+refs/heads/*:refs/remotes/${remote}/*`], networkTimeoutMs, `Fetching ${remote} timed out. Some remote refs may have updated; local branches are unchanged.`)
        if (download.exitCode !== 0) failures.push(`${remote}: ${download.stderr || 'fetch failed'}`)
      }
      if (failures.length) return result('error', 'fetch-failed', `Sync incomplete (${names.length - failures.length}/${names.length} remotes succeeded): ${failures.join('; ')}. Local branches are unchanged.`)
      const after = await runGit(path, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes', 'refs/tags'])
      return result(before.stdout === after.stdout ? 'up-to-date' : 'updated', 'all-remotes', `Fetched all ${names.length} remote(s), including all branches. Local branches are unchanged.`)
    } catch (error) {
      return result('error', 'git-failed', `Sync failed: ${sanitizeError(error instanceof Error ? error.message : 'Git failed')}`)
    } finally { busyRepositories.delete(path) }
  }
  return { pull, fetchAll }
}
