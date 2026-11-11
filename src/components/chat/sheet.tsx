import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react'
import { createPortal } from 'react-dom'

/** How far a downward drag has to travel before the sheet reads as dismissed. */
const DISMISS_PX = 96

/** Two thirds of the VISIBLE area: `dvh` does not subtract the keyboard on iOS,
 *  and the shell's own --visible-height is what the keyboard writer publishes as
 *  the frame shrinks. */
const TALL = 'min(66dvh, calc(var(--visible-height, 100dvh) * 0.66))'

/** The composer's pickers: a bottom sheet that closes on a backdrop tap, on a
 *  downward drag of its handle, or on the row the user picks. There is no title
 *  row and no close button - the grab handle is the visible affordance, and
 *  `title` survives only as the dialog's label and the `data-sheet` hook. It
 *  portals to the body because the screen stack slides with a transform, which
 *  would make a fixed child travel with the leaving screen.
 *
 *  `fit` sizes the panel to its content, capped at the tall height: the reasoning
 *  picker is a fixed handful of rows and a reserved two thirds leaves dead space
 *  under the last one. The children wrapper drops `flex-1` in that mode, because a
 *  max-height-only flex column with a basis-0 child is ambiguous in WebKit - the
 *  child can collapse instead of taking its content height. */
export function Sheet({
  open,
  onClose,
  title,
  fit = false,
  children
}: {
  open: boolean
  onClose: () => void
  title: string
  fit?: boolean
  children: ReactNode
}) {
  const [drag, setDrag] = useState(0)
  const origin = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    setDrag(0)
    // A focused composer would drag the keyboard up behind the sheet and shrink
    // the panel under the finger that just opened it.
    ;(document.activeElement as HTMLElement | null)?.blur()
  }, [open])

  if (!open) return null

  const start = (event: TouchEvent) => {
    origin.current = event.touches[0]?.clientY ?? null
  }

  const move = (event: TouchEvent) => {
    if (origin.current === null) return
    const delta = (event.touches[0]?.clientY ?? origin.current) - origin.current
    setDrag(Math.max(0, delta))
  }

  const end = () => {
    if (origin.current === null) return
    origin.current = null
    if (drag > DISMISS_PX) onClose()
    else setDrag(0)
  }

  return createPortal(
    <div className="fixed inset-0 z-50" data-sheet-root>
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        data-sheet-backdrop
        className="absolute inset-0 touch-none bg-black/60"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-sheet={title.toLowerCase()}
        style={{
          transform: `translateY(${drag}px)`,
          transition: drag ? 'none' : 'transform 200ms ease-out',
          ...(fit ? { maxHeight: TALL } : { height: TALL })
        }}
        className="absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-2xl border-t border-white/10 bg-surface"
      >
        <div
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={end}
          onTouchCancel={end}
          className="shrink-0 touch-none pt-3 pb-3"
        >
          <span className="mx-auto block h-1 w-9 rounded-full bg-white/20" />
        </div>
        <div className={`flex min-h-0 flex-col ${fit ? '' : 'flex-1'}`}>{children}</div>
        <div className="safe-b" />
      </div>
    </div>,
    document.body
  )
}
