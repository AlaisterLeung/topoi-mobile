import { useCallback, useEffect, useRef, useState } from 'react'

/** The furthest a list travels under a finger, damped. */
export const MAX_PULL_PX = 96

/** How far the list has to travel (damped, not the finger) before letting go refreshes. */
export const TRIGGER_PX = 64

/** Where the list rests while a refresh runs: the indicator's own height, which is the room the rows make for it. */
export const HOLD_PX = 56

/** A refresh that lands at once still shows its spinner this long, so the gesture reads as work rather than as a flicker. */
export const MIN_SPIN_MS = 400

/** The list's travel for the finger's, damped: it gives less than the finger pulls, so a small drag does not drag the rows down the screen. */
export function pullOf(dy: number): number {
  if (dy <= 0) return 0
  return Math.min(MAX_PULL_PX, dy * 0.5)
}

/** Whether a touch that has moved this far is a pull on a list that is already at its top: downward, more vertical than sideways, and with nothing above the first row to scroll. */
export function claimsPull(dx: number, dy: number, scrollTop: number): boolean {
  if (scrollTop > 0) return false
  if (dy <= 0) return false
  return Math.abs(dy) > Math.abs(dx)
}

/** Whether letting go here refreshes. */
export function triggers(pull: number): boolean {
  return pull >= TRIGGER_PX
}

/** Where the indicator sits for a given travel: it rides the list's own pull, less its height, so it comes out from behind the header as the rows move down. */
export function indicatorShift(pull: number): number {
  return pull - HOLD_PX
}

/** What the gesture is doing, for the indicator's own wording and for a probe. */
export type PullPhase = 'idle' | 'pulling' | 'armed' | 'refreshing'

interface Options {
  /** Re-fetch the list. The promise is what the spinner waits on. */
  onRefresh: () => Promise<unknown> | unknown
  /** Nothing to refresh yet (the screen has no rows of its own). */
  disabled: boolean
}

/** The two elements the gesture draws on. */
export interface PullHandles {
  /** The element that scrolls the list; it is what moves under the finger. */
  scrollRef: (el: HTMLDivElement | null) => void
  /** The indicator drawn in the room the rows make. */
  indicatorRef: (el: HTMLDivElement | null) => void
  phase: PullPhase
}

/** Pull-to-refresh for one scrolling list.
 *
 *  The travel is written straight to the DOM: a finger at 60Hz must not re-render the list it is dragging, so React only hears about the phase (which changes at most three times per gesture). The listeners live on the scroller rather than the document, so a pull in a chat's transcript is never mistaken for one of this list's. */
export function usePullToRefresh({ onRefresh, disabled }: Options): PullHandles {
  const scroller = useRef<HTMLDivElement | null>(null)
  const indicator = useRef<HTMLDivElement | null>(null)
  const latest = useRef({ onRefresh, disabled })
  const [phase, setPhase] = useState<PullPhase>('idle')
  const phaseRef = useRef<PullPhase>('idle')

  useEffect(() => {
    latest.current = { onRefresh, disabled }
  })

  const scrollRef = useCallback((el: HTMLDivElement | null) => {
    scroller.current = el
  }, [])
  const indicatorRef = useCallback((el: HTMLDivElement | null) => {
    indicator.current = el
  }, [])

  useEffect(() => {
    const el = scroller.current
    if (!el) return

    let tracking = false
    let active = false
    let running = false
    let startX = 0
    let startY = 0
    let pull = 0

    const nextPhase = (next: PullPhase) => {
      if (phaseRef.current === next) return
      phaseRef.current = next
      setPhase(next)
    }

    /** Move the list and its indicator. `animate` is the release and the return, never the drag itself. */
    const paint = (value: number, animate: boolean) => {
      const ms = animate ? 220 : 0
      const node = scroller.current
      if (node) {
        node.style.transition = ms ? `transform ${ms}ms cubic-bezier(0.32, 0.72, 0, 1)` : 'none'
        // The transition has to be in place before the value moves, or the release lands in one frame.
        if (ms) void node.offsetWidth
        node.style.transform = value ? `translateY(${value}px)` : ''
      }
      const badge = indicator.current
      if (badge) {
        badge.style.transition = ms ? `transform ${ms}ms cubic-bezier(0.32, 0.72, 0, 1), opacity ${ms}ms` : 'none'
        if (ms) void badge.offsetWidth
        badge.style.transform = `translateY(${indicatorShift(value)}px)`
        badge.style.opacity = String(Math.min(1, value / TRIGGER_PX))
      }
    }

    const run = async () => {
      running = true
      nextPhase('refreshing')
      const started = Date.now()
      pull = HOLD_PX
      paint(HOLD_PX, true)
      try {
        await latest.current.onRefresh()
      } catch {
        // The screen paints its own failure: a refresh that cannot land leaves the rows it already has alone.
      }
      const elapsed = Date.now() - started
      if (elapsed < MIN_SPIN_MS) await new Promise(done => window.setTimeout(done, MIN_SPIN_MS - elapsed))
      running = false
      pull = 0
      paint(0, true)
      nextPhase('idle')
    }

    const start = (event: TouchEvent) => {
      tracking = false
      active = false
      if (running || latest.current.disabled) return
      if (event.touches.length !== 1) return
      // Only a list already at its top pulls: a touch that starts lower scrolls.
      if (el.scrollTop > 0) return
      const touch = event.touches[0]
      startX = touch.clientX
      startY = touch.clientY
      tracking = true
    }

    const move = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!tracking || !touch) return
      const dy = touch.clientY - startY
      const dx = touch.clientX - startX
      if (!active) {
        if (el.scrollTop > 0) {
          tracking = false
          return
        }
        if (!claimsPull(dx, dy, el.scrollTop)) {
          // Sideways belongs to the edge swipes, upward to the list's own scrolling.
          if (Math.abs(dy) > Math.abs(dx)) tracking = false
          return
        }
        active = true
        nextPhase('pulling')
      }
      // The rows follow the finger; without this the list scrolls under it.
      if (event.cancelable) event.preventDefault()
      pull = pullOf(dy)
      paint(pull, false)
      nextPhase(triggers(pull) ? 'armed' : 'pulling')
    }

    const end = () => {
      if (!tracking) return
      tracking = false
      if (!active) return
      active = false
      if (!triggers(pull)) {
        pull = 0
        paint(0, true)
        nextPhase('idle')
        return
      }
      void run()
    }

    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  }, [])

  return { scrollRef, indicatorRef, phase }
}
