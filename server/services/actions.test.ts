import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGitService } from './git'
import { createServedRootRepositorySet } from './repository-set'
import type { RepositoryAction } from '../../shared/repositoryActions'

const root = mkdtempSync(join(tmpdir(), 'gg-actions-tests-'))
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0' }
let count = 0
function git(path: string, ...args: string[]) {
  const result = Bun.spawnSync(['git', '-C', path, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { env })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return result.stdout.toString().trim()
}
function fixture() {
  const id = `client-${++count}`; const path = join(root, id); mkdirSync(path)
  writeFileSync(join(path, '.gitignore'), '# Secrets\n.env\n.env/\n# Packages\n# Data\n# Cache\nignored.txt\n')
  git(path, 'init', '-q', '-b', 'main'); git(path, 'config', 'user.name', 'Fixture'); git(path, 'config', 'user.email', 'fixture@example.invalid')
  writeFileSync(join(path, 'file.txt'), 'base\n'); git(path, 'add', '.'); git(path, 'commit', '-qm', 'base')
  const base = git(path, 'rev-parse', 'HEAD')
  git(path, 'switch', '-qc', 'feature'); writeFileSync(join(path, 'feature.txt'), 'feature\n'); git(path, 'add', '.'); git(path, 'commit', '-qm', 'feature')
  const feature = git(path, 'rev-parse', 'HEAD'); git(path, 'switch', '-q', 'main')
  const remote = join(root, `remote-${count}.git`); mkdirSync(remote)
  writeFileSync(join(remote, '.gitignore'), '# Secrets\n# Packages\n# Data\n# Cache\n')
  git(remote, 'init', '--bare', '-q'); git(path, 'remote', 'add', 'origin', remote); git(path, 'push', '-qu', 'origin', 'main', 'feature')
  const service = createGitService({ repositories: createServedRootRepositorySet(root) })
  async function run(action: RepositoryAction) {
    const preview = await service.previewAction(id, action)
    if (!preview?.ok) throw new Error(`Preview refused: ${preview?.message}`)
    return service.executeAction(id, action, preview.value.token)
  }
  return { id, path, remote, service, base, feature, run }
}
afterAll(() => rmSync(root, { recursive: true, force: true }))

test('creates branches from a commit, optionally checks out, renames current and deletes a merged branch', async () => {
  const f = fixture()
  expect(await f.run({ kind: 'create-branch', commit: f.base, name: '实验/分支', checkout: false })).toMatchObject({ ok: true, value: { state: 'completed' } })
  expect(git(f.path, 'branch', '--show-current')).toBe('main')
  expect(await f.run({ kind: 'create-branch', commit: f.feature, name: 'work', checkout: true })).toMatchObject({ value: { state: 'completed', operation: { branch: 'work' } } })
  expect(git(f.path, 'rev-parse', 'HEAD')).toBe(f.feature)
  expect(await f.run({ kind: 'rename-branch', name: 'work', newName: 'renamed/work' })).toMatchObject({ value: { state: 'completed', operation: { branch: 'renamed/work' } } })
  git(f.path, 'switch', '-q', 'main')
  expect(await f.run({ kind: 'delete-branch', name: '实验/分支' })).toMatchObject({ value: { state: 'completed' } })
})

test('invalid names, existing names, unreachable commits and current-branch deletion fail closed', async () => {
  const f = fixture()
  for (const name of ['-bad', 'HEAD', 'bad..name', 'a b', '../escape']) expect(await f.service.previewAction(f.id, { kind: 'create-branch', commit: f.base, name, checkout: false })).toMatchObject({ ok: false, code: 'invalid-name' })
  expect(await f.service.previewAction(f.id, { kind: 'create-branch', commit: f.base, name: 'main', checkout: false })).toMatchObject({ ok: false, code: 'branch-exists' })
  expect(await f.service.previewAction(f.id, { kind: 'create-branch', commit: 'HEAD', name: 'new', checkout: false })).toMatchObject({ ok: false, code: 'missing-commit' })
  expect(await f.service.previewAction(f.id, { kind: 'delete-branch', name: 'main' })).toMatchObject({ ok: false, code: 'current-branch' })
  expect(await f.service.previewAction('../outside', { kind: 'delete-branch', name: 'main' })).toBeNull()
  expect(await f.service.executeAction('../outside', { kind: 'delete-branch', name: 'main' }, 'fake')).toBeNull()
})

test('branch deletion refuses an unmerged branch without losing its commits', async () => {
  const f = fixture(); git(f.path, 'branch', '--unset-upstream', 'feature')
  expect(await f.run({ kind: 'delete-branch', name: 'feature' })).toMatchObject({ value: { state: 'refused' } })
  expect(git(f.path, 'rev-parse', 'refs/heads/feature')).toBe(f.feature)
})

test('a changed HEAD or ref invalidates the reviewed token', async () => {
  const f = fixture(); const action: RepositoryAction = { kind: 'create-branch', commit: f.base, name: 'new', checkout: false }
  const preview = await f.service.previewAction(f.id, action); if (!preview?.ok) throw new Error('preview failed')
  git(f.path, 'commit', '--allow-empty', '-qm', 'external')
  expect(await f.service.executeAction(f.id, action, preview.value.token)).toMatchObject({ ok: false, code: 'stale-preview' })
  expect(git(f.path, 'for-each-ref', '--format=%(refname)', 'refs/heads/new')).toBe('')
})

test('merge creates a merge commit while ff-only refuses a diverged branch', async () => {
  const f = fixture(); git(f.path, 'commit', '--allow-empty', '-qm', 'main advance')
  expect(await f.run({ kind: 'merge', source: 'refs/heads/feature', mode: 'ff-only' })).toMatchObject({ value: { state: 'refused' } })
  expect(await f.run({ kind: 'merge', source: 'refs/heads/feature', mode: 'no-ff' })).toMatchObject({ value: { state: 'completed' } })
  expect(git(f.path, 'rev-list', '--parents', '-1', 'HEAD').split(' ')).toHaveLength(3)
  expect(await Bun.file(join(f.path, 'feature.txt')).text()).toBe('feature\n')
})

test('dirty merge/cherry-pick/checkout requests do not stash or change files', async () => {
  const f = fixture(); writeFileSync(join(f.path, 'file.txt'), 'keep\n')
  for (const action of [{ kind: 'merge', source: 'refs/heads/feature', mode: 'no-ff' }, { kind: 'cherry-pick', commit: f.feature }, { kind: 'create-branch', commit: f.base, name: 'new', checkout: true }] as RepositoryAction[]) {
    expect(await f.service.previewAction(f.id, action)).toMatchObject({ ok: false, code: 'worktree-dirty' })
  }
  expect(git(f.path, 'rev-parse', 'HEAD')).toBe(f.base); expect(git(f.path, 'stash', 'list')).toBe('')
  expect(await Bun.file(join(f.path, 'file.txt')).text()).toBe('keep\n')
})

async function makeConflict(f: ReturnType<typeof fixture>, kind: 'merge' | 'cherry-pick') {
  git(f.path, 'switch', '-q', 'feature'); writeFileSync(join(f.path, 'file.txt'), 'feature change\n'); git(f.path, 'commit', '-qam', 'conflicting feature')
  const commit = git(f.path, 'rev-parse', 'HEAD')
  git(f.path, 'switch', '-q', 'main'); writeFileSync(join(f.path, 'file.txt'), 'main change\n'); git(f.path, 'commit', '-qam', 'conflicting main')
  const action: RepositoryAction = kind === 'merge' ? { kind, source: 'refs/heads/feature', mode: 'no-ff' } : { kind, commit }
  expect(await f.run(action)).toMatchObject({ value: { state: 'conflict', operation: { operation: kind, conflicts: ['file.txt'] } } })
  return commit
}
for (const operation of ['merge', 'cherry-pick'] as const) {
  test(`${operation} conflicts can be resolved, staged and continued`, async () => {
    const f = fixture(); await makeConflict(f, operation)
    expect(await f.service.previewAction(f.id, { kind: 'operation', operation, command: 'continue' })).toMatchObject({ ok: false, code: 'unresolved-conflicts' })
    expect(await f.service.previewAction(f.id, { kind: 'delete-branch', name: 'feature' })).toMatchObject({ ok: false, code: 'operation-active' })
    writeFileSync(join(f.path, 'file.txt'), 'resolved\n'); git(f.path, 'add', 'file.txt')
    expect(await f.run({ kind: 'operation', operation, command: 'continue' })).toMatchObject({ value: { state: 'completed', operation: { operation: null } } })
    expect(await Bun.file(join(f.path, 'file.txt')).text()).toBe('resolved\n')
  })
  test(`${operation} conflicts can be aborted without changing the original branch tip`, async () => {
    const f = fixture(); await makeConflict(f, operation)
    const before = git(f.path, 'rev-parse', 'HEAD')
    expect(await f.run({ kind: 'operation', operation, command: 'abort' })).toMatchObject({ value: { state: 'completed', operation: { operation: null } } })
    expect(git(f.path, 'rev-parse', 'HEAD')).toBe(before)
    expect(await Bun.file(join(f.path, 'file.txt')).text()).toBe('main change\n')
  })
}

test('cherry-pick records its origin, and merge commits require a valid mainline', async () => {
  const f = fixture(); git(f.path, 'commit', '--allow-empty', '-qm', 'unrelated main')
  expect(await f.run({ kind: 'cherry-pick', commit: f.feature })).toMatchObject({ value: { state: 'completed' } })
  expect(git(f.path, 'log', '-1', '--format=%B')).toContain(`cherry picked from commit ${f.feature}`)
  const g = fixture(); await g.run({ kind: 'merge', source: 'refs/heads/feature', mode: 'no-ff' }); const merge = git(g.path, 'rev-parse', 'HEAD')
  git(g.path, 'switch', '-qc', 'test-mainline', g.base)
  expect(await g.service.previewAction(g.id, { kind: 'cherry-pick', commit: merge })).toMatchObject({ ok: false, code: 'mainline-required' })
  expect(await g.run({ kind: 'cherry-pick', commit: merge, mainline: 1 })).toMatchObject({ value: { state: 'completed' } })
})

test('empty cherry-picks can be skipped', async () => {
  const f = fixture(); await f.run({ kind: 'cherry-pick', commit: f.feature })
  expect(await f.run({ kind: 'cherry-pick', commit: f.feature })).toMatchObject({ value: { state: 'conflict', operation: { operation: 'cherry-pick' } } })
  expect(await f.run({ kind: 'operation', operation: 'cherry-pick', command: 'skip' })).toMatchObject({ value: { state: 'completed', operation: { operation: null } } })
})

test('cherry-pick protects ignored local files', async () => {
  const f = fixture(); git(f.path, 'switch', '-q', 'feature'); writeFileSync(join(f.path, 'ignored.txt'), 'upstream\n')
  git(f.path, 'add', '-f', 'ignored.txt'); git(f.path, 'commit', '-qm', 'track ignored file'); const sha = git(f.path, 'rev-parse', 'HEAD')
  git(f.path, 'switch', '-q', 'main'); writeFileSync(join(f.path, 'ignored.txt'), 'keep\n')
  expect(await f.service.previewAction(f.id, { kind: 'cherry-pick', commit: sha })).toMatchObject({ ok: false, code: 'ignored-collision' })
  expect(await Bun.file(join(f.path, 'ignored.txt')).text()).toBe('keep\n')
})

test('creates annotated and lightweight tags, refuses duplicate tags, and pushes/deletes only the selected tag', async () => {
  const f = fixture()
  expect(await f.run({ kind: 'create-tag', name: 'v1/发布', commit: f.base, annotated: true, message: 'Release notes\nMore details' })).toMatchObject({ value: { state: 'completed' } })
  expect(git(f.path, 'cat-file', '-t', 'refs/tags/v1/发布')).toBe('tag')
  expect(await f.run({ kind: 'create-tag', name: 'light', commit: f.base, annotated: false, message: '' })).toMatchObject({ value: { state: 'completed' } })
  expect(git(f.path, 'cat-file', '-t', 'refs/tags/light')).toBe('commit')
  expect(await f.service.previewAction(f.id, { kind: 'create-tag', name: 'light', commit: f.base, annotated: false, message: '' })).toMatchObject({ ok: false, code: 'tag-exists' })
  expect(await f.run({ kind: 'push-tag', name: 'v1/发布', remote: 'origin' })).toMatchObject({ value: { state: 'completed' } })
  expect(git(f.remote, 'for-each-ref', '--format=%(refname)', 'refs/tags')).toBe('refs/tags/v1/发布')
  expect(await f.run({ kind: 'delete-remote-tag', name: 'v1/发布', remote: 'origin' })).toMatchObject({ value: { state: 'completed' } })
  expect(git(f.path, 'cat-file', '-t', 'refs/tags/v1/发布')).toBe('tag')
  expect(await f.run({ kind: 'delete-tag', name: 'v1/发布' })).toMatchObject({ value: { state: 'completed' } })
})

test('remote branch deletion uses a lease and preserves the local branch', async () => {
  const f = fixture()
  expect(await f.run({ kind: 'delete-remote-branch', name: 'feature', remote: 'origin' })).toMatchObject({ value: { state: 'completed' } })
  expect(git(f.remote, 'for-each-ref', '--format=%(refname)', 'refs/heads/feature')).toBe('')
  expect(git(f.path, 'rev-parse', 'refs/heads/feature')).toBe(f.feature)
})

test('a concurrently advanced remote branch is not deleted', async () => {
  const f = fixture(); git(f.path, 'switch', '-q', 'feature'); git(f.path, 'commit', '--allow-empty', '-qm', 'external remote advance')
  const advanced = git(f.path, 'rev-parse', 'HEAD')
  // Copy the missing commit object into the bare remote without updating the local tracking ref.
  git(f.path, 'push', '-q', 'origin', 'feature:refs/heads/temp')
  git(f.remote, 'update-ref', 'refs/heads/feature', advanced)
  expect(await f.run({ kind: 'delete-remote-branch', name: 'feature', remote: 'origin' })).toMatchObject({ value: { state: 'refused' } })
  expect(git(f.remote, 'rev-parse', 'refs/heads/feature')).toBe(advanced)
})

test('branch rename and deletion refuse branches checked out in another worktree', async () => {
  const f = fixture(); const worktree = join(root, `linked-${count}`)
  git(f.path, 'worktree', 'add', '-q', worktree, 'feature')
  expect(await f.service.previewAction(f.id, { kind: 'rename-branch', name: 'feature', newName: 'renamed' })).toMatchObject({ ok: false, code: 'other-worktree' })
  expect(await f.service.previewAction(f.id, { kind: 'delete-branch', name: 'feature' })).toMatchObject({ ok: false, code: 'other-worktree' })
  expect(git(worktree, 'branch', '--show-current')).toBe('feature')
})

test('tag push cannot overwrite a different existing remote tag and never follows extra tags', async () => {
  const f = fixture(); git(f.path, 'tag', 'v1', f.base); git(f.path, 'push', '-q', 'origin', 'refs/tags/v1')
  git(f.path, 'tag', '-f', 'v1', f.feature); git(f.path, 'tag', 'unrelated', f.base)
  git(f.path, 'config', 'push.followTags', 'true')
  expect(await f.run({ kind: 'push-tag', name: 'v1', remote: 'origin' })).toMatchObject({ value: { state: 'refused' } })
  expect(git(f.remote, 'rev-parse', 'refs/tags/v1')).toBe(f.base)
  expect(git(f.remote, 'for-each-ref', '--format=%(refname)', 'refs/tags/unrelated')).toBe('')
  expect(await f.run({ kind: 'delete-remote-tag', name: 'v1', remote: 'origin' })).toMatchObject({ value: { state: 'refused' } })
  expect(git(f.remote, 'rev-parse', 'refs/tags/v1')).toBe(f.base)
})

test('renaming a branch refuses an existing target without moving either ref', async () => {
  const f = fixture()
  expect(await f.service.previewAction(f.id, { kind: 'rename-branch', name: 'feature', newName: 'main' })).toMatchObject({ ok: false, code: 'branch-exists' })
  expect(git(f.path, 'rev-parse', 'feature')).toBe(f.feature); expect(git(f.path, 'rev-parse', 'main')).toBe(f.base)
})

test('reviewed staged resolutions are revalidated before continuing', async () => {
  const f = fixture(); await makeConflict(f, 'merge')
  writeFileSync(join(f.path, 'file.txt'), 'resolved one\n'); git(f.path, 'add', 'file.txt')
  const action: RepositoryAction = { kind: 'operation', operation: 'merge', command: 'continue' }
  const preview = await f.service.previewAction(f.id, action); if (!preview?.ok) throw new Error('preview failed')
  writeFileSync(join(f.path, 'file.txt'), 'resolved two\n'); git(f.path, 'add', 'file.txt')
  expect(await f.service.executeAction(f.id, action, preview.value.token)).toMatchObject({ ok: false, code: 'stale-preview' })
  expect((await f.service.operationState(f.id))?.operation).toBe('merge')
})

test('an executing remote action shares its writer lock with checkout, fetch and pull', async () => {
  const f = fixture(); git(f.path, 'tag', 'locked-tag', f.base)
  const marker = join(root, `receive-${count}.started`)
  const script = join(f.remote, 'hooks', 'pre-receive')
  writeFileSync(script, `#!/bin/sh\nprintf started > '${marker}'\nsleep 0.5\nexit 0\n`, { mode: 0o700 })
  const action: RepositoryAction = { kind: 'push-tag', name: 'locked-tag', remote: 'origin' }
  const preview = await f.service.previewAction(f.id, action); if (!preview?.ok) throw new Error('preview failed')
  const pending = f.service.executeAction(f.id, action, preview.value.token)
  for (let attempt = 0; attempt < 300 && !(await Bun.file(marker).exists()); attempt++) await Bun.sleep(10)
  expect(await Bun.file(marker).exists()).toBe(true)
  expect(await f.service.checkout(f.id, { kind: 'branch', name: 'feature' })).toMatchObject({ ok: false, reason: 'repository-busy' })
  expect(await f.service.pull(f.id, { manual: true })).toMatchObject({ result: { code: 'busy' } })
  expect(await f.service.fetchAll(f.id, { manual: true })).toMatchObject({ result: { code: 'busy' } })
  expect(await pending).toMatchObject({ value: { state: 'completed' } })
})
