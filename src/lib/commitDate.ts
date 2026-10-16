/** Render Git timestamps to seconds in the viewer's local timezone. */
export function formatCommitDate(value: string): { text: string; title: string } {
  if (!value) return { text: '—', title: 'git reported no date' }
  const currentYear = new Date().getFullYear()
  // Hosts may still supply date-only rows; never invent a time or shift the day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { text: Number(value.slice(0, 4)) === currentYear ? value.slice(5) : value, title: value }
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return { text: value, title: value }
  const pad = (part: number) => String(part).padStart(2, '0')
  const monthDay = `${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
  const date = parsed.getFullYear() === currentYear ? monthDay : `${parsed.getFullYear()}-${monthDay}`
  const time = `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`
  const offset = -parsed.getTimezoneOffset()
  const zone = `UTC${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  return { text: `${date} ${time}`, title: `${value} · displayed in ${zone}` }
}
