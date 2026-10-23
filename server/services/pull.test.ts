import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createGitService } from './git'
import { createServedRootRepositorySet } from './repository-set'

const root = mkdtempSync(join(tmpdir(), 'gg-pull-tests-'))
const served = join(root, 'served')
mkdirSync(served)
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0' }
const ignore = '# Secrets\n.env\n.env/\n# Packages\nnode_modules/\n# Data\n# Cache\n'
let count = 0
function git(path: string, ...args: string[]) {
  const p = Bun.spawnSync(['git', '-C', path, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { env })
  if (p.exitCode !== 0) throw new Error(p.stderr.toString())
  return p.stdout.toString().trim()
}
function fixture(timeout = 30_000) {
  const id = `client-${++count}`
  const remote = join(root, `remote-${count}.git`)
  const seed = join(root, `seed-${count}`)
  const client = join(served, id)
  for (const path of [remote, seed]) { mkdirSync(path); writeFileSync(join(path, '.gitignore'), ignore) }
  git(remote, 'init', '--bare', '-q')
  git(seed, 'init', '-q', '-b', 'main')
  writeFileSync(join(seed, 'file.txt'), 'base\n')
  git(seed, 'add', '.'); git(seed, 'commit', '-qm', 'base')
  git(seed, 'remote', 'add', 'origin', remote); git(seed, 'push', '-qu', 'origin', 'main')
  git(served, 'clone', '-q', '-b', 'main', remote, client)
  let clock = 1000
  const service = createGitService({ repositories: createServedRootRepositorySet(served), now: () => clock, networkTimeoutMs: timeout })
  const advance = () => { clock += 300_001 }
  const publish = () => {
    writeFileSync(join(seed, 'file.txt'), `remote ${Date.now()}\n`)
    git(seed, 'commit', '-qam', 'remote update'); git(seed, 'push', '-q', 'origin', 'main')
    return git(seed, 'rev-parse', 'HEAD')
  }
  return { id, client, seed, remote, service, advance, publish }
}
async function waitForMarker(marker: string) {
  for (let i = 0; i < 200 && !existsSync(marker); i++) await Bun.sleep(10)
  expect(existsSync(marker)).toBe(true)
}
function slowUploadPack(client: string, delay = '0.4') {
  const script = join(root, `upload-${count}.sh`)
  const marker = `${script}.started`
  writeFileSync(script, `#!/bin/sh\nprintf started > '${marker}'\nsleep ${delay}\nexec git-upload-pack "$@"\n`)
  chmodSync(script, 0o700)
  git(client, 'config', 'remote.origin.uploadpack', script)
  return marker
}
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('safe pull', () => {
  test('downloads and fast-forwards files without a merge commit or stash', async () => {
    const f = fixture(); const target = f.publish()
    const result = await f.service.pull(f.id)
    expect(result).toMatchObject({ ok: true, result: { state: 'updated', code: 'fast-forward', fetched: true, branch: 'main' } })
    expect(git(f.client, 'rev-parse', 'HEAD')).toBe(target)
    expect(git(f.client, 'status', '--porcelain')).toBe('')
    expect(git(f.client, 'stash', 'list')).toBe('')
    expect(await Bun.file(join(f.client, 'file.txt')).text()).toBe(await Bun.file(join(f.seed, 'file.txt')).text())
  })
  for (const dirty of ['unstaged', 'staged', 'untracked']) {
    test(`skips ${dirty} changes before networking`, async () => {
      const f = fixture(); f.publish(); const before = git(f.client, 'rev-parse', 'HEAD')
      writeFileSync(join(f.client, dirty === 'untracked' ? 'new.txt' : 'file.txt'), 'keep\n')
      if (dirty === 'staged') git(f.client, 'add', 'file.txt')
      const outcome = await f.service.pull(f.id)
      expect(outcome).toMatchObject({ ok: true, result: { state: 'skipped', code: 'dirty', fetched: false } })
      expect(git(f.client, 'rev-parse', 'HEAD')).toBe(before)
      expect(git(f.client, 'stash', 'list')).toBe('')
    })
  }
  test('skips divergent branches and preserves local commits', async () => {
    const f = fixture(); f.publish(); git(f.client, 'commit', '--allow-empty', '-qm', 'local')
    const before = git(f.client, 'rev-parse', 'HEAD')
    expect(await f.service.pull(f.id)).toMatchObject({ ok: true, result: { state: 'skipped', code: 'diverged', fetched: true } })
    expect(git(f.client, 'rev-parse', 'HEAD')).toBe(before)
  })
  test('an ahead-only branch is left alone', async () => {
    const f = fixture(); git(f.client, 'commit', '--allow-empty', '-qm', 'local')
    expect(await f.service.pull(f.id)).toMatchObject({ ok: true, result: { state: 'up-to-date', code: 'ahead' } })
  })
  test('detached HEAD, missing upstream and active Git operations are skipped', async () => {
    const f = fixture(); git(f.client, 'checkout', '--detach', '-q')
    expect(await f.service.pull(f.id, { manual: true })).toMatchObject({ ok: true, result: { code: 'no-branch' } })
    git(f.client, 'checkout', '-q', 'main'); git(f.client, 'branch', '--unset-upstream')
    expect(await f.service.pull(f.id, { manual: true })).toMatchObject({ ok: true, result: { code: 'no-upstream' } })
    git(f.client, 'branch', '--set-upstream-to=origin/main')
    writeFileSync(join(f.client, '.git', 'MERGE_HEAD'), git(f.client, 'rev-parse', 'HEAD') + '\n')
    expect(await f.service.pull(f.id, { manual: true })).toMatchObject({ ok: true, result: { code: 'operation-in-progress' } })
  })
  test('automatic attempts deduplicate across tabs while manual checks can retry', async () => {
    const f = fixture()
    expect(await f.service.pull(f.id)).toMatchObject({ ok: true, result: { code: 'current' } })
    const target = f.publish()
    expect(await f.service.pull(f.id)).toMatchObject({ ok: true, result: { code: 'recently-checked', fetched: false } })
    expect(await f.service.pull(f.id, { manual: true })).toMatchObject({ ok: true, result: { state: 'updated' } })
    expect(git(f.client, 'rev-parse', 'HEAD')).toBe(target)
    f.advance()
    expect(await f.service.pull(f.id)).toMatchObject({ ok: true, result: { code: 'current' } })
  })
  test('rechecks dirty files after the network phase', async () => {
    const f = fixture(); f.publish(); const before = git(f.client, 'rev-parse', 'HEAD'); const marker = slowUploadPack(f.client)
    const operation = f.service.pull(f.id)
    await waitForMarker(marker); writeFileSync(join(f.client, 'new.txt'), 'keep\n')
    expect(await operation).toMatchObject({ ok: true, result: { state: 'skipped', code: 'dirty', fetched: true } })
    expect(git(f.client, 'rev-parse', 'HEAD')).toBe(before)
    expect(await Bun.file(join(f.client, 'new.txt')).text()).toBe('keep\n')
  })
  test('branch switches during download are not fast-forwarded', async () => {
    const f = fixture(); f.publish(); git(f.client, 'branch', 'other'); const before = git(f.client, 'rev-parse', 'HEAD')
    const marker = slowUploadPack(f.client); const operation = f.service.pull(f.id)
    await waitForMarker(marker); git(f.client, 'switch', '-q', 'other')
    expect(await operation).toMatchObject({ ok: true, result: { code: 'branch-changed' } })
    expect(git(f.client, 'rev-parse', 'HEAD')).toBe(before)
    expect(git(f.client, 'branch', '--show-current')).toBe('other')
  })
  test('serializes pulls and checkouts of the same repository', async () => {
    const f = fixture(); f.publish(); git(f.client, 'branch', 'other'); const marker = slowUploadPack(f.client)
    const operation = f.service.pull(f.id); await waitForMarker(marker)
    expect(await f.service.pull(f.id, { manual: true })).toMatchObject({ ok: true, result: { code: 'busy' } })
    expect(await f.service.checkout(f.id, { kind: 'branch', name: 'other' })).toMatchObject({ ok: false, reason: 'repository-busy' })
    expect(await operation).toMatchObject({ ok: true, result: { state: 'updated' } })
  })
  test('network errors and deadlines leave local HEAD unchanged', async () => {
    const f = fixture(100); f.publish(); const before = git(f.client, 'rev-parse', 'HEAD')
    slowUploadPack(f.client, '5')
    expect(await f.service.pull(f.id)).toMatchObject({ ok: true, result: { state: 'error', code: 'timeout' } })
    expect(git(f.client, 'rev-parse', 'HEAD')).toBe(before)
    git(f.client, 'config', '--unset', 'remote.origin.uploadpack'); git(f.client, 'remote', 'set-url', 'origin', join(root, 'missing'))
    expect(await f.service.pull(f.id, { manual: true })).toMatchObject({ ok: true, result: { state: 'error', code: 'fetch-failed' } })
    expect(git(f.client, 'rev-parse', 'HEAD')).toBe(before)
  })
  test('configured squash/autostash/rebase preferences cannot change the fast-forward-only contract', async () => {
    const f = fixture(); const target = f.publish()
    git(f.client, 'config', 'branch.main.mergeOptions', '--squash')
    git(f.client, 'config', 'merge.autostash', 'true'); git(f.client, 'config', 'pull.rebase', 'true')
    expect(await f.service.pull(f.id)).toMatchObject({ ok: true, result: { state: 'updated' } })
    expect(git(f.client, 'rev-parse', 'HEAD')).toBe(target)
    expect(git(f.client, 'status', '--porcelain')).toBe('')
  })
  test('rejects repositories outside the served set', async () => {
    const f = fixture()
    expect(await f.service.pull('../')).toEqual({ ok: false, reason: 'unknown-repository' })
    expect(await f.service.pull(f.seed)).toEqual({ ok: false, reason: 'unknown-repository' })
  })
  test('never overwrites an ignored local file that upstream starts tracking', async () => {
    const f = fixture(); const before = git(f.client, 'rev-parse', 'HEAD')
    writeFileSync(join(f.client, '.git', 'info', 'exclude'), 'local.conf\n')
    writeFileSync(join(f.client, 'local.conf'), 'keep my local configuration\n')
    writeFileSync(join(f.seed, 'local.conf'), 'remote configuration\n')
    git(f.seed, 'add', 'local.conf'); git(f.seed, 'commit', '-qm', 'track configuration'); git(f.seed, 'push', '-q', 'origin', 'main')
    expect(git(f.client, 'status', '--porcelain')).toBe('')
    expect(await f.service.pull(f.id)).toMatchObject({ ok: true, result: { state: 'error', code: 'update-refused' } })
    expect(git(f.client, 'rev-parse', 'HEAD')).toBe(before)
    expect(await Bun.file(join(f.client, 'local.conf')).text()).toBe('keep my local configuration\n')
  })
})

describe('branch sync controls', () => {
  test('counts current branch, pulls only the expected branch, and disables detached HEAD', async () => {
    const f = fixture(); f.publish()
    git(f.client, 'fetch', '-q', 'origin')
    expect(await f.service.branchSync(f.id)).toMatchObject({ branch: 'main', ahead: 0, behind: 1, canPull: true, canPush: false })
    expect(await f.service.pull(f.id, { manual: true, expectedBranch: 'other' })).toMatchObject({ result: { code: 'branch-changed', fetched: false } })
    expect(await f.service.pull(f.id, { manual: true, expectedBranch: 'main' })).toMatchObject({ result: { state: 'updated' } })
    git(f.client, 'switch', '--detach', '-q')
    expect(await f.service.branchSync(f.id)).toMatchObject({ branch: null, canPull: false, canPush: false })
  })
  test('confirmed origin pull switches an existing local branch and updates files', async () => {
    const f = fixture(); const sha = f.publish()
    git(f.client, 'fetch', '-q', 'origin'); git(f.client, 'switch', '-qc', 'other')
    expect(await f.service.branchSync(f.id, 'main')).toMatchObject({ behind: 1, canPull: true })
    expect(await f.service.pull(f.id, { manual: true, originBranch: 'main' })).toMatchObject({ result: { state: 'updated', branch: 'main' } })
    expect(git(f.client, 'branch', '--show-current')).toBe('main')
    expect(git(f.client, 'rev-parse', 'HEAD')).toBe(sha)
  })
  test('origin pull refuses dirty worktree without switching', async () => {
    const f = fixture(); f.publish(); git(f.client, 'switch', '-qc', 'other')
    writeFileSync(join(f.client, 'file.txt'), 'keep\n')
    expect(await f.service.pull(f.id, { manual: true, originBranch: 'main' })).toMatchObject({ result: { code: 'dirty' } })
    expect(git(f.client, 'branch', '--show-current')).toBe('other')
  })
  test('push updates exactly the upstream branch and rejects stale branch requests', async () => {
    const f = fixture(); git(f.client, 'commit', '--allow-empty', '-qm', 'local')
    const sha = git(f.client, 'rev-parse', 'HEAD')
    expect(await f.service.branchSync(f.id)).toMatchObject({ ahead: 1, behind: 0, canPush: true, canPull: false })
    expect(await f.service.push(f.id, 'other')).toMatchObject({ success: false })
    expect(await f.service.push(f.id, 'main')).toMatchObject({ success: true })
    expect(git(f.remote, 'rev-parse', 'refs/heads/main')).toBe(sha)
    expect(await f.service.branchSync(f.id)).toMatchObject({ canPush: false, canPull: false })
  })
  test('divergence disables both directions and a fresh remote advance prevents push', async () => {
    const f = fixture(); git(f.client, 'commit', '--allow-empty', '-qm', 'local')
    const sha = f.publish()
    expect(await f.service.push(f.id, 'main')).toMatchObject({ success: false })
    expect(git(f.remote, 'rev-parse', 'refs/heads/main')).toBe(sha)
    expect(await f.service.branchSync(f.id)).toMatchObject({ ahead: 1, behind: 1, canPull: false, canPush: false })
  })
  test('missing branches and unknown repositories fail closed', async () => {
    const f = fixture()
    expect(await f.service.branchSync(f.id, 'missing')).toMatchObject({ canPull: false, canPush: false })
    expect(await f.service.pull(f.id, { manual: true, originBranch: 'missing' })).toMatchObject({ result: { code: 'unknown-branch' } })
    expect(await f.service.branchSync('../outside')).toBeNull()
    expect(await f.service.push('../outside', 'main')).toBeNull()
  })
})

describe('fetch all remotes', () => {
  test('downloads all branches across remotes while preserving dirty files and local branch tips', async () => {
    const f = fixture(); const other = fixture()
    const originalHead = git(f.client, 'rev-parse', 'HEAD')
    git(f.client, 'branch', 'feature')
    git(f.seed, 'switch', '-qc', 'feature'); git(f.seed, 'commit', '--allow-empty', '-qm', 'feature update')
    git(f.seed, 'push', '-q', 'origin', 'feature')
    const featureHead = git(f.seed, 'rev-parse', 'HEAD')
    git(f.seed, 'switch', '-q', 'main'); const mainHead = f.publish(); const otherHead = other.publish()
    git(f.client, 'remote', 'add', 'fork/team', other.remote)
    git(f.client, 'config', 'remote.fork/team.skipFetchAll', 'true')
    // A single-branch clone/config must still discover the other branches.
    git(f.client, 'config', '--replace-all', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main')
    writeFileSync(join(f.client, 'file.txt'), 'unsaved work\n')
    const result = await f.service.fetchAll(f.id, { manual: true })
    expect(result).toMatchObject({ ok: true, result: { code: 'all-remotes', fetched: true, branch: null } })
    expect(git(f.client, 'rev-parse', 'refs/remotes/origin/main')).toBe(mainHead)
    expect(git(f.client, 'rev-parse', 'refs/remotes/origin/feature')).toBe(featureHead)
    expect(git(f.client, 'rev-parse', 'refs/remotes/fork/team/main')).toBe(otherHead)
    expect(git(f.client, 'rev-parse', 'HEAD')).toBe(originalHead)
    expect(git(f.client, 'rev-parse', 'refs/heads/feature')).toBe(originalHead)
    expect(await Bun.file(join(f.client, 'file.txt')).text()).toBe('unsaved work\n')
    expect(await f.service.branchSync(f.id)).toMatchObject({ behind: 1, canPull: true })
  })
  test('works in detached HEAD and ignores custom fetch destinations in local heads', async () => {
    const f = fixture(); const target = f.publish()
    git(f.client, 'branch', 'victim'); const before = git(f.client, 'rev-parse', 'HEAD')
    git(f.client, 'switch', '--detach', '-q')
    git(f.client, 'config', '--replace-all', 'remote.origin.fetch', '+refs/heads/main:refs/heads/victim')
    expect(await f.service.fetchAll(f.id)).toMatchObject({ result: { code: 'all-remotes' } })
    expect(git(f.client, 'rev-parse', 'refs/remotes/origin/main')).toBe(target)
    expect(git(f.client, 'rev-parse', 'HEAD')).toBe(before)
    expect(git(f.client, 'rev-parse', 'refs/heads/victim')).toBe(before)
    expect(git(f.client, 'branch', '--show-current')).toBe('')
  })
  test('prunes deleted remote branches while preserving same-named local branches', async () => {
    const f = fixture()
    git(f.seed, 'branch', 'retired'); git(f.seed, 'push', '-q', 'origin', 'retired')
    git(f.client, 'fetch', '-q', 'origin'); git(f.client, 'branch', 'retired', 'refs/remotes/origin/retired')
    const before = git(f.client, 'rev-parse', 'refs/heads/retired')
    git(f.seed, 'push', '-q', 'origin', '--delete', 'retired')
    expect(await f.service.fetchAll(f.id)).toMatchObject({ result: { code: 'all-remotes' } })
    expect(git(f.client, 'for-each-ref', '--format=%(refname)', 'refs/remotes/origin/retired')).toBe('')
    expect(git(f.client, 'rev-parse', 'refs/heads/retired')).toBe(before)
  })
  test('deduplicates automatic sync but manual retry bypasses the interval', async () => {
    const f = fixture()
    expect(await f.service.fetchAll(f.id)).toMatchObject({ result: { code: 'all-remotes' } })
    const target = f.publish()
    expect(await f.service.fetchAll(f.id)).toMatchObject({ result: { code: 'recently-checked', fetched: false } })
    expect(await f.service.fetchAll(f.id, { manual: true })).toMatchObject({ result: { code: 'all-remotes' } })
    expect(git(f.client, 'rev-parse', 'refs/remotes/origin/main')).toBe(target)
    f.advance()
    expect(await f.service.fetchAll(f.id)).toMatchObject({ result: { code: 'all-remotes' } })
  })
  test('continues after one remote fails and exposes partial success', async () => {
    const f = fixture(); const target = f.publish()
    git(f.client, 'remote', 'add', 'broken', join(root, 'missing-remote.git'))
    expect(await f.service.fetchAll(f.id, { manual: true })).toMatchObject({ result: { state: 'error', code: 'fetch-failed', fetched: true, message: expect.stringContaining('1/2 remotes succeeded') } })
    expect(git(f.client, 'rev-parse', 'refs/remotes/origin/main')).toBe(target)
  })
  test('shares the checkout lock and refuses unknown repositories', async () => {
    const f = fixture(); const marker = slowUploadPack(f.client)
    const pending = f.service.fetchAll(f.id)
    await waitForMarker(marker)
    expect(await f.service.fetchAll(f.id, { manual: true })).toMatchObject({ result: { code: 'busy' } })
    expect(await f.service.checkout(f.id, { kind: 'branch', name: 'main' })).toMatchObject({ ok: false, reason: 'repository-busy' })
    await pending
    expect(await f.service.fetchAll('../outside')).toMatchObject({ ok: false, reason: 'unknown-repository' })
    git(f.client, 'remote', 'remove', 'origin')
    expect(await f.service.fetchAll(f.id, { manual: true })).toMatchObject({ result: { code: 'no-remotes', fetched: false } })
  })
})

describe('external Git graph invalidation', () => {
  test('revision changes on external commit/push, and stays stable on unchanged reads', async () => {
    const f = fixture()
    const base = await f.service.branchSync(f.id)
    expect((await f.service.branchSync(f.id))?.revision).toBe(base?.revision)
    git(f.client, 'commit', '--allow-empty', '-qm', 'external local commit')
    const committed = await f.service.branchSync(f.id)
    expect(committed).toMatchObject({ ahead: 1, behind: 0, canPush: true })
    expect(committed?.revision).not.toBe(base?.revision)
    git(f.client, 'push', '-q', 'origin', 'main')
    const pushed = await f.service.branchSync(f.id)
    expect(pushed).toMatchObject({ ahead: 0, behind: 0, canPush: false })
    expect(pushed?.revision).not.toBe(committed?.revision)
  })
  test('non-current refs and same-tip checkouts invalidate the graph too', async () => {
    const f = fixture(); const base = await f.service.branchSync(f.id)
    git(f.client, 'branch', 'sibling')
    const added = await f.service.branchSync(f.id)
    expect(added?.revision).not.toBe(base?.revision)
    git(f.client, 'switch', '-q', 'sibling')
    expect((await f.service.branchSync(f.id))?.revision).not.toBe(added?.revision)
    git(f.client, 'switch', '--detach', '-q')
    const detached = await f.service.branchSync(f.id)
    git(f.client, 'checkout', '-q', 'HEAD~0')
    expect((await f.service.branchSync(f.id))?.revision).toBe(detached?.revision)
    git(f.client, 'commit', '--allow-empty', '-qm', 'detached commit')
    expect((await f.service.branchSync(f.id))?.revision).not.toBe(detached?.revision)
  })
})
