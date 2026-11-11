import type { ThreadMessageLike } from '@assistant-ui/react'
import type { StreamDeltaPayload, TranscriptMessage } from '@topoi/core'

import { deliveredFiles, kindOfName, parseRow, pathLabel, type RowAttachment } from './attachments'

export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  text: string
  /** The files a row named besides its prose, lifted out of its text so the
   *  bubble paints what was said and one row per file sits below it. Absent on
   *  a row that named none, and on a cached transcript written before rows had
   *  them. */
  attachments?: RowAttachment[]
  /** The gateway's own row class (`steer`, `model_switch`, …). A prompt written
   *  inside a turn is not the turn's end, and this is what tells one apart. */
  kind?: string
  /** Mid-turn commentary rather than the turn's answer: painted quiet, so the
   *  reply stays the one thing on the screen at full ink. */
  interim?: boolean
}

function textOf(row: TranscriptMessage): string {
  return row.text ?? ''
}

/** One row as the transcript paints it.
 *
 *  The gateway stamps its own attachment lines onto a stored prompt (an `@image:`
 *  ref per staged picture, an `[Image attached at: …]` note, `[screenshot]`
 *  where the text-only projection dropped the pixels) and appends a
 *  recalled-memory block. Text and files therefore go through the SAME parsers
 *  the live send uses, which is what makes a reloaded turn identical to the one
 *  just sent: the same prose, the same one row per file, no duplicate bubble. */
export function paintedRow(role: ChatRole, text: string): ChatMessage {
  if (role === 'assistant') {
    const answer = deliveredFiles(text)
    if (!answer.files.length) return { role, text: answer.text }
    const attachments = answer.files.map(file => ({
      kind: kindOfName(file),
      label: pathLabel(file),
      path: file
    }))
    return { role, text: answer.text, attachments }
  }
  const row = parseRow(text)
  return row.attachments.length ? { role, text: row.text, attachments: row.attachments } : { role, text: row.text }
}

export function transcriptToMessages(rows: TranscriptMessage[]): ChatMessage[] {
  const messages: ChatMessage[] = []
  for (const row of rows) {
    if (row.role !== 'user' && row.role !== 'assistant') continue
    const painted = paintedRow(row.role, textOf(row))
    // The gateway's own row class rides along: a steer arrives as a user row, and
    // reading it as a fresh prompt would end the turn it was written inside.
    messages.push(row.display_kind ? { ...painted, kind: row.display_kind } : painted)
  }
  return messages
}

export function toThreadMessages(messages: ChatMessage[]): ThreadMessageLike[] {
  return messages.map(message => ({
    role: message.role,
    content: [{ type: 'text', text: message.text }]
  }))
}

/** Append a streamed delta to the last assistant message, opening one when
 *  the stream starts. Returns a new array; the previous state is untouched. The
 *  delta text is raw, so any rows a resume had lifted out are dropped here and
 *  re-read off the full text when the turn completes. */
export function applyDelta(messages: ChatMessage[], delta: StreamDeltaPayload): ChatMessage[] {
  const next = messages.slice()
  const last = next[next.length - 1]
  if (last && last.role === 'assistant') {
    next[next.length - 1] = { role: 'assistant', text: last.text + delta.text }
  } else {
    next.push({ role: 'assistant', text: delta.text })
  }
  return next
}

/** A delta that arrived while a rebuild was fetching, applied on top of the
 *  transcript that fetch answered. `painted` is the answer text the screen already
 *  held when the rebuild was asked for: text it ended with is the same words
 *  arriving twice, not more of them, so it is dropped. Text it did not end with is
 *  applied, because a snapshot built before this delta cannot contain it. */
export function replayDelta(messages: ChatMessage[], delta: StreamDeltaPayload): ChatMessage[] {
  const text = delta.text.trim()
  const last = messages[messages.length - 1]
  const rebuilt = last?.role === 'assistant' ? last.text : ''
  // The rebuild's transcript already ends with this chunk: the snapshot was built
  // after it was emitted, so appending it would double the tail.
  if (text && rebuilt.trimEnd().endsWith(text)) return messages.slice()
  return applyDelta(messages, delta)
}

/** A completed answer's final text, applied to the rows on screen: it replaces
 *  the answer this screen is already painting, and opens one when the turn's
 *  rows are gone. Shared by the live event and by the replay of an event that
 *  arrived while a rebuild was fetching, so both land the same way. */
export function applyFinal(messages: ChatMessage[], finalText: string | null): ChatMessage[] {
  const next = messages.slice()
  const last = next[next.length - 1]
  if (last && last.role === 'assistant') {
    if (finalText) next[next.length - 1] = paintedRow('assistant', finalText)
  } else if (finalText) {
    next.push(paintedRow('assistant', finalText))
  }
  return next
}

/** One thing that landed while a cold rebuild was fetching, replayed onto its
 *  result: a delta (deduped against the rebuilt tail), a final, or the prompt this
 *  screen sent in the meantime. */
export type HeldEvent = { delta?: StreamDeltaPayload; final?: string | null; local?: ChatMessage }

