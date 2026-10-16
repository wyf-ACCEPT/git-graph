import type { FileDiff } from '../../shared/git.schema'

export const FILE_PREVIEW_ROUTE = '/file'

type FilePreviewContext =
  | { kind: 'commit'; hash: string }
  | { kind: 'compare'; head: string; base?: string }
  | { kind: 'working' }

export type FilePreviewTarget = FilePreviewContext & { repo: string; path: string }

/** One URL shape for a full-file preview, separate from the existing diff links. */
export function filePreviewHref(target: FilePreviewTarget): string {
  const query = new URLSearchParams({ repo: target.repo, path: target.path, source: target.kind })
  if (target.kind === 'commit') query.set('hash', target.hash)
  if (target.kind === 'compare') {
    query.set('head', target.head)
    if (target.base) query.set('base', target.base)
  }
  return `${FILE_PREVIEW_ROUTE}?${query}`
}

export function parseFilePreviewParams(search: string): FilePreviewTarget | null {
  const query = new URLSearchParams(search)
  const path = query.get('path')
  if (!path) return null
  const common = { repo: query.get('repo') ?? '', path }
  switch (query.get('source')) {
    case 'working': return { ...common, kind: 'working' }
    case 'commit': {
      const hash = query.get('hash')
      return hash ? { ...common, kind: 'commit', hash } : null
    }
    case 'compare': {
      const head = query.get('head')
      return head ? { ...common, kind: 'compare', head, base: query.get('base') ?? '' } : null
    }
    default: return null
  }
}

/** Never turn an absent or omitted source into an apparently empty file. */
export function filePreviewSource(diff: FileDiff): { text: string; beforeDeletion: boolean } | null {
  if (diff.binary || diff.truncated) return null
  if (diff.newSource !== null) return { text: diff.newSource, beforeDeletion: false }
  if (diff.status === 'deleted' && diff.oldSource !== null) {
    return { text: diff.oldSource, beforeDeletion: true }
  }
  return null
}
