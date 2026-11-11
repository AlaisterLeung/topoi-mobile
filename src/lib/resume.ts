import type { SessionResumeResult } from '@topoi/core'

import { paintedRow, type ChatMessage, type ChatRole } from './chat'

/** The names a chat answers to, in the order they are asked: the stored row id first, because it is the one that survives a gateway restart. */
export function idSet(...values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

/** Whether two rows of one role are the same row. A prompt is only ever its own text, while a partial answer is the same answer for as long as one side is a prefix of the other: the screen can be behind the snapshot (deltas missed while the socket was down, or a transcript cached before the app closed) or ahead of it (deltas that landed before the resume answered). */
function sameRow(role: ChatRole, one: string, other: string): boolean {
  const a = one.trim()
  const b = other.trim()
  if (a === b) return true
  return role === 'assistant' && (a.startsWith(b) || b.startsWith(a))
}

/** The transcript a COLD rebuild paints, and the whole of a tapped refresh: the
 *  gateway's transcript plus the turn it is still running, and from the screen's
 *  own rows only the prompt it sent a moment ago that the gateway has not written
 *  yet. An answer the gateway does not hold never survives the tap - that is the
 *  row the warm merge carried forward on every refresh, which is why the header
 *  button could not clear a duplicate while the settings cache wipe could. The
 *  trade is the sub-second window between `message.complete` and the gateway
 *  writing its row: an answer settled inside it is gone from the view until the
 *  next resume, which paints it back. Self-healing, and never a duplicate. */
export function rebuildTranscript(
  stored: ChatMessage[],
  local: ChatMessage[],
  resume: SessionResumeResult
): ChatMessage[] {
  // Nothing the gateway does not hold survives above the prompts: an answer row
  // there is the stray bubble a refresh exists to remove, and two of them are the
  // duplicate itself.
  let start = local.length
  while (start > 0 && local[start - 1]?.role !== 'user') start -= 1
  // Then the trailing run of prompts the gateway has not written yet - only they
  // are handed on, because `resumeTranscript` keeps every row it is given.
  const end = start
  while (start > 0 && local[start - 1]?.role === 'user') start -= 1
  return resumeTranscript(stored, local.slice(start, end), resume)
}

/** The transcript a resume paints. Its stored rows are what the gateway has WRITTEN; the turn it is still running is not written yet, so its prompt and its partial answer are rebuilt from the resume's own inflight snapshot, and whatever this screen already had after the last row the gateway knows is kept: a prompt sent a moment ago must not vanish on the way back into the thread. The live turn is painted ONCE: a row of it that the screen already carries is dropped rather than painted beside the snapshot, so an answer that missed a delta (or one the screen is ahead of) cannot arrive as two bubbles of the same answer. */
export function resumeTranscript(
  stored: ChatMessage[],
  local: ChatMessage[],
  resume: SessionResumeResult
): ChatMessage[] {
  const rows = stored.slice()
  const key = (message: ChatMessage) => `${message.role}|${message.text}`
  const known = new Set(rows.map(key))
  const text = (value: string | null | undefined) => (value ?? '').trim()
  const push = (message: ChatMessage) => {
    if (known.has(key(message))) return
    rows.push(message)
    known.add(key(message))
  }
  // The running turn, which the gateway has written nowhere yet. Its prompt is
  // read through the same parser a stored row gets, because the gateway stamps
  // its own attachment lines onto it: comparing the raw text would paint this
  // turn twice, once from the snapshot and once from the screen.
  const live: ChatMessage[] = []
  if (resume.running) {
    const prompt = text(resume.inflight?.user)
    if (prompt) live.push(paintedRow('user', prompt))
    const answer = text(resume.inflight?.assistant)
    if (answer) live.push(paintedRow('assistant', answer))
  }
  // The screen's own tail, from the first row the gateway has not written yet: a prompt whose row is still landing, or an answer still streaming. Its copy of a live row claims that row instead of being painted beside it, so the running turn shows once, and a row of the tail that no live row claims is a row of its own (a prompt sent while the turn runs, for instance) and is kept.
  const lastStored = stored[stored.length - 1]
  const from = lastStored ? local.map(key).lastIndexOf(key(lastStored)) + 1 : 0
  const pending = live.slice()
  const unclaimed: ChatMessage[] = []
  for (const message of local.slice(from)) {
    const index = pending.findIndex(row => row.role === message.role && sameRow(row.role, row.text, message.text))
    if (index < 0) {
      unclaimed.push(message)
      continue
    }
    const row = pending[index]
    pending.splice(index, 1)
    // The screen's own answer is the one to paint when it is AHEAD of the snapshot, because the next delta appends to the last painted text.
    if (row.role === 'assistant' && message.text.trim().length > row.text.length) row.text = message.text
  }
  for (const message of live) push(message)
  for (const message of unclaimed) push(message)
  return rows
}
