import { lstat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const modifiedAt = async (path: string): Promise<number> => (await lstat(path).catch(() => null))?.mtimeMs ?? 0

/** Code activity: HEAD commit time plus non-ignored working changes, not fetch time. */
export async function repositoryActivity(path: string): Promise<number> {
  const run = async (args: string[]) => {
    const child = Bun.spawn(['git', '--no-optional-locks', '-C', path, ...args], { stdout: 'pipe', stderr: 'ignore' })
    const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
    return code === 0 ? text : ''
  }
  const [commit, status] = await Promise.all([
    run(['log', '-1', '--format=%ct', 'HEAD']),
    run(['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  ])
  const times = [Number(commit.trim()) * 1000 || 0]
  const entries = status.split('\0')
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!
    if (!entry) continue
    const file = join(path, entry.slice(3))
    times.push(await modifiedAt(file) || await modifiedAt(dirname(file)))
    if (/[RC]/.test(entry.slice(0, 2))) index++
  }
  // Unborn or unavailable Git metadata still has a useful directory timestamp.
  return times.reduce((latest, time) => Math.max(latest, time), times.some(Boolean) ? 0 : await modifiedAt(path))
}
