import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { daemonProbe, startDaemon, stopDaemon, tailDaemonLog } from './daemon'
import { baseUrlForState, stateFilePath, workspaceRoot } from './paths'

/** Serialize launches for one workspace; a different root has a different lock. */
async function acquireLock(): Promise<() => void> {
  const directory = dirname(stateFilePath)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const lock = join(directory, 'launch.lock')
  const deadline = Date.now() + 20000
  while (true) {
    try {
      mkdirSync(lock, { mode: 0o700 })
      writeFileSync(join(lock, 'owner'), String(process.pid))
      return () => rmSync(lock, { recursive: true, force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      // A crashed launcher leaves a lock. Never remove one while its owner lives.
      if (existsSync(lock) && Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now()) > 30000) {
        const owner = Number(await Bun.file(join(lock, 'owner')).text().catch(() => '0'))
        let alive = true
        try { process.kill(owner, 0) } catch (probeError) {
          alive = (probeError as NodeJS.ErrnoException).code !== 'ESRCH'
        }
        if (owner > 0 && !alive) {
          rmSync(lock, { recursive: true, force: true })
          continue
        }
      }
      if (Date.now() >= deadline) throw new Error(`Workspace launcher is busy; retry or inspect ${lock}`)
      await Bun.sleep(100)
    }
  }
}

export async function runWorkspace(arguments_: string[]): Promise<void> {
  if (!workspaceRoot) throw new Error('GIT_GRAPH_WORKSPACE_ROOT is required')
  const [action = 'start', repo = '', portText = ''] = arguments_
  if (!['start', 'restart', 'status', 'stop', 'logs'].includes(action)) throw new Error('Unknown workspace action')
  const port = portText ? Number(portText) : undefined
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Invalid port')
  const release = await acquireLock()
  try {
    const probe = await daemonProbe()
    if (action === 'logs') {
      console.log(await tailDaemonLog(Number(repo) || 200) ?? 'gg: no workspace log yet')
      return
    }
    if (probe.running) {
      if (!probe.state || probe.state.root !== workspaceRoot || probe.pid !== probe.state.pid) {
        throw new Error(`Workspace state cannot be verified; inspect ${stateFilePath}`)
      }
      const response = await fetch(`${baseUrlForState(probe.state)}/api/status`, { signal: AbortSignal.timeout(3000) })
      const status = await response.json()
      if (!response.ok || status.name !== 'git-graph' || status.pid !== probe.pid || status.root !== workspaceRoot || status.repositoriesFile !== null) {
        throw new Error(`Workspace server identity changed; inspect ${stateFilePath}`)
      }
    }
    if (action === 'status') {
      console.log(probe.running ? `gg: serving ${workspaceRoot} at ${baseUrlForState(probe.state!)}` : `gg: no server for ${workspaceRoot}`)
      console.log(`gg: state ${stateFilePath}`)
      return
    }
    if (action === 'stop') {
      console.log(await stopDaemon() ? `gg: stopped ${workspaceRoot}` : `gg: no server for ${workspaceRoot}`)
      return
    }
    if (probe.running && port !== undefined && port !== probe.state!.port && action !== 'restart') {
      throw new Error(`Workspace already uses port ${probe.state!.port}; use --restart --port ${port}`)
    }
    let baseUrl: string
    if (probe.running && action !== 'restart') {
      baseUrl = baseUrlForState(probe.state!)
    } else {
      const result = await startDaemon({ root: workspaceRoot, host: '127.0.0.1', explicitPort: port, basePort: 3107 })
      if (!result.started || !result.healthy) throw new Error(`Workspace failed to start; inspect gg --logs (${stateFilePath})`)
      baseUrl = result.baseUrl
    }
    const url = new URL(baseUrl)
    url.searchParams.set('root', workspaceRoot)
    if (repo) url.searchParams.set('repo', repo)
    // The launcher consumes exactly one URL; diagnostics go to stderr.
    console.error(`gg: serving ${workspaceRoot}`)
    console.error(`gg: state ${stateFilePath}`)
    console.log(url.href)
  } finally {
    release()
  }
}
