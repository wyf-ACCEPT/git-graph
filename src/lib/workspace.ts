/** Keep a tab bound to its launch directory across API calls and new tabs. */
export function workspaceHref(path: string, search = typeof location === 'undefined' ? '' : location.search): string {
  const root = new URLSearchParams(search).get('root')
  if (root === null) return path
  const url = new URL(path, 'http://localhost')
  url.searchParams.set('root', root)
  return `${url.pathname}${url.search}${url.hash}`
}

/** Explicit recovery always stays on this origin and preserves the old repo choice. */
export function workspaceRecoveryHref(root: string, search: string): string {
  const query = new URLSearchParams(search)
  query.set('root', root)
  return `/?${query}`
}
