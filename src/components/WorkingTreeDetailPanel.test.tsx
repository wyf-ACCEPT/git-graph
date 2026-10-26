import { afterEach, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { WorkingTree } from '../../shared/git.schema'
import { WorkingTreeDetailPanel } from './WorkingTreeDetailPanel'

afterEach(cleanup)
const working: WorkingTree = { repository: 'demo', branch: 'main', head: 'abc1234', filesTruncated: false, files: [
  { path: 'src/修改.ts', previousPath: null, status: 'modified', binary: false, additions: 3, deletions: 1 },
  { path: 'asset.png', previousPath: null, status: 'added', binary: true, additions: null, deletions: null },
] }

test('brief lists files without a fake commit and expands via the shared disclosure', () => {
  let toggled = ''; let closed = false
  const props = { working, repository: 'demo', variant: 'inline' as const, expandedFilePath: null as string | null, onToggleFile: (path: string) => { toggled = path }, fileDiff: null, isLoadingFileDiff: false, fileDiffError: null as string | null, diffViewTheme: 'dark' as const, onClose: () => { closed = true } }
  const view = render(<WorkingTreeDetailPanel {...props} />)
  expect(screen.getByLabelText('Uncommitted changes details').tagName).toBe('SECTION')
  expect(screen.getByText('2 files changed')).toBeTruthy()
  const toggle = screen.getByRole('button', { name: /src\/修改.ts/ })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(toggle)
  expect(toggled).toBe('src/修改.ts')
  view.rerender(<WorkingTreeDetailPanel {...props} expandedFilePath={toggled} fileDiffError="Diff unavailable" />)
  expect(screen.getByText('Diff unavailable')).toBeTruthy()
  expect(screen.getByRole('button', { name: /asset.png/ }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByLabelText('Open all uncommitted changes in a new tab').getAttribute('href')).toBe('/working?repo=demo')
  fireEvent.click(screen.getByLabelText('Close the details panel'))
  expect(closed).toBe(true)
})

test('sidebar and unborn/truncated states retain the same brief', () => {
  render(<WorkingTreeDetailPanel working={{ ...working, branch: null, head: null, filesTruncated: true }} repository="" variant="sidebar" expandedFilePath={null} onToggleFile={() => {}} fileDiff={null} isLoadingFileDiff={false} fileDiffError={null} diffViewTheme="light" onClose={() => {}} />)
  expect(screen.getByLabelText('Uncommitted changes details').tagName).toBe('ASIDE')
  expect(screen.getByText(/No commits yet/)).toBeTruthy()
  expect(screen.getByText('2+ files changed')).toBeTruthy()
  expect(screen.getByText(/File list truncated/)).toBeTruthy()
})
