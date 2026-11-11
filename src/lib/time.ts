/** A row's short stamp: the clock for today, the date within this year, the year beyond it. */
export function shortStamp(seconds: number | null | undefined): string {
  if (!seconds) return ''
  const at = new Date(seconds * 1000)
  const now = new Date()
  if (at.toDateString() === now.toDateString()) {
    return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  const date = at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return at.getFullYear() === now.getFullYear() ? date : `${date} ${at.getFullYear()}`
}
