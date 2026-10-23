import { useEffect, useRef, useState } from 'react'
import type { BranchSync } from '../../shared/branchSync'
import { fetchBranchSync } from './api'

export const BRANCH_SYNC_INTERVAL_MS = 15_000

/** Keep the graph and its action availability in step with external Git writers. */
export function useBranchSync({ repository, version, onRepositoryChange, request = fetchBranchSync }: {
  repository: string | null; version: number; onRepositoryChange: () => void
  request?: typeof fetchBranchSync
}) {
  const [observation, setObservation] = useState<{ repository: string; status: BranchSync } | null>(null)
  const previous = useRef<{ repository: string; revision?: string } | null>(null)
  const onChange = useRef(onRepositoryChange)
  onChange.current = onRepositoryChange

  useEffect(() => {
    if (repository === null) { previous.current = null; return }
    if (previous.current?.repository !== repository) previous.current = null
    let active = true
    let generation = 0
    async function refresh() {
      const requestId = ++generation
      try {
        const status = await request(repository!)
        if (!active || requestId !== generation) return
        const last = previous.current
        previous.current = { repository: repository!, revision: status.revision }
        setObservation({ repository: repository!, status })
        // Ref changes invalidate the graph, branch listing and open details.
        // Unchanged polls leave the graph and its viewport alone.
        if (last?.repository === repository && last.revision !== undefined && status.revision !== undefined && last.revision !== status.revision) onChange.current()
      } catch {
        if (active && requestId === generation) setObservation(null)
      }
    }
    const onFocus = () => { void refresh() }
    void refresh()
    const timer = setInterval(() => { void refresh() }, BRANCH_SYNC_INTERVAL_MS)
    window.addEventListener('focus', onFocus)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [repository, version, request])

  return observation?.repository === repository ? observation.status : null
}
