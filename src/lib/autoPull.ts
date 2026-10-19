import { useCallback, useEffect, useRef, useState } from 'react'
import { AUTO_PULL_INTERVAL_MS, type PullResult } from '../../shared/pull'
import { pullRepository } from './api'
import { announceRepositoryChange } from './repositoryChanges'

const storageKey = (key: string) => `git-graph:auto-pull:${key}`
function readEnabled(key: string): boolean {
  try { return window.localStorage.getItem(storageKey(key)) !== 'off' } catch { return true }
}

/** Current graph only; no immediate pull on page load or repository selection. */
export function useAutoPull({ repository, repositoryKey, paused, onRefresh, request = pullRepository }: {
  repository: string | null
  repositoryKey: string | null
  paused: boolean
  onRefresh: () => void
  request?: typeof pullRepository
}) {
  const [preferences, setPreferences] = useState<Record<string, boolean>>({})
  const [runningKeys, setRunningKeys] = useState<Set<string>>(() => new Set())
  const [outcome, setOutcome] = useState<{ key: string; result: PullResult } | null>(null)
  const inFlight = useRef(new Set<string>())
  const current = useRef({ repositoryKey, paused, onRefresh })
  current.current = { repositoryKey, paused, onRefresh }
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const enabled = repositoryKey !== null && (preferences[repositoryKey] ?? readEnabled(repositoryKey))

  const setEnabled = useCallback((value: boolean) => {
    if (repositoryKey === null) return
    setPreferences((existing) => ({ ...existing, [repositoryKey]: value }))
    try { window.localStorage.setItem(storageKey(repositoryKey), value ? 'on' : 'off') } catch { /* Keep the in-memory preference. */ }
  }, [repositoryKey])

  useEffect(() => {
    if (repositoryKey === null) return
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key === storageKey(repositoryKey)) {
        setPreferences((existing) => ({ ...existing, [repositoryKey]: readEnabled(repositoryKey) }))
      }
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [repositoryKey])

  async function run(manual = false) {
    if (repository === null || repositoryKey === null || current.current.paused || inFlight.current.has(repositoryKey) || (!manual && !enabled)) return
    const key = repositoryKey
    const repo = repository
    inFlight.current.add(key)
    setRunningKeys((keys) => new Set(keys).add(key))
    let result: PullResult
    try {
      result = await request(repo, manual)
    } catch (error) {
      result = { state: 'error', code: 'request-failed', message: `Pull failed: ${error instanceof Error ? error.message : 'the service is unavailable'}`,
        fetched: false, branch: null, checkedAt: new Date().toISOString() }
    }
    try { if (result.fetched) announceRepositoryChange(repo) } catch { /* The active tab can still refresh without BroadcastChannel. */ }
    inFlight.current.delete(key)
    if (!mounted.current) return
    setRunningKeys((keys) => { const next = new Set(keys); next.delete(key); return next })
    if (current.current.repositoryKey === key) {
      setOutcome({ key, result })
      current.current.onRefresh()
    }
  }

  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    if (!enabled || repositoryKey === null) return
    const key = repositoryKey
    const timer = setInterval(() => {
      if (current.current.repositoryKey === key) void runRef.current()
    }, AUTO_PULL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [repositoryKey, enabled])

  return { enabled, setEnabled, isRunning: repositoryKey !== null && runningKeys.has(repositoryKey),
    result: outcome?.key === repositoryKey ? outcome.result : null, pullNow: () => run(true) }
}
