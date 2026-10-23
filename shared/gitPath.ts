/** Decode Git's C-quoted UTF-8 paths after wire-format separators are parsed. */
export function decodeGitPath(path: string): string {
  if (!path.startsWith('"') || !path.endsWith('"')) return path
  const body = path.slice(1, -1)
  const bytes: number[] = []
  const encoder = new TextEncoder()
  const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '\\': 92, '"': 34 }
  for (let index = 0; index < body.length;) {
    if (body[index] !== '\\') {
      const codePoint = body.codePointAt(index)!
      const character = String.fromCodePoint(codePoint)
      bytes.push(...encoder.encode(character))
      index += character.length
      continue
    }
    index++
    const escaped = body[index]
    if (escaped === undefined) return path
    if (/[0-7]/.test(escaped)) {
      const octal = body.slice(index).match(/^[0-7]{1,3}/)![0]
      const byte = Number.parseInt(octal, 8)
      if (byte > 255) return path
      bytes.push(byte)
      index += octal.length
    } else {
      const byte = escapes[escaped]
      if (byte === undefined) return path
      bytes.push(byte)
      index++
    }
  }
  // Preserve unexpected/non-UTF-8 wire data rather than silently changing it.
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(new Uint8Array(bytes)) }
  catch { return path }
}
