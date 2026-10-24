import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { get } from 'node:http'

// Use Node HTTP rather than the component-test DOM's CORS-enforcing fetch.
const fetch = (url: string) => new Promise<{ status: number; json(): Promise<any> }>((resolve, reject) => {
  get(url, (response) => {
    let body = ''
    response.setEncoding('utf8')
    response.on('data', (chunk) => { body += chunk })
    response.on('end', () => resolve({ status: response.statusCode!, json: async () => JSON.parse(body) }))
  }).on('error', reject)
})

// Exercise the actual launcher processes and listening servers, not a mocked
// registry. Two chats may use identical repo names under different roots.
test('workspace launchers isolate roots, reuse canonical paths, serialize starts and stop independently', async () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'gg-workspaces-test-')))
  const rootA = join(scratch, 'session A 中文')
  const rootB = join(scratch, 'session B')
  for (const root of [rootA, rootB]) mkdirSync(join(root, 'group/repo/.git'), { recursive: true })
  symlinkSync(rootA, join(scratch, 'alias'))
  const run = async (root: string, action = 'start', port = '') => {
    const process_ = Bun.spawn([process.execPath, join(import.meta.dir, '../cli.ts'), 'workspace', action, '', port], {
      env: { ...process.env, XDG_RUNTIME_DIR: scratch, GIT_GRAPH_WORKSPACE_ROOT: root, GIT_GRAPH_REPOSITORIES_FILE: '/must/not/be/inherited' },
      stdout: 'pipe', stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([new Response(process_.stdout).text(), new Response(process_.stderr).text(), process_.exited])
    return { stdout: stdout.trim(), stderr, code }
  }
  try {
    const [first, concurrent, second] = await Promise.all([run(rootA), run(rootA), run(rootB)])
    expect(first.code).toBe(0)
    expect(concurrent.code).toBe(0)
    expect(second.code).toBe(0)
    expect(first.stdout).toBe(concurrent.stdout)
    const a = new URL(first.stdout)
    const b = new URL(second.stdout)
    expect(a.origin).not.toBe(b.origin)
    expect(a.searchParams.get('root')).toBe(rootA)
    expect(b.searchParams.get('root')).toBe(rootB)
    const statusA = await fetch(`${a.origin}/api/status`).then((r) => r.json())
    const statusB = await fetch(`${b.origin}/api/status`).then((r) => r.json())
    expect(statusA.root).toBe(rootA)
    expect(statusB.root).toBe(rootB)
    expect(statusA.pid).not.toBe(statusB.pid)
    for (const url of [a, b]) {
      const response = await fetch(`${url.origin}/api/git/repos${url.search}`)
      expect(response.status).toBe(200)
      const list = await response.json()
      expect(list.rootPath).toBe(url.searchParams.get('root'))
      expect(list.repositories.map((r: { relativePath: string }) => r.relativePath)).toEqual(['group/repo'])
    }
    expect((await fetch(`${b.origin}/api/git/repos${a.search}`)).status).toBe(409)
    expect((await fetch(`${a.origin}/api/git/repos`)).status).toBe(409)
    expect((await run(join(scratch, 'alias'))).stdout).toBe(first.stdout)
    expect((await run(rootA, 'start', b.port)).code).toBe(1)
    expect((await fetch(`${a.origin}/api/status`).then((r) => r.json())).pid).toBe(statusA.pid)
    expect((await run(rootA, 'stop')).code).toBe(0)
    expect((await fetch(`${b.origin}/api/status`).then((r) => r.json())).pid).toBe(statusB.pid)
    expect((await run(rootA, 'status')).stdout).toContain('no server')
    expect((await run(rootB, 'status')).stdout).toContain(rootB)
  } finally {
    await run(rootA, 'stop')
    await run(rootB, 'stop')
    rmSync(scratch, { recursive: true, force: true })
  }
}, 30000)
