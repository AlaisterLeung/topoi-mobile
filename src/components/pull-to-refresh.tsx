import { LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'

import { indicatorShift, usePullToRefresh } from '../lib/pull-to-refresh'

/** The pull-down refresh a listing screen answers.
 *
 *  The list and the indicator are separate elements on purpose: the indicator is anchored to the screen, so the rows moving down uncover it instead of carrying it along. The gesture is the hook's; this only draws what it reports. */
export function PullToRefresh({
  onRefresh,
  disabled,
  children
}: {
  onRefresh: () => Promise<unknown> | unknown
  /** Nothing to refresh yet: the pane is covering the list. */
  disabled: boolean
  children: ReactNode
}) {
  const { scrollRef, indicatorRef, phase } = usePullToRefresh({ onRefresh, disabled })
  const label = phase === 'refreshing' ? 'Refreshing…' : phase === 'armed' ? 'Release to refresh' : 'Pull to refresh'
  return (
    <>
      <div
        ref={indicatorRef}
        data-pull-indicator="true"
        data-pull-state={phase}
        // At rest the indicator sits one own height above the top: hidden behind the header until a pull uncovers it.
        style={{ transform: `translateY(${indicatorShift(0)}px)`, opacity: 0 }}
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-14 items-center justify-center gap-2 text-zinc-500"
      >
        <LoaderCircle className={`h-4 w-4 ${phase === 'refreshing' ? 'animate-spin' : ''}`} />
        <span className="text-xs">{label}</span>
      </div>
      <div ref={scrollRef} className="safe-b h-full overflow-y-auto">
        {children}
      </div>
    </>
  )
}
