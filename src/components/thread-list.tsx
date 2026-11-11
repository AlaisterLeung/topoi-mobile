import { ChevronLeft, Plus } from 'lucide-react'

import type { ThreadRow, TopicEntry } from '../lib/topics'
import { shortStamp } from '../lib/time'
import { LoadingOverlay } from './loading-overlay'
import { PullToRefresh } from './pull-to-refresh'

export function ThreadList({
  topic,
  threads,
  loading,
  creating,
  onRefresh,
  onBack,
  onOpen,
  onNewThread
}: {
  topic: TopicEntry
  threads: ThreadRow[]
  /** Nothing truthful to list yet: the pane covers the list until the rows are up. */
  loading: boolean
  creating: boolean
  /** A pull down re-fetches this topic's threads. */
  onRefresh: () => Promise<unknown> | unknown
  onBack: () => void
  onOpen: (thread: ThreadRow) => void
  onNewThread: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-1 border-b border-white/10 px-2 py-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to topics"
          className="p-1.5 text-zinc-300 active:text-white"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="min-w-0 flex-1 truncate text-base font-medium">{topic.name}</span>
        <button
          type="button"
          onClick={onNewThread}
          disabled={creating}
          aria-label="New thread"
          className="p-1.5 text-zinc-300 active:text-white disabled:opacity-40"
        >
          <Plus className="h-5 w-5" />
        </button>
      </header>
      <div className="relative flex-1 overflow-hidden">
        <PullToRefresh onRefresh={onRefresh} disabled={loading}>
          {!loading && threads.length === 0 && (
            <p className="px-4 py-6 text-sm text-zinc-500">No threads yet.</p>
          )}
          {threads.map(thread => (
            <button
              key={thread.session_id}
              type="button"
              onClick={() => onOpen(thread)}
              className="block w-full border-b border-white/5 px-4 py-3 text-left active:bg-white/5"
            >
              <div className="flex items-baseline gap-3">
                <div className="min-w-0 flex-1 truncate text-base font-medium">
                  {thread.title || 'Untitled thread'}
                </div>
                <div className="shrink-0 text-xs tabular-nums text-zinc-500">
                  {shortStamp(thread.last_active)}
                </div>
              </div>
              {thread.latest_message && (
                <div className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{thread.latest_message}</div>
              )}
            </button>
          ))}
        </PullToRefresh>
        <LoadingOverlay visible={loading} label="Loading threads…" />
      </div>
    </div>
  )
}
