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
