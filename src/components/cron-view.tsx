import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, MessagesSquare } from 'lucide-react'

import { messageOf } from '../lib/errors'
import { cacheKeys, writeCache } from '../lib/screen-cache'
import { cronResult, type CronResult } from '../lib/topics'
import { LoadingOverlay } from './loading-overlay'
import { MessageBubble } from './chat/message'

/** A scheduled run's result, read only.
 *
 *  The plugin answers one document per row: a mirrored run thread's brief with core's delivery label already stripped, or a run's own final answer, whichever the listed row was. It paints as an assistant turn because it is one, the agent wrote it, and there is no composer: a result is read on the phone, never continued from here. A replyable row (the plugin's delivery ledger proved a live mirrored thread) earns one control, the reply button in the header, which hands that seeded thread to the chat screen; the reader itself stays read only. */
export function CronView({
  sessionId,
  title,
  replyable,
  initialResult,
  onBack,
  onReply
}: {
  sessionId: string
  /** The title the row was listed with: the job's name. */
  title: string
  /** Whether this row's own listing said the seeded thread is live: the reply button exists only then, because a run row has no chat to open. */
  replyable: boolean
  /** The result cached for this row, or null when none is stored: null is what raises the load pane, because there is nothing truthful to show. */
  initialResult: CronResult | null
  onBack: () => void
  /** Open the seeded thread this result came from, in the chat screen. */
  onReply: () => void
}) {
  const [result, setResult] = useState<CronResult | null>(initialResult)
  const [loading, setLoading] = useState(initialResult === null)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  /** One fetch per open, and only when nothing is cached. A delivered result is
   *  read-only and never changes afterwards, so the stored copy is the answer:
   *  no refetch behind the screen, and no pane when a reply hands the reader back. */
  useEffect(() => {
    if (started.current || initialResult !== null) return
    started.current = true
    void (async () => {
      try {
        const next = await cronResult(sessionId)
        writeCache(cacheKeys.cron(sessionId), next)
        setResult(next)
        setError(null)
      } catch (err) {
        setError(messageOf(err))
      }
      setLoading(false)
    })()
  }, [sessionId])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-1 border-b border-white/10 px-2 py-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to threads"
          className="p-1.5 text-zinc-300 active:text-white"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="min-w-0 flex-1 truncate text-base font-medium">{result?.title || title}</span>
        {replyable && (
          <button
            type="button"
            onClick={onReply}
            data-reply-button
            aria-label="Reply in thread"
            className="p-1.5 text-zinc-300 active:text-white"
          >
            <MessagesSquare className="h-5 w-5" />
          </button>
        )}
      </header>
      <div className="relative flex-1 overflow-hidden">
        <div data-result className="safe-b h-full overflow-x-hidden overflow-y-auto py-2">
          {result && !result.markdown.trim() && (
            <p className="px-3 py-1.5 text-base text-zinc-500">This run left no result.</p>
          )}
          {result && result.markdown.trim() && <MessageBubble role="assistant" text={result.markdown} />}
          {error && <p className="px-4 py-1 text-xs text-red-400">{error}</p>}
        </div>
        <LoadingOverlay visible={loading} label="Loading result…" />
      </div>
    </div>
  )
}
