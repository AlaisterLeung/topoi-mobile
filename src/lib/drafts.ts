import type { PendingAttachment } from './attachments'

/** One composer's unsent state. A draft lives in memory for as long as the app
 *  runs: switching threads must never lose what was typed, and an app relaunch
 *  is free to start clean, so nothing is written to storage. */
export interface ComposerDraft {
  text: string
  attachments: PendingAttachment[]
}

const drafts = new Map<string, ComposerDraft>()

/** The surfaces a draft belongs to. A thread is named by the id that survives a
 *  gateway restart; the new thread a topic's plus button mints is named by its
 *  topic instead, because two presses mint two different sessions and the draft
 *  has to survive both. */
export const draftKeys = {
  thread: (sessionId: string) => `thread:${sessionId}`,
  newThread: (topicId: string) => `new:${topicId}`
}

export function isDraftEmpty(draft: ComposerDraft | null): boolean {
  return !draft || (!draft.text.trim() && draft.attachments.length === 0)
}

export function readDraft(key: string): ComposerDraft | null {
  return drafts.get(key) ?? null
}

/** Store what a composer holds. An empty draft is dropped rather than kept, so
 *  a reopen never raises an empty one over a clean composer. */
export function writeDraft(key: string, draft: ComposerDraft): void {
  if (isDraftEmpty(draft)) drafts.delete(key)
  else drafts.set(key, draft)
}

/** Carry a draft from the surface it was written on to the one that replaced
 *  it: a new thread's draft moves to that thread once it is filed. */
export function moveDraft(from: string, to: string): void {
  const draft = drafts.get(from)
  if (!draft) return
  drafts.delete(from)
  drafts.set(to, draft)
}

export function dropDraft(key: string): void {
  drafts.delete(key)
}

/** Sign-out: nothing typed belongs to the session that follows. */
export function clearDrafts(): void {
  drafts.clear()
}
