import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServedRootRepositorySet } from './repository-set'

const environment = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' }
function git(path: string, date: string, ...args: string[]) {
  const result = Bun.spawnSync(['git', '-C', path, ...args], { env: { ...environment, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } })
  if (result.exitCode) throw new Error(result.stderr.toString())
}

test('sorts by commit or nested working changes, ignoring fetch metadata and ignored files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gg-activity-'))
  const old = join(root, 'alpha-old')
  const recent = join(root, 'zeta-recent')
  const ignored = '.gitignore'
  const list = async () => (await createServedRootRepositorySet(root).list()).repositories.map((repo) => repo.relativePath)
  try {
    for (const [path, date] of [[old, '2020-01-01T00:00:00Z'], [recent, '2022-01-01T00:00:00Z']] as const) {
      mkdirSync(join(path, 'src'), { recursive: true })
      writeFileSync(join(path, ignored), '# Secrets\n.env\n# Packages\nnode_modules/\n# Data\nignored.log\n# Cache\n.cache/\n')
      writeFileSync(join(path, 'src/file.txt'), 'initial')
      git(path, date, 'init', '-q', '-b', 'main')
      git(path, date, 'add', '.')
      git(path, date, 'commit', '-qm', 'initial')
    }
    expect(await list()).toEqual(['zeta-recent', 'alpha-old'])
    writeFileSync(join(old, '.git/FETCH_HEAD'), 'fetch metadata')
    writeFileSync(join(old, 'ignored.log'), 'generated')
    expect(await list()).toEqual(['zeta-recent', 'alpha-old'])
    writeFileSync(join(old, 'src/file.txt'), 'modified')
    utimesSync(join(old, 'src/file.txt'), new Date('2024-01-01'), new Date('2024-01-01'))
    expect(await list()).toEqual(['alpha-old', 'zeta-recent'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
