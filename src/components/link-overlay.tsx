/** The link banner: one overlay pinned directly under the current screen's own
 *  header, so a reconnect or an error never pushes the content it sits over.
 *  `top` is that header's height, measured where it is rendered - the three
 *  screens' headers are not the same size. */
export function LinkOverlay({
  text,
  tone,
  top
}: {
  text: string
  tone: 'info' | 'error'
  top: number
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      style={{ top }}
      className={`absolute left-0 right-0 z-20 px-4 py-2 text-center text-xs backdrop-blur-sm ${
        tone === 'error' ? 'bg-red-950/90 text-red-400' : 'bg-zinc-900/90 text-zinc-400'
      }`}
    >
      {text}
    </div>
  )
}
