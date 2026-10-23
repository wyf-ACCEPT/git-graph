import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGitService } from './git'
import { createServedRootRepositorySet } from './repository-set'

const root = mkdtempSync(join(tmpdir(), 'gg-unicode-paths-'))
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
let count = 0
function git(path: string, ...args: string[]) {
  const result = Bun.spawnSync(['git', '-C', path, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { env })
  if (result.exitCode) throw new Error(result.stderr.toString())
  return result.stdout.toString().trim()
}
function fixture(quotePaths: boolean) {
  const id = `repo-${++count}`; const path = join(root, id); mkdirSync(path)
  writeFileSync(join(path, '.gitignore'), '# Secrets\n.env\n.env/\n# Packages\n# Data\n# Cache\n')
  git(path, 'init', '-q', '-b', 'main'); git(path, 'config', 'core.quotePath', String(quotePaths))
  git(path, 'add', '.'); git(path, 'commit', '-qm', 'base'); git(path, 'switch', '-qc', 'feature')
  mkdirSync(join(path, 'docs'))
  const files = ['docs/发布记录.md', 'docs/视频流规范.md', 'docs/🚀 "说明".md', 'docs/含\t制表符\n换行.md', String.raw`docs/literal\345.md`]
  for (const name of files) writeFileSync(join(path, name), 'first\nsecond\n')
  git(path, 'add', '.'); git(path, 'commit', '-qm', 'Unicode paths')
  const commit = git(path, 'rev-parse', 'HEAD')
  const service = createGitService({ repositories: createServedRootRepositorySet(root) })
  return { id, path, files, commit, service }
}
afterAll(() => rmSync(root, { recursive: true, force: true }))

for (const quoted of [true, false]) {
  test(`Chinese and escaped paths work in commit detail, compare and working tree (quotePath=${quoted})`, async () => {
    const f = fixture(quoted)
    const detail = await f.service.readCommitDetail(f.id, f.commit)
    if (!detail.ok) throw new Error(detail.reason)
    expect(detail.detail.files.map(file => file.path).sort()).toEqual([...f.files].sort())
    const compare = await f.service.readCompareSummary(f.id, 'feature', 'main')
    if (!compare.ok) throw new Error(compare.reason)
    expect(compare.summary.files.map(file => file.path).sort()).toEqual([...f.files].sort())
    for (const name of f.files) {
      const diff = await f.service.readFileDiff(f.id, f.commit, name)
      expect(diff).toMatchObject({ ok: true, diff: { path: name, newSource: 'first\nsecond\n' } })
      const comparison = await f.service.readCompareFileDiff(f.id, 'feature', 'main', name)
      expect(comparison).toMatchObject({ ok: true, diff: { path: name, newSource: 'first\nsecond\n' } })
      writeFileSync(join(f.path, name), 'changed\n')
    }
    const working = await f.service.readWorkingTree(f.id)
    if (!working.ok) throw new Error(working.reason)
    expect(working.working.files.map(file => file.path).sort()).toEqual([...f.files].sort())
    for (const name of f.files) expect(await f.service.readWorkingFileDiff(f.id, name)).toMatchObject({ ok: true, diff: { path: name, oldSource: 'first\nsecond\n', newSource: 'changed\n' } })
    expect(await f.service.readFileDiff(f.id, f.commit, 'docs/not-in-commit.md')).toMatchObject({ ok: false, reason: 'unknown-file' })
  })
  test(`Chinese rename preserves both source and destination and opens the diff (quotePath=${quoted})`, async () => {
    const f = fixture(quoted); const oldPath = f.files[0]!; const newPath = 'docs/发布归档.md'
    renameSync(join(f.path, oldPath), join(f.path, newPath)); git(f.path, 'add', '-A'); git(f.path, 'commit', '-qm', 'Rename Unicode file')
    const commit = git(f.path, 'rev-parse', 'HEAD')
    const detail = await f.service.readCommitDetail(f.id, commit)
    if (!detail.ok) throw new Error(detail.reason)
    expect(detail.detail.files).toContainEqual({ path: newPath, previousPath: oldPath, status: 'renamed', additions: 0, deletions: 0, binary: false })
    expect(await f.service.readFileDiff(f.id, commit, newPath)).toMatchObject({ ok: true, diff: { path: newPath, previousPath: oldPath, oldSource: 'first\nsecond\n', newSource: 'first\nsecond\n' } })
  })
}
