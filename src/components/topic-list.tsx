import { EllipsisVertical } from 'lucide-react'

import type { ThreadRow, TopicEntry } from '../lib/topics'
import { shortStamp } from '../lib/time'
import { LoadingOverlay } from './loading-overlay'
import { PullToRefresh } from './pull-to-refresh'

export function TopicList({
  topics,
  latest,
  loading,
  onRefresh,
  onOpen,
  onOpenSettings
}: {
  topics: TopicEntry[]
  latest: Record<string, ThreadRow>
  /** Nothing truthful to list yet: the pane covers the list until the rows are up. */
  loading: boolean
  /** A pull down re-fetches the registry and every topic's latest thread. */
  onRefresh: () => Promise<unknown> | unknown
  onOpen: (topic: TopicEntry) => void
  onOpenSettings: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h1 className="font-logo text-xl font-extrabold tracking-tight text-white">Topoi.</h1>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Settings"
          className="-mr-1.5 p-1.5 text-zinc-300 active:text-white"
        >
          <EllipsisVertical className="h-5 w-5" />
        </button>
      </header>
      <div className="relative flex-1 overflow-hidden">
        <PullToRefresh onRefresh={onRefresh} disabled={loading}>
          {!loading && topics.length === 0 && (
            <p className="px-4 py-6 text-sm text-zinc-500">No topics yet.</p>
          )}
          {topics.map(topic => {
            const newest = latest[topic.id]
            return (
              <button
                key={topic.id}
                type="button"
                onClick={() => onOpen(topic)}
                className="block w-full border-b border-white/5 px-4 py-3 text-left active:bg-white/5"
              >
                <div className="flex items-baseline gap-3">
                  <div className="min-w-0 flex-1 truncate text-base font-medium">{topic.name}</div>
                  {newest && (
                    <div className="shrink-0 text-xs tabular-nums text-zinc-500">
                      {shortStamp(newest.last_active)}
                    </div>
                  )}
                </div>
                {newest && (
                  <div className="mt-0.5 truncate text-xs text-zinc-500">
                    {newest.title || 'Untitled thread'}
                  </div>
                )}
              </button>
            )
          })}
        </PullToRefresh>
        <LoadingOverlay visible={loading} label="Loading topics…" />
      </div>
    </div>
  )
}
