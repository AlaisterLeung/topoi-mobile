import { RestError, restJson } from './rest'

const PLUGIN = '/api/plugins/topoi'

/** How long a filing waits for the row a first prompt writes. */
export const FILE_WINDOW_MS = 30_000
const BIND_RETRY_MS = 700

export interface TopicEntry {
  id: string
  name: string
  archived?: boolean
}

export interface TopicRegistry {
  updated_at?: number
  home_id?: string
  entries: TopicEntry[]
}

export interface ThreadRow {
  session_id: string
  lineage_root: string
  topic_id: string
  title?: string | null
  /** The thread's newest user or assistant text, one line, capped by the gateway. */
  latest_message?: string | null
  started_at?: number | null
  last_active?: number | null
  message_count?: number | null
  source?: string
  /** A scheduled run's result: the plugin sets this from its delivery ledger, so an app-minted thread is never one. These rows open the read-only result screen, never a chat. */
  cron_result?: boolean
  /** Which reading copy the row is: a mirrored run thread, or the run itself. */
  cron_kind?: 'thread' | 'run' | null
  /** Whether a reply could land in the thread's seeded chat (the desktop reader's Reply). */
  replyable?: boolean
}

/** One cron result as a document: a mirrored run thread's brief, or a run's own final answer, with core's delivery label already stripped. */
export interface CronResult {
  session_id: string
  kind: 'thread' | 'run'
  title: string
  markdown: string
  job_id?: string | null
  replyable: boolean
  reply_session_id?: string | null
}

export interface ThreadsPage {
  threads: ThreadRow[]
  total: number
  limit: number
  offset: number
}

/** The registry in its stored order, archived topics left out. */
export async function listTopics(): Promise<TopicEntry[]> {
  const registry = await restJson<TopicRegistry>(`${PLUGIN}/topics`)
  return registry.entries.filter(entry => !entry.archived)
}

/** One topic's threads, newest activity first. */
export function listThreads(topicId: string, limit = 200): Promise<ThreadsPage> {
  const query = `topic=${encodeURIComponent(topicId)}&limit=${limit}&offset=0`
  return restJson<ThreadsPage>(`${PLUGIN}/threads?${query}`)
}

/** Every topic's threads, newest activity first: the home screen reads the first row per topic as that topic's latest thread. */
export function listAllThreads(limit = 200): Promise<ThreadsPage> {
  return restJson<ThreadsPage>(`${PLUGIN}/threads?limit=${limit}&offset=0`)
}

export function bindThread(sessionId: string, topicId: string): Promise<unknown> {
  return restJson(`${PLUGIN}/threads/bind`, {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, topic_id: topicId })
  })
}

/** File a freshly created thread under its topic.
 *
 *  The stored row lands a moment after the first prompt is accepted, so the
 *  opening attempts answer 404 by design and only that status is retried;
 *  anything else is a real refusal. `sessionId` is the stored id, which is
 *  what the bind route resolves. */
export async function fileThread(sessionId: string, topicId: string): Promise<void> {
  const deadline = Date.now() + FILE_WINDOW_MS
  for (;;) {
    try {
      await bindThread(sessionId, topicId)
      return
    } catch (error) {
      const missing = error instanceof RestError && error.status === 404
      if (!missing || Date.now() >= deadline) throw error
      await new Promise(resolve => setTimeout(resolve, BIND_RETRY_MS))
    }
  }
}

/** The result a scheduled run left behind, read off the row it was listed on.
 *
 *  The row's own id is what the route takes, so a client never has to know which kind it opened: a mirrored run thread answers its brief, a run answers its final text. A non-cron session is a 422 and an unknown one a 404, so a stale row says so instead of painting an empty screen. */
export function cronResult(sessionId: string): Promise<CronResult> {
  return restJson<CronResult>(`${PLUGIN}/threads/${encodeURIComponent(sessionId)}/cron`)
}
