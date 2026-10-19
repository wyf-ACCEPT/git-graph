import { afterEach, beforeEach, expect, test } from 'bun:test'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useAutoPull } from './autoPull'
import { AUTO_PULL_INTERVAL_MS, type PullResult } from '../../shared/pull'

const originalInterval = globalThis.setInterval
const originalClear = globalThis.clearInterval
const timers = new Map<number, () => void>()
let nextTimer = 0
const current: PullResult = { state: 'up-to-date', code: 'current', message: 'main is up to date.', branch: 'main', fetched: false, checkedAt: '2026-10-19T00:00:00Z' }
beforeEach(() => {
  window.localStorage.clear(); timers.clear()
  globalThis.setInterval = ((callback: () => void, milliseconds: number) => {
    expect(milliseconds).toBe(AUTO_PULL_INTERVAL_MS)
    const id = ++nextTimer; timers.set(id, callback); return id
  }) as unknown as typeof setInterval
  globalThis.clearInterval = ((timer: number) => { timers.delete(Number(timer)) }) as typeof clearInterval
})
afterEach(() => { cleanup(); globalThis.setInterval = originalInterval; globalThis.clearInterval = originalClear })
async function tick() { await act(async () => { for (const callback of [...timers.values()]) callback() }) }

test('waits five minutes, refreshes after a result, and persists the switch per repository', async () => {
  const calls: Array<[string, boolean | undefined]> = []; let refreshed = 0
  const request = async (repo: string, manual?: boolean) => { calls.push([repo, manual]); return current }
  const hook = renderHook(() => useAutoPull({ repository: 'demo', repositoryKey: '/root/demo', paused: false, onRefresh: () => refreshed++, request }))
  expect(hook.result.current.enabled).toBe(true)
  expect(calls).toEqual([])
  await tick(); expect(calls).toEqual([['demo', false]]); expect(refreshed).toBe(1)
  act(() => hook.result.current.setEnabled(false)); await tick(); expect(calls).toHaveLength(1)
  hook.unmount()
  const restored = renderHook(() => useAutoPull({ repository: 'demo', repositoryKey: '/root/demo', paused: false, onRefresh: () => {}, request }))
  expect(restored.result.current.enabled).toBe(false)
  await act(async () => { await restored.result.current.pullNow() })
  expect(calls.at(-1)).toEqual(['demo', true])
})

test('pauses for Git confirmations and resumes without an immediate operation', async () => {
  let calls = 0
  const hook = renderHook(({ paused }) => useAutoPull({ repository: 'demo', repositoryKey: 'demo', paused, onRefresh: () => {},
    request: async () => { calls++; return current } }), { initialProps: { paused: true } })
  await tick(); expect(calls).toBe(0)
  hook.rerender({ paused: false }); expect(calls).toBe(0)
  await tick(); expect(calls).toBe(1)
})

test('prevents overlap, ignores stale results after switching repositories, and cancels the old timer', async () => {
  let finish!: (value: PullResult) => void
  const calls: string[] = []; let refreshed = 0
  const request = (repo: string) => { calls.push(repo); return new Promise<PullResult>((resolve) => { finish = resolve }) }
  const hook = renderHook(({ repo }) => useAutoPull({ repository: repo, repositoryKey: repo, paused: false, onRefresh: () => refreshed++, request }),
    { initialProps: { repo: 'first' } })
  await tick(); expect(hook.result.current.isRunning).toBe(true)
  await tick(); expect(calls).toEqual(['first'])
  hook.rerender({ repo: 'second' }); expect(timers.size).toBe(1)
  await act(async () => { finish(current) })
  expect(refreshed).toBe(0); expect(hook.result.current.result).toBeNull()
  expect(hook.result.current.isRunning).toBe(false)
  await tick(); expect(calls).toEqual(['first', 'second'])
  await act(async () => { finish(current) }); expect(refreshed).toBe(1)
})

test('request failures stay visible and an explicit retry can recover', async () => {
  let attempts = 0
  const hook = renderHook(() => useAutoPull({ repository: 'demo', repositoryKey: 'demo', paused: false, onRefresh: () => {},
    request: async () => { if (++attempts === 1) throw new Error('Service offline'); return current } }))
  await tick(); expect(hook.result.current.result).toMatchObject({ state: 'error', code: 'request-failed' })
  await act(async () => { await hook.result.current.pullNow() })
  expect(hook.result.current.result).toMatchObject({ state: 'up-to-date' })
})
