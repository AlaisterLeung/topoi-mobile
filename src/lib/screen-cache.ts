import { loadBaseUrl } from './config'

/** The screens' list cache.
 *
 *  A screen reads its own payload back from here before it fetches, so a topic,
 *  a thread list or a transcript that was seen once paints at once and the fetch
 *  that follows only corrects it. The memory copy is the same session's, and
 *  localStorage carries the entries across launches; a payload this shape can
 *  change under, so every entry is versioned and an old one is dropped rather
 *  than rendered. */

const VERSION = 1
const PREFIX = 'topoi.cache'

/** The newest rows kept for one transcript: a chat's rows are the biggest thing
 *  cached, and a couple of long threads would fill the webview's storage. */
const MESSAGE_LIMIT = 200

interface Envelope<T> {
  v: number
  at: number
  data: T
}

/** Keys are scoped by the gateway the data came from, so a client pointed at
 *  another server never renders the previous one's rows. */
export const cacheKeys = {
  topics: () => 'topics',
  threads: (topicId: string) => `threads.${topicId}`,
  messages: (sessionId: string) => `messages.${sessionId}`,
  /** A scheduled run's result document, keyed by the row it was opened from. */
  cron: (sessionId: string) => `cron.${sessionId}`
}

const memory = new Map<string, Envelope<unknown>>()

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // A webview with storage switched off throws on the property itself.
    return null
  }
}

/** A djb2 hash of the gateway URL: short, stable, and enough to keep two
 *  servers' entries apart. */
function scope(): string {
  const url = loadBaseUrl()
  let hash = 5381
  for (let index = 0; index < url.length; index += 1) {
    hash = ((hash << 5) + hash + url.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

function fullKey(key: string): string {
  return `${PREFIX}.${scope()}.${key}`
}

/** The payload cached for a key, or null when there is none to render. The
 *  memory copy is checked first, so a screen opened again in the same session
 *  does not pay for a parse. */
export function readCache<T>(key: string): T | null {
  const name = fullKey(key)
  const hit = memory.get(name)
  if (hit) return hit.data as T
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(name)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Envelope<T>
    if (parsed.v !== VERSION) {
      store.removeItem(name)
      return null
    }
    memory.set(name, parsed)
    return parsed.data
  } catch {
    return null
  }
}

/** Store a payload for the screen's next open. Persistence is best effort: a
 *  full quota drops the cached transcripts (the largest entries) and tries the
 *  write once more, and a payload that still does not fit is simply not kept. */
export function writeCache<T>(key: string, data: T): void {
  const name = fullKey(key)
  const envelope: Envelope<T> = { v: VERSION, at: Date.now(), data }
  memory.set(name, envelope)
  const store = storage()
  if (!store) return
  try {
    store.setItem(name, JSON.stringify(envelope))
  } catch {
    if (!dropStored(store, 'messages.')) return
    try {
      store.setItem(name, JSON.stringify(envelope))
    } catch {
      // Still too large: the next open fetches it again instead.
    }
  }
}

/** One entry, dropped: a screen that wants its next open to fetch instead of
 *  painting a copy it no longer trusts. Everything else stays cached. */
export function dropCache(key: string): void {
  const name = fullKey(key)
  memory.delete(name)
  const store = storage()
  if (!store) return
  store.removeItem(name)
}

/** Sign-out, and any switch of gateway: nothing cached belongs to the next one. */
export function clearCache(): void {
  memory.clear()
  const store = storage()
  if (!store) return
  for (const name of storedKeys(store, `${PREFIX}.`)) store.removeItem(name)
}

function storedKeys(store: Storage, prefix: string): string[] {
  const names: string[] = []
  for (let index = 0; index < store.length; index += 1) {
    const name = store.key(index)
    if (name && name.startsWith(prefix)) names.push(name)
  }
  return names
}

function dropStored(store: Storage, marker: string): boolean {
  const names = storedKeys(store, `${PREFIX}.`).filter(name => name.includes(marker))
  for (const name of names) {
    store.removeItem(name)
    memory.delete(name)
  }
  return names.length > 0
}

/** Keep a transcript's tail: the newest rows are the ones a reader comes back
 *  to, and the cap is what bounds the whole cache. */
export function tailOf<T>(rows: T[]): T[] {
  return rows.length > MESSAGE_LIMIT ? rows.slice(rows.length - MESSAGE_LIMIT) : rows
}