export function applyHeld(messages: ChatMessage[], event: HeldEvent): ChatMessage[] {
  if (event.delta) return replayDelta(messages, event.delta)
  const sent = event.local
  if (sent) {
    if (messages.some(row => row.role === sent.role && row.text.trim() === sent.text.trim())) return messages
    return [...messages, sent]
  }
  return applyFinal(messages, event.final ?? null)
}

/** What the transcript paints. The gateway projects a tool step as an assistant
 *  row with no text, so a run of consecutive calls arrives as a run of empty
 *  rows: they fold into the one ellipsis that run earns, and a text row ends the
 *  run. A lone empty row is kept, because it is the run. */
export function collapseToolSteps(messages: ChatMessage[]): ChatMessage[] {
  const collapsed: ChatMessage[] = []
  for (const message of messages) {
    const previous = collapsed[collapsed.length - 1]
    const empty = !message.text.trim()
    if (empty && message.role === 'assistant' && previous?.role === 'assistant' && !previous.text.trim()) continue
    collapsed.push(message)
  }
  return collapsed
}

/** The row class core stamps on a prompt the person wrote while a turn was still running: it belongs to the turn it interrupted, never to the next one. */
export const STEER_KIND = 'steer'

/** Whether this row is part of what a turn answered: words, or files and no words (an answer that was only a delivery), and never a row the gateway classified. A classed row is machinery (`failed_turn`, `internal_notification`, …), and an assistant row with neither words nor files is a tool step, which `collapseToolSteps` already folded into one ellipsis. */
function carriesAnswer(message: ChatMessage | undefined): boolean {
  if (!message || message.role !== 'assistant' || message.kind) return false
  return Boolean(message.text.trim() || message.attachments?.length)
}

/** Which of a turn's rows are commentary, and which are the answer.
 *
 *  The gateway persists a mid-turn message as an ordinary assistant row with text and no marker of its own, so which rows are the answer can only be read from where they sit: what a turn ends on is what it answered.
 *  A turn runs from one prompt to the next, and a steer belongs to the turn it interrupted rather than starting a new one.
 *  Only the last answer-carrying row is protected, never the run behind it, because a commentary row can sit directly above the answer with no tool step between them (the tool-less turn emits an interim too) and pulling the run back would swallow it.
 *  Every word-bearing assistant row before that one is commentary, and nothing else is touched: a user row, a tool step and a file-only row keep the ink they had.
 *
 *  A classed row at the end of a turn is skipped on the walk back, so it never becomes the answer: it stays at full ink and the answer behind it keeps its own, while the commentary above still dims. */
export function markInterim(messages: ChatMessage[]): ChatMessage[] {
  // A prompt the person wrote ends a turn. A steer does not: it belongs to the
  // turn it interrupted. Every other class is left as a boundary on purpose, so a
  // future kind landing on a real prompt under-dims one row instead of dimming a
  // real answer.
  const turned = (index: number): boolean => messages[index].role === 'user' && messages[index].kind !== STEER_KIND
  const interim = new Set<number>()
  const closeTurn = (start: number, end: number) => {
    let last = end - 1
    while (last >= start && !carriesAnswer(messages[last])) last -= 1
    if (last < start) return
    // The answer is the row the turn ENDS on, never the run behind it: a commentary
    // row can sit directly above the answer with no tool step between them (the
    // tool-less turn emits an interim too), and pulling the run back would swallow
    // it. Files a row delivered after the words ride along with it.
    for (let index = start; index < last; index += 1) {
      // A classed row is machinery at full ink (`failed_turn`, `content_refused`):
      // it is not a turn's commentary, so it is never marked quiet.
      const message = messages[index]
      if (message.role === 'assistant' && !message.kind && message.text.trim()) interim.add(index)
    }
  }
  let start = 0
  for (let index = 0; index < messages.length; index += 1) {
    if (!turned(index)) continue
    closeTurn(start, index)
    start = index + 1
  }
  closeTurn(start, messages.length)
  // A paint that changes nothing hands back the very same rows, so a streamed
  // delta does not shallow-copy the whole transcript on every frame.
  if (!interim.size && !messages.some(message => message.interim)) return messages
  return messages.map((message, index) => {
    const quiet = interim.has(index)
    if (quiet === Boolean(message.interim)) return message
    if (!quiet) {
      const copy = { ...message }
      delete copy.interim
      return copy
    }
    return { ...message, interim: true }
  })
}

/** Core's own framing of a scheduled run's seed: `[Cron delivery: <job>]` opens the
 *  first user row of a mirrored thread. The plugin strips it from the surfaces it
 *  renders; this is the same shape, matched case-insensitively and once. */
const CRON_DELIVERY_LABEL = /^\[cron delivery:[^\]]*\]\s*/i

/** Whether this row is the delivery that seeded a mirrored cron thread. */
export function isCronDelivery(message: ChatMessage): boolean {
  return message.role === 'user' && CRON_DELIVERY_LABEL.test(message.text)
}

/** The transcript a cron reply paints: the delivery that seeded the thread is
 *  the reader's document, not something the person typed, so its bubble is
 *  dropped. Only the opening row, and only when it carries the label, so the
 *  first turn of every other thread is left alone. */
export function hideCronDelivery(messages: ChatMessage[]): ChatMessage[] {
  const first = messages[0]
  if (!first || !isCronDelivery(first)) return messages
  return messages.slice(1)
}
