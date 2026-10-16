import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import type { FileDiff } from '../../shared/git.schema'
import { FileSourceView } from './FileSourceView'

afterEach(cleanup)
const diff = (extra: Partial<FileDiff> = {}): FileDiff => ({
  path: 'src/a.ts', previousPath: null, status: 'modified', hunks: [],
  oldSource: 'old', newSource: 'new', language: 'txt', binary: false, truncated: false, ...extra,
})
describe('full-file source preview', () => {
  test('shows complete source verbatim and escapes markup', () => {
    const source = '<script>window.bad = true</script>\n\n\tkeep indentation\n'
    const { container } = render(<FileSourceView diff={diff({ newSource: source })} />)
    expect(container.querySelector('code')!.textContent).toBe(source)
    expect(container.querySelector('script')).toBeNull()
  })
  test('shows the previous complete source for a deleted file', () => {
    const { container } = render(<FileSourceView diff={diff({ status: 'deleted', newSource: null, oldSource: 'deleted contents\n' })} />)
    expect(screen.getByText(/showing the complete file before deletion/)).toBeTruthy()
    expect(container.querySelector('code')!.textContent).toBe('deleted contents\n')
  })
  test('distinguishes an empty file from a missing source', () => {
    const { rerender } = render(<FileSourceView diff={diff({ newSource: '' })} />)
    expect(screen.getByText('This file is empty.')).toBeTruthy()
    rerender(<FileSourceView diff={diff({ newSource: null })} />)
    expect(screen.getByRole('alert').textContent).toContain('unavailable')
  })
  test('does not show omitted or binary data as an empty file', () => {
    const { rerender } = render(<FileSourceView diff={diff({ truncated: true })} />)
    expect(screen.getByText(/preview limit/)).toBeTruthy()
    rerender(<FileSourceView diff={diff({ binary: true })} />)
    expect(screen.getByText(/Binary files/)).toBeTruthy()
  })
})
