/** Keep a tab bound to its launch directory across API calls and new tabs. */
export function workspaceHref(path: string, search = typeof location === 'undefined' ? '' : location.search): string {
  const root = new URLSearchParams(search).get('root')
  if (root === null) return path
  const url = new URL(path, 'http://localhost')
  url.searchParams.set('root', root)
  return `${url.pathname}${url.search}${url.hash}`
}

/** Prefer a valid URL selection, then the root repo, then a discovered child. */
export function initialRepository(repositories: ReadonlyArray<{ relativePath: string }>, requested: string | null): string | null {
  if (requested !== null && repositories.some((repo) => repo.relativePath === requested)) return requested
  return repositories.find((repo) => repo.relativePath === '')?.relativePath ?? repositories[0]?.relativePath ?? null
}
