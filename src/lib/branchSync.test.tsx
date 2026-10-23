import { afterEach, beforeEach, expect, test } from 'bun:test'
import { act, cleanup, renderHook } from '@testing-library/react'
import { BRANCH_SYNC_INTERVAL_MS, useBranchSync } from './branchSync'
import type { BranchSync } from '../../shared/branchSync'

const originalInterval = globalThis.setInterval
const originalClear = globalThis.clearInterval
const timers = new Map<number, () => void>()
let nextTimer = 0
const status = (revision: string, ahead = 0): BranchSync => ({ revision, branch: 'main', upstream: 'refs/remotes/origin/main', ahead, behind: 0,
  canPull: false, canPush: ahead > 0, reason: ahead ? 'Ahead.' : 'Up to date.' })
beforeEach(() => {
  timers.clear()
  globalThis.setInterval = ((callback: () => void, milliseconds: number) => {
    expect(milliseconds).toBe(BRANCH_SYNC_INTERVAL_MS)
    const id = ++nextTimer; timers.set(id, callback); return id
  }) as unknown as typeof setInterval
  globalThis.clearInterval = ((id: number) => { timers.delete(Number(id)) }) as typeof clearInterval
})
afterEach(() => { cleanup(); globalThis.setInterval = originalInterval; globalThis.clearInterval = originalClear })
const tick = () => act(async () => { for (const callback of [...timers.values()]) callback() })

test('external commit and push refresh both graph and controls, while idle polls do not reload the graph', async () => {
  let revision = 'base'; let ahead = 0; let changes = 0
  const request = async () => status(revision, ahead)
  const hook = renderHook(({ version }) => useBranchSync({ repository: 'demo', version, request, onRepositoryChange: () => changes++ }), { initialProps: { version: 0 } })
  await tick(); expect(changes).toBe(0)
  revision = 'local-commit'; ahead = 1
  await tick(); expect(changes).toBe(1); expect(hook.result.current?.canPush).toBe(true)
  hook.rerender({ version: 1 }); await tick(); expect(changes).toBe(1)
  revision = 'external-push'; ahead = 0
  await tick(); expect(changes).toBe(2); expect(hook.result.current?.canPush).toBe(false)
  await tick(); expect(changes).toBe(2)
})

test('focus refresh detects external ref updates and listeners/timers are cleaned up', async () => {
  let revision = 'base'; let changes = 0
  const request = async () => status(revision)
  const hook = renderHook(() => useBranchSync({ repository: 'demo', version: 0, request, onRepositoryChange: () => changes++ }))
  await tick(); revision = 'new-remote-ref'
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(changes).toBe(1)
  hook.unmount(); expect(timers.size).toBe(0)
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(changes).toBe(1)
})

test('out-of-order responses cannot restore stale availability', async () => {
  const pending: Array<(value: BranchSync) => void> = []
  let changes = 0
  const request = () => new Promise<BranchSync>(resolve => pending.push(resolve))
  const hook = renderHook(() => useBranchSync({ repository: 'demo', version: 0, request, onRepositoryChange: () => changes++ }))
  await act(async () => { pending[0]!(status('base')) })
  await tick(); await tick()
  await act(async () => { pending[2]!(status('pushed')) })
  await act(async () => { pending[1]!(status('old', 1)) })
  expect(hook.result.current?.canPush).toBe(false); expect(changes).toBe(1)
})

test('repository changes and failures do not reuse another repository status', async () => {
  let fail = false; let changes = 0
  const request = async (repo: string) => { if (fail) throw new Error('offline'); return status(repo) }
  const hook = renderHook(({ repo }: { repo: string | null }) => useBranchSync({ repository: repo, version: 0, request, onRepositoryChange: () => changes++ }), { initialProps: { repo: 'one' as string | null } })
  await tick(); expect(hook.result.current?.revision).toBe('one')
  hook.rerender({ repo: 'two' }); expect(hook.result.current).toBeNull()
  await tick(); expect(hook.result.current?.revision).toBe('two'); expect(changes).toBe(0)
  fail = true; await tick(); expect(hook.result.current).toBeNull()
  hook.rerender({ repo: null }); expect(timers.size).toBe(0)
})
