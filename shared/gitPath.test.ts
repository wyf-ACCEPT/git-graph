import { expect, test } from 'bun:test'
import { decodeGitPath } from './gitPath'
import { parseCommitFileChanges } from './commitDetail'

test('decodes the reported Chinese path as UTF-8 bytes rather than octal character codes', () => {
  expect(decodeGitPath(String.raw`"docs/\345\217\221\345\270\203\350\256\260\345\275\225.md"`)).toBe('docs/发布记录.md')
})
test('preserves unquoted Unicode and literal backslash sequences', () => {
  for (const path of ['docs/发布记录.md', String.raw`docs/literal\345.md`, 'docs/a b.md']) expect(decodeGitPath(path)).toBe(path)
})
test('handles quoted Unicode, spaces, emoji and C escapes without double decoding', () => {
  expect(decodeGitPath('"文档/发布记录.md"')).toBe('文档/发布记录.md')
  expect(decodeGitPath("\"\u6587\u6863/\\360\\237\\232\\200 \\\"\u53d1\u5e03\\\"\\t\u8bb0\u5f55\\n\u65b0\u884c\\\\345.md\"")).toBe('文档/🚀 "发布"\t记录\n新行\\345.md')
})
test('leaves malformed or non-UTF-8 quoted data intact', () => {
  for (const path of [String.raw`"\q"`, String.raw`"\777"`, String.raw`"\377"`, '"unterminated']) expect(decodeGitPath(path)).toBe(path)
})
test('decodes rename source and destination only after parsing tab/line boundaries', () => {
  const result = parseCommitFileChanges(String.raw`:100644 100644 abc def R100	"docs/\345\217\221\345\270\203.md"	"docs/\350\256\260\345\275\225\t\n.md"`.replaceAll('\\t"', '\t"') + '\n0\t0\tignored\n')
  expect(result.files[0]).toMatchObject({ previousPath: 'docs/发布.md', path: 'docs/记录\t\n.md', status: 'renamed', additions: 0, deletions: 0 })
})

test('preserves a leading BOM when it is part of the filename', () => {
  expect(decodeGitPath(String.raw`"\357\273\277file.md"`)).toBe('\ufefffile.md')
})
