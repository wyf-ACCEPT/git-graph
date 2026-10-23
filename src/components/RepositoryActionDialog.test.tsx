import { afterEach, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { RepositoryActionDialog } from './RepositoryActionDialog'
import type { OperationState, RepositoryAction } from '../../shared/repositoryActions'
import { describeRepositoryAction } from '../../shared/repositoryActions'

const originalFetch = globalThis.fetch
const state: OperationState = { branch: 'main', head: 'a'.repeat(40), operation: null, conflicts: [], remotes: ['origin', 'backup'], dirty: false }
afterEach(() => { cleanup(); globalThis.fetch = originalFetch })
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
function stub(options: { stale?: boolean; delayed?: boolean } = {}) {
  const calls: Array<{ url: string; body: { action: RepositoryAction; token?: string } }> = []
  let complete: (() => void) | undefined
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); const url = String(input); calls.push({ url, body })
    if (options.delayed) await new Promise<void>(resolve => { complete = resolve })
    if (url.endsWith('action-preview')) return response({ token: 'reviewed-token', state, description: describeRepositoryAction(body.action, 'demo', state) })
    if (options.stale) return response({ error: 'Repository changed; review again.', code: 'stale-preview' }, 409)
    return response({ state: 'completed', message: 'Done.', operation: state })
  }) as typeof fetch
  return { calls, finish: () => complete?.() }
}

test('branch creation edits options, reviews without executing, then sends the reviewed token', async () => {
  const api = stub(); let done = 0
  const view = render(<RepositoryActionDialog repository="demo" state={state} seed={{ action: { kind: 'create-branch', commit: state.head, name: '', checkout: false } }}
    onBusy={() => {}} onCancel={() => {}} onExecuted={() => done++} />)
  fireEvent.change(view.getByLabelText('Name'), { target: { value: 'feature/新功能' } })
  fireEvent.click(view.getByLabelText('Check out the new branch'))
  fireEvent.click(view.getByRole('button', { name: 'Review action' }))
  await waitFor(() => expect(view.getByRole('button', { name: 'Create and check out' })).toBeTruthy())
  expect(api.calls).toHaveLength(1); expect(api.calls[0]?.url).toBe('/api/git/action-preview')
  expect(api.calls[0]?.body.action).toMatchObject({ name: 'feature/新功能', checkout: true })
  fireEvent.click(view.getByRole('button', { name: 'Create and check out' }))
  await waitFor(() => expect(done).toBe(1))
  expect(api.calls[1]?.body.token).toBe('reviewed-token')
})

test('a stale execution returns to review instead of repeating a stale write', async () => {
  const api = stub({ stale: true })
  const view = render(<RepositoryActionDialog repository="demo" state={state} seed={{ action: { kind: 'delete-branch', name: 'old' } }}
    onBusy={() => {}} onCancel={() => {}} onExecuted={() => { throw new Error('must not succeed') }} />)
  fireEvent.click(view.getByRole('button', { name: 'Review action' }))
  await waitFor(() => expect(view.getByRole('button', { name: 'Delete branch' })).toBeTruthy())
  expect(document.activeElement?.textContent).toBe('Cancel')
  fireEvent.click(view.getByRole('button', { name: 'Delete branch' }))
  await waitFor(() => expect(view.getByRole('button', { name: 'Review action' })).toBeTruthy())
  expect(view.getByRole('alert').textContent).toContain('Repository changed')
  expect(api.calls).toHaveLength(2)
})

test('merge mode and merge-commit mainline are explicit review inputs', async () => {
  const api = stub()
  const view = render(<RepositoryActionDialog repository="demo" state={state} seed={{ action: { kind: 'cherry-pick', commit: state.head }, parentCount: 2 }}
    onBusy={() => {}} onCancel={() => {}} onExecuted={() => {}} />)
  fireEvent.change(view.getByLabelText('Mainline parent'), { target: { value: '2' } })
  fireEvent.click(view.getByRole('button', { name: 'Review action' }))
  await waitFor(() => expect(api.calls).toHaveLength(1))
  expect(api.calls[0]?.body.action).toMatchObject({ mainline: 2 })
})

test('tag type, message and remote selection stay explicit', async () => {
  const api = stub()
  const view = render(<RepositoryActionDialog repository="demo" state={state} seed={{ action: { kind: 'push-tag', name: 'v1', remote: 'origin' } }}
    onBusy={() => {}} onCancel={() => {}} onExecuted={() => {}} />)
  fireEvent.change(view.getByLabelText('Remote'), { target: { value: 'backup' } })
  fireEvent.click(view.getByRole('button', { name: 'Review action' }))
  await waitFor(() => expect(api.calls).toHaveLength(1))
  expect(api.calls[0]?.body.action).toMatchObject({ remote: 'backup', name: 'v1' })
})

test('Escape cancels without writing, and duplicate review submits are ignored while busy', async () => {
  const api = stub({ delayed: true }); let cancelled = 0
  const view = render(<RepositoryActionDialog repository="demo" state={state} seed={{ action: { kind: 'rename-branch', name: 'old', newName: 'new' } }}
    onBusy={() => {}} onCancel={() => cancelled++} onExecuted={() => {}} />)
  fireEvent.keyDown(view.getByRole('alertdialog'), { key: 'Escape' }); expect(cancelled).toBe(1); expect(api.calls).toHaveLength(0)
  fireEvent.click(view.getByRole('button', { name: 'Review action' })); fireEvent.click(view.getByRole('button', { name: 'Review action' }))
  expect(api.calls).toHaveLength(1)
  fireEvent.keyDown(view.getByRole('alertdialog'), { key: 'Escape' }); expect(cancelled).toBe(1)
  await act(async () => { api.finish() })
})
