import { afterEach, expect, test } from 'bun:test'
import { workspaceHref, initialRepository } from './workspace'
import { fileDiffHref, commitDiffHref, compareHref, workingHref } from './diffRoutes'
import { filePreviewHref } from './filePreview'

const initialUrl = location.href
afterEach(() => { location.href = initialUrl })

test('workspace paths round-trip Unicode and cannot be replaced by a link destination', () => {
  const root = '/Users/me/项目 with spaces'
  const search = `?root=${encodeURIComponent(root)}`
  const url = new URL(workspaceHref('/api/git/log?repo=a&root=other', search), 'http://localhost')
  expect(url.searchParams.get('root')).toBe(root)
  expect(url.searchParams.get('repo')).toBe('a')
  expect(workspaceHref('/api/git/log?repo=a', '')).toBe('/api/git/log?repo=a')
})

test('all standalone views keep the originating workspace', () => {
  const root = '/workspace/session-two'
  location.href = `http://localhost/?root=${encodeURIComponent(root)}`
  const links = [fileDiffHref('repo', 'abc', 'a.md'), commitDiffHref('repo', 'abc'), compareHref('repo', 'feature'), workingHref('repo'), filePreviewHref({ kind: 'working', repo: 'repo', path: 'a.md' })]
  for (const href of links) expect(new URL(href, 'http://localhost').searchParams.get('root')).toBe(root)
})

test('opens a child immediately when a workspace has no root repository', () => {
  const repos = [{ relativePath: 'group/first' }, { relativePath: 'other' }]
  expect(initialRepository(repos, '')).toBe('group/first')
  expect(initialRepository(repos, null)).toBe('group/first')
  expect(initialRepository(repos, 'gone')).toBe('group/first')
  expect(initialRepository(repos, 'other')).toBe('other')
  expect(initialRepository([], '')).toBeNull()
})

test('uses activity order by default while preserving explicit root or child selection', () => {
  const repos = [{ relativePath: 'child' }, { relativePath: '' }]
  expect(initialRepository(repos, null)).toBe('child')
  expect(initialRepository(repos, '')).toBe('')
  expect(initialRepository(repos, 'child')).toBe('child')
})
