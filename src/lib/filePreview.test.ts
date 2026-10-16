import { describe, expect, test } from 'bun:test'
import { filePreviewHref, parseFilePreviewParams } from './filePreview'

describe('full-file preview routes', () => {
  test('preserves a root repository, full commit and special characters in a path', () => {
    const target = { kind: 'commit' as const, repo: '', hash: 'a'.repeat(40), path: 'src/a b#%中文.ts' }
    expect(parseFilePreviewParams(filePreviewHref(target).split('?')[1]!)).toEqual(target)
  })
  test('retains comparison context and working-tree context', () => {
    for (const target of [
      { kind: 'compare' as const, repo: 'sample', head: 'feature/topic', base: 'main', path: 'x.ts' },
      { kind: 'working' as const, repo: 'sample', path: 'x.ts' },
    ]) expect(parseFilePreviewParams(filePreviewHref(target).split('?')[1]!)).toEqual(target)
  })
  test('rejects incomplete or unknown preview contexts', () => {
    for (const query of ['source=commit&path=x', 'source=compare&path=x', 'source=other&path=x', 'source=working']) {
      expect(parseFilePreviewParams(query)).toBeNull()
    }
  })
})
