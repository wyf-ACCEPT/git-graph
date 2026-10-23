import { afterEach, expect, test } from 'bun:test'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { AutoPullControl } from './AutoPullControl'
import type { BranchSync } from '../../shared/branchSync'
afterEach(cleanup)
const status: BranchSync = { branch: 'main', upstream: 'refs/remotes/origin/main', ahead: 0, behind: 2, canPull: true, canPush: false, reason: '2 commits behind.' }
test('branch arrows reflect direction, invoke the right action, and pause while busy', () => {
  let pulls = 0; let pushes = 0
  const props = { enabled: true, running: false, paused: false, available: true, result: null,
    onToggle: () => {}, onPull: () => {}, onBranchPull: () => pulls++, onPush: () => pushes++ }
  const view = render(<AutoPullControl {...props} sync={status} />)
  const down = view.getByRole('button', { name: 'Pull branch' }) as HTMLButtonElement
  const up = view.getByRole('button', { name: 'Push branch' }) as HTMLButtonElement
  expect(down.disabled).toBe(false); expect(up.disabled).toBe(true)
  fireEvent.click(down); fireEvent.click(up)
  expect(pulls).toBe(1); expect(pushes).toBe(0)
  view.rerender(<AutoPullControl {...props} sync={{ ...status, ahead: 2, behind: 0, canPull: false, canPush: true }} />)
  expect(down.disabled).toBe(true); expect(up.disabled).toBe(false)
  fireEvent.click(up); expect(pushes).toBe(1)
  view.rerender(<AutoPullControl {...props} paused sync={status} />)
  expect(down.disabled).toBe(true); expect(up.disabled).toBe(true)
  view.rerender(<AutoPullControl {...props} sync={null} />)
  expect(down.disabled).toBe(true); expect(up.disabled).toBe(true)
})

test('refresh and auto sync tooltips describe all remotes while arrows describe only the current branch', () => {
  let refreshed = 0
  const view = render(<AutoPullControl enabled running={false} paused={false} available result={null}
    sync={status} onToggle={() => {}} onPull={() => refreshed++} onBranchPull={() => {}} onPush={() => {}} />)
  const refresh = view.getByRole('button', { name: 'Fetch all remotes' })
  expect(refresh.getAttribute('title')).toContain('every remote')
  expect(refresh.getAttribute('title')).toContain('Local branches and working files are unchanged')
  expect(view.getByRole('switch').getAttribute('title')).toContain('all branches from every remote')
  expect(view.getByRole('button', { name: 'Pull branch' }).getAttribute('title')).toContain('Pull current branch')
  expect(view.getByRole('button', { name: 'Push branch' }).getAttribute('title')).toContain('Push current branch')
  fireEvent.click(refresh); expect(refreshed).toBe(1)
})
