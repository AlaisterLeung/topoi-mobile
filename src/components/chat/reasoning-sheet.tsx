import { Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { messageOf } from '../../lib/errors'
import { effortTitle, REASONING_EFFORTS, reasoningEnabled } from '../../lib/model-catalog'
import { Sheet } from './sheet'

/** The reasoning sheet: thinking on/off, a rule, then the effort ladder under its
 *  own label. No heading or close button (the grab handle and the backdrop are
 *  the exits), and the panel fits its content - the ladder is a fixed seven rows,
 *  so a reserved two thirds leaves dead space under `Ultra`. `none` is the
 *  gateway's own off state, so the toggle writes `none` rather than a display
 *  word (`off`/`hide` only hide the thinking text). */
export function ReasoningSheet({
  open,
  onClose,
  value,
  onChange,
  onLoad,
  onPick
}: {
  open: boolean
  onClose: () => void
  value: string
  onChange: (value: string) => void
  onLoad: () => Promise<string>
  onPick: (value: string) => Promise<void>
}) {
  const [failure, setFailure] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  /** The last real effort this chat had, and the getters, held in refs: a fresh
   *  callback identity must not re-run the open under the user's finger. */
  const lastEffort = useRef(value && value !== 'none' ? value : 'medium')
  const load = useRef(onLoad)
  const read = useRef(onChange)
  load.current = onLoad
  read.current = onChange
  /** Set by the first pick of an open: the on-open read is a snapshot from
   *  before that tap and must not paint over it. */
  const picked = useRef(false)

  useEffect(() => {
    if (value && value !== 'none') lastEffort.current = value
  }, [value])

  useEffect(() => {
    if (!open) return
    let live = true
    picked.current = false
    setLoading(true)
    setFailure(null)
    load.current().then(
      answer => {
        if (!live) return
        if (!picked.current) read.current(answer)
        setLoading(false)
      },
      error => {
        if (!live) return
        setFailure(messageOf(error))
        setLoading(false)
      }
    )
    return () => {
      live = false
    }
  }, [open, attempt])

  const enabled = reasoningEnabled(value)

  const apply = (next: string) => {
    const previous = value
    picked.current = true
    onChange(next)
    onPick(next).catch(error => {
      onChange(previous)
      setFailure(messageOf(error))
    })
  }

  return (
    <Sheet open={open} onClose={onClose} title="Reasoning" fit>
      <div className="flex shrink-0 items-center justify-between px-4 pt-1 pb-2">
        <span className="text-sm">Thinking</span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Thinking"
          data-thinking-toggle
          onClick={() => apply(enabled ? 'none' : lastEffort.current)}
          className={`h-7 w-12 shrink-0 rounded-full p-0.5 ${enabled ? 'bg-primary' : 'bg-white/15'}`}
        >
          <span
            className={`block h-6 w-6 rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
      <div className="shrink-0 border-t border-white/10" />
      <h2 className="shrink-0 px-4 pt-2 pb-0.5 text-xs uppercase tracking-wide text-zinc-500">Reasoning efforts</h2>
      {/* No height cap of its own: the panel's max-height is the only budget, the
          chrome above is shrink-0, so this is the one child that yields and it
          scrolls only when the visible area genuinely cannot hold seven rows. */}
      <div className="min-h-0 overflow-y-auto overscroll-contain pb-2">
        {loading && <p className="px-4 py-3 text-xs text-zinc-500">Loading reasoning…</p>}
        {failure && (
          <p className="px-4 py-3 text-xs text-red-400">
            {failure}
            <button type="button" onClick={() => setAttempt(count => count + 1)} className="ml-2 underline">
              Retry
            </button>
          </p>
        )}
        {REASONING_EFFORTS.map(effort => {
          const active = value === effort
          return (
            <button
              key={effort}
              type="button"
              data-reasoning-row={effort}
              onClick={() => {
                apply(effort)
                onClose()
              }}
              className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm active:bg-white/5 ${
                enabled ? '' : 'text-zinc-500'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{effortTitle(effort)}</span>
              {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}
