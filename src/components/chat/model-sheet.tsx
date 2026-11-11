import { Check, Search } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { messageOf } from '../../lib/errors'
import {
  bareModel,
  filterGroups,
  moaPresets,
  providerGroups,
  type ModelOptions
} from '../../lib/model-catalog'
import { Sheet } from './sheet'

/** The desktop model menu, at phone size: search at the top, one group per
 *  provider in the scroller, then the MoA presets in their own anchored section
 *  under a rule, so a long catalogue never scrolls them out of reach. No heading
 *  or close button: the sheet's grab handle and the backdrop are the exits. A pick
 *  closes the sheet; the chat owns applying it. */
export function ModelSheet({
  open,
  onClose,
  current,
  onLoad,
  onPick
}: {
  open: boolean
  onClose: () => void
  current: { provider: string; model: string }
  onLoad: () => Promise<ModelOptions>
  onPick: (provider: string, model: string) => void
}) {
  const [options, setOptions] = useState<ModelOptions | null>(null)
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [attempt, setAttempt] = useState(0)
  /** `onLoad` rides `liveId`, which moves with the chat's ids; holding it in a
   *  ref keeps a fresh identity from re-running the open and clearing the search. */
  const load = useRef(onLoad)
  load.current = onLoad

  useEffect(() => {
    if (!open) return
    let live = true
    setLoading(true)
    setFailure(null)
    setQuery('')
    load.current().then(
      answer => {
        if (!live) return
        setOptions(answer)
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
    // The retry counter is the only other trigger: `load` is a ref precisely so a
    // new callback identity cannot refetch and clear the search under the user.
  }, [open, attempt])

  const groups = useMemo(() => filterGroups(providerGroups(options), query), [options, query])
  const moa = useMemo(() => moaPresets(options), [options])
  const presets = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? moa.presets.filter(name => name.toLowerCase().includes(needle)) : moa.presets
  }, [moa, query])

  /** The tick is STRICT: a tail that two providers both list must never show two
   *  checkmarks, and an unseeded chip (provider empty) ticks nothing rather than
   *  guessing. */
  const isActive = (provider: string, model: string) =>
    Boolean(current.provider) && current.provider === provider && bareModel(current.model) === bareModel(model)

  /** The ONE row to jump to, chosen by priority rather than by a predicate that can
   *  match many: an exact provider+tail match wins, and a chip with no provider yet
   *  falls back to the first tail match in tree order. */
  const rows = useMemo(
    () => [
      ...groups.flatMap(group => group.models.map(model => ({ provider: group.slug, model }))),
      ...presets.map(preset => ({ provider: 'moa', model: preset }))
    ],
    [groups, presets]
  )
  const scrollTarget = useMemo(() => {
    if (!current.model) return ''
    const tail = bareModel(current.model)
    const exact = rows.find(row => row.provider === current.provider && bareModel(row.model) === tail)
    const hit = exact ?? rows.find(row => bareModel(row.model) === tail)
    return hit ? `${hit.provider}/${hit.model}` : ''
  }, [rows, current.provider, current.model])

  /** Scroll ONCE per open, and only against a settled catalogue. `options` is
   *  dropped WITH the close: this component stays mounted while the frame unmounts
   *  its children, so a reopen's first commit would otherwise paint - and scroll
   *  into - the previous open's list, because `loading` is only raised by the
   *  effect that starts the fetch and layout effects run before it. A miss (a
   *  model the catalogue does not list) leaves the list alone - never a fallback
   *  scroll to the top. */
  const activeRef = useRef<HTMLButtonElement | null>(null)
  const scrolled = useRef(false)
  useLayoutEffect(() => {
    if (!open) {
      scrolled.current = false
      setOptions(null)
      return
    }
    if (loading || !options || scrolled.current || !scrollTarget) return
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    scrolled.current = true
  }, [open, loading, options, scrollTarget])

  return (
    <Sheet open={open} onClose={onClose} title="Model">
      <div className="px-4 pt-1 pb-2">
        <label className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-zinc-500" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search models"
            aria-label="Search models"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-500"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        {loading && <p className="px-4 py-3 text-xs text-zinc-500">Loading models…</p>}
        {failure && (
          <p className="px-4 py-3 text-xs text-red-400">
            {failure}
            <button type="button" onClick={() => setAttempt(count => count + 1)} className="ml-2 underline">
              Retry
            </button>
          </p>
        )}
        {groups.map(group => (
          <section key={group.slug}>
            <h2 className="sticky top-0 z-10 bg-surface px-4 py-1 text-xs uppercase tracking-wide text-zinc-500">
              {group.name}
            </h2>
            {group.models.map(model => {
              const active = isActive(group.slug, model)
              const rowKey = `${group.slug}/${model}`
              return (
                <button
                  key={rowKey}
                  type="button"
                  data-sheet-item={rowKey}
                  ref={rowKey === scrollTarget ? activeRef : null}
                  onClick={() => {
                    onPick(group.slug, model)
                    onClose()
                  }}
                  // `scroll-mt-7` keeps the row clear of its own sticky provider
                  // header (py-1 + the xs line box ≈ 24px) when the open scrolls it
                  // to the nearest edge.
                  className="flex w-full scroll-mt-7 items-center gap-2 px-4 py-2.5 text-left text-sm active:bg-white/5"
                >
                  <span className="min-w-0 flex-1 truncate">{bareModel(model)}</span>
                  {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              )
            })}
          </section>
        ))}
        {!loading && !failure && groups.length === 0 && presets.length === 0 && (
          <p className="px-4 py-3 text-xs text-zinc-500">No models match.</p>
        )}
      </div>
      {presets.length > 0 && (
        <section data-moa-presets className="shrink-0 border-t border-white/10">
          <h2 className="px-4 pt-2 pb-0.5 text-xs uppercase tracking-wide text-zinc-500">MoA presets</h2>
          <div className="max-h-32 overflow-y-auto overscroll-contain pb-2">
            {presets.map(preset => {
              const active = isActive('moa', preset)
              const rowKey = `moa/${preset}`
              return (
                <button
                  key={rowKey}
                  type="button"
                  data-sheet-item={rowKey}
                  ref={rowKey === scrollTarget ? activeRef : null}
                  onClick={() => {
                    onPick('moa', preset)
                    onClose()
                  }}
                  className="flex w-full scroll-mt-7 items-center gap-2 px-4 py-2.5 text-left text-sm active:bg-white/5"
                >
                  <span className="min-w-0 flex-1 truncate">{preset}</span>
                  {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              )
            })}
          </div>
        </section>
      )}
    </Sheet>
  )
}
