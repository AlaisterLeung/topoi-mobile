import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'

/** How long the pane lingers while it fades out, so releasing it uncovers the
 *  list rather than cutting to it. */
const FADE_MS = 150

/** A screen's wait for its own list.
 *
 *  It covers that screen's list area - never the header, which already shows
 *  where the user is - while there is nothing truthful to put there, which is
 *  what removes the flash of an empty or stale list. A screen opened from the
 *  cache never raises it at all. It stays mounted through the fade out, so the
 *  rows are revealed under a real opacity change. */
export function LoadingOverlay({ visible, label }: { visible: boolean; label: string }) {
  const [mounted, setMounted] = useState(visible)
  const [shown, setShown] = useState(visible)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      setShown(true)
      return
    }
    setShown(false)
    const timer = window.setTimeout(() => setMounted(false), FADE_MS)
    return () => window.clearTimeout(timer)
  }, [visible])

  if (!mounted) return null
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-busy="true"
      data-loading="true"
      className={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-screen transition-opacity duration-150 ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <LoaderCircle className="h-5 w-5 animate-spin text-zinc-500" />
      <p className="text-sm text-zinc-500">{label}</p>
    </div>
  )
}
