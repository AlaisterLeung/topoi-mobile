import { useEffect, useRef } from 'react'

/** The band at either edge a gesture has to start inside. */
export const EDGE_PX = 24

/** How far a finger travels sideways before the gesture owns the touch instead of the list it started in. */
export const CLAIM_PX = 12

/** Share of the screen's width a swipe has to travel before letting go goes through. */
export const COMMIT_SHARE = 0.4

/** A flick, in px per ms: fast enough that the distance alone does not have to reach COMMIT_SHARE. */
export const FLICK_PX_PER_MS = 0.4

/** How long a released gesture takes to finish travelling. */
export const SETTLE_MS = 180

/** The edge a gesture starts at: the left one goes back, the right one opens a new thread. */
export type Edge = 'left' | 'right'

/** The edge a touch at this x starts in, or null when it starts anywhere else. */
export function edgeOf(x: number, width: number): Edge | null {
  if (x <= EDGE_PX) return 'left'
  if (x >= width - EDGE_PX) return 'right'
  return null
}

/** The finger's travel in the gesture's own direction, so a swipe is always a positive number. */
export function travelOf(edge: Edge, dx: number): number {
  return edge === 'left' ? dx : -dx
}

/** Whether a touch that has moved this far is this edge's gesture: sideways enough to own the touch, and the way that edge pulls. */
export function claims(edge: Edge, dx: number, dy: number): boolean {
  if (Math.abs(dx) <= Math.abs(dy)) return false
  return travelOf(edge, dx) > 0
}

/** Whether letting go here goes through: past the share of the width, or a flick that already moved far enough to be a gesture rather than a wobble. */
export function commits(travel: number, width: number, velocity: number): boolean {
  if (travel < CLAIM_PX * 2) return false
  return travel >= width * COMMIT_SHARE || velocity >= FLICK_PX_PER_MS
}

/** A touch that starts inside a composer sheet belongs to the sheet: the
 *  document-level listeners fire whatever the portal is mounted under, so an
 *  edge swipe off the sheet's backdrop would navigate the screen behind it. */
function inSheet(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-sheet-root]') !== null
}

/** A touch that starts inside a box which scrolls sideways is that box's: a code block at the edge still pans. */
function inSidewaysScroller(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null
  while (el && el !== document.body) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const overflowX = getComputedStyle(el).overflowX
      if (overflowX === 'auto' || overflowX === 'scroll') return true
    }
    el = el.parentElement
  }
  return false
}

interface Track {
  edge: Edge
  startX: number
  startY: number
  width: number
  /** The gesture owns the touch: every move from here belongs to the screen. */
  claimed: boolean
  travel: number
  at: number
  velocity: number
}

/** What the app does with a gesture the hook has claimed. */
export interface EdgeSwipeHandlers {
  /** Whether this edge may start a gesture at all right now. */
  canStart: (edge: Edge) => boolean
  onStart: (edge: Edge, width: number) => void
  /** The finger's travel in the gesture's own direction, always positive. */
  onMove: (travel: number) => void
  /** The finger left: true when the gesture goes through. */
  onEnd: (commit: boolean) => void
}

/** Edge swipes for the whole app. The listeners live on the document rather than on the shell, because the shell only exists once the user is signed in and the first screen after signing in has to answer a swipe too. */
export function useEdgeSwipe(handlers: EdgeSwipeHandlers): void {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })

  useEffect(() => {
    let track: Track | null = null

    const start = (event: TouchEvent) => {
      if (track && event.touches.length === 1) {
        // A new single touch means the one before it is over. A claimed gesture
        // whose events had stopped arriving died with the node it started on, so
        // the screen it left half-slid is brought back rather than held there.
        if (track.claimed) latest.current.onEnd(false)
        track = null
      }
      if (event.touches.length !== 1) return
      const touch = event.touches[0]
      const width = document.documentElement.clientWidth
      const edge = edgeOf(touch.clientX, width)
      if (!edge || inSheet(event.target) || inSidewaysScroller(event.target) || !latest.current.canStart(edge)) return
      track = {
        edge,
        startX: touch.clientX,
        startY: touch.clientY,
        width,
        claimed: false,
        travel: 0,
        at: event.timeStamp,
        velocity: 0
      }
    }

    const move = (event: TouchEvent) => {
      const current = track
      if (!current) return
      const touch = event.touches[0]
      if (!touch) return
      const dx = touch.clientX - current.startX
      const dy = touch.clientY - current.startY
      if (!current.claimed) {
        if (Math.abs(dx) < CLAIM_PX && Math.abs(dy) < CLAIM_PX) return
        if (!claims(current.edge, dx, dy)) {
          // A list scrolling under the finger, or a pull the wrong way: not ours.
          track = null
          return
        }
        current.claimed = true
        current.at = event.timeStamp
        latest.current.onStart(current.edge, current.width)
      }
      // The screen follows the finger; without this the list scrolls under it.
      event.preventDefault()
      const travel = Math.min(Math.max(travelOf(current.edge, dx), 0), current.width)
      const elapsed = event.timeStamp - current.at
      if (elapsed > 0) current.velocity = (travel - current.travel) / elapsed
      current.at = event.timeStamp
      current.travel = travel
      latest.current.onMove(travel)
    }

    const end = (event: TouchEvent) => {
      const current = track
      track = null
      if (!current?.claimed) return
      latest.current.onEnd(event.type === 'touchend' && commits(current.travel, current.width, current.velocity))
    }

    document.addEventListener('touchstart', start, { passive: true })
    document.addEventListener('touchmove', move, { passive: false })
    document.addEventListener('touchend', end)
    document.addEventListener('touchcancel', end)
    return () => {
      document.removeEventListener('touchstart', start)
      document.removeEventListener('touchmove', move)
      document.removeEventListener('touchend', end)
      document.removeEventListener('touchcancel', end)
    }
  }, [])
}
