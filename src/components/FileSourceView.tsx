import type { FileDiff } from '../../shared/git.schema'
import { filePreviewSource } from '../lib/filePreview'

/** Full source as escaped text, including its original indentation and blank lines. */
export function FileSourceView({ diff }: { diff: FileDiff }) {
  if (diff.binary) return <p className="text-dim">Binary files cannot be previewed as text.</p>
  if (diff.truncated) return <p className="text-dim">This file exceeds the preview limit.</p>
  const source = filePreviewSource(diff)
  if (source === null) return <p role="alert">The file contents are unavailable for this version.</p>
  return (
    <section aria-label="Full file contents">
      {source.beforeDeletion && (
        <p className="mb-3 text-dim">Deleted in this version — showing the complete file before deletion.</p>
      )}
      {source.text === '' ? (
        <p className="text-dim">This file is empty.</p>
      ) : (
        <pre className="m-0 min-w-max font-mono text-[12px] leading-5 whitespace-pre"><code>{source.text}</code></pre>
      )}
    </section>
  )
}
