import type { StreamDeltaPayload, TranscriptMessage } from '@topoi/core'
import { describe, expect, it } from 'vitest'

import {
  applyDelta,
  applyFinal,
  applyHeld,
  collapseToolSteps,
  hideCronDelivery,
  markInterim,
  paintedRow,
  replayDelta,
  STEER_KIND,
  toThreadMessages,
  transcriptToMessages,
  type ChatMessage
} from './chat'

const delta = (text: string): StreamDeltaPayload => ({ text })

const asked: ChatMessage = { role: 'user', text: 'What is a topic?' }
const answered: ChatMessage = { role: 'assistant', text: 'A tree of threads.' }
const empty: ChatMessage = { role: 'assistant', text: '' }

describe('paintedRow', () => {
  it('reads a stored user row into its prose and its files', () => {
    const stored = [
      '[User attached image: IMG_1719.jpeg]',
      '',
      'I attached two memes.',
      '@image:/home/alaister/.hermes/images/upload_20261020_052226_1.jpeg',
      '[screenshot]'
    ].join('\n')
    expect(paintedRow('user', stored)).toEqual({
      role: 'user',
      text: 'I attached two memes.',
      attachments: [{ kind: 'image', label: 'IMG_1719.jpeg' }]
    })
  })

  it('reads the files an answer delivered', () => {
    expect(paintedRow('assistant', 'Here it is.\n\nMEDIA:/tmp/report.pdf')).toEqual({
      role: 'assistant',
      text: 'Here it is.',
      attachments: [{ kind: 'file', label: 'report.pdf', path: '/tmp/report.pdf' }]
    })
  })

  it('leaves a row that named nothing with no attachments at all', () => {
    expect(paintedRow('user', 'hello')).toEqual({ role: 'user', text: 'hello' })
  })
})

describe('transcriptToMessages', () => {
  it('keeps the user and assistant rows in order', () => {
    const rows: TranscriptMessage[] = [
      { role: 'user', text: 'What is a topic?' },
      { role: 'assistant', text: 'A tree of threads.' }
    ]
    expect(transcriptToMessages(rows)).toEqual([asked, answered])
  })

  it('drops the rows a chat does not paint', () => {
    const rows: TranscriptMessage[] = [
      { role: 'system', text: 'You are Hermes.' },
      { role: 'tool', text: 'ran a command' },
      { role: 'user', text: 'still here' }
    ]
    expect(transcriptToMessages(rows)).toEqual([{ role: 'user', text: 'still here' }])
  })

  it('reads a missing text as an empty one', () => {
    expect(transcriptToMessages([{ role: 'assistant' }, { role: 'user', text: null }])).toEqual([
      empty,
      { role: 'user', text: '' }
    ])
  })

  it('carries the row class a stored row names', () => {
    const rows: TranscriptMessage[] = [
      { role: 'user', text: 'Also check the cache.' },
      { role: 'user', text: 'a real prompt', display_kind: 'model_switch' }
    ]
    expect(transcriptToMessages(rows)).toEqual([
      { role: 'user', text: 'Also check the cache.' },
      { role: 'user', text: 'a real prompt', kind: 'model_switch' }
    ])
  })
})

describe('toThreadMessages', () => {
  it('wraps every row as assistant-ui text content', () => {
    expect(toThreadMessages([asked, answered])).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'What is a topic?' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'A tree of threads.' }] }
    ])
  })

  it('answers an empty list for an empty transcript', () => {
    expect(toThreadMessages([])).toEqual([])
  })
})

describe('applyDelta', () => {
  it('appends a delta to the assistant row that is streaming', () => {
    const streamed: ChatMessage[] = [{ role: 'assistant', text: 'A tree' }]
    expect(applyDelta(streamed, delta(' of threads.'))).toEqual([{ role: 'assistant', text: 'A tree of threads.' }])
  })

  it('opens an assistant row when the last one is the prompt', () => {
    expect(applyDelta([asked], delta('A tree of threads.'))).toEqual([asked, answered])
  })

  it('opens an assistant row when the transcript is empty', () => {
    expect(applyDelta([], delta('A tree of threads.'))).toEqual([answered])
  })

  it('returns a new array and leaves the previous rows untouched', () => {
    const streamed: ChatMessage[] = [{ role: 'assistant', text: 'A tree' }]
    const next = applyDelta(streamed, delta(' of threads.'))
    expect(next).not.toBe(streamed)
    expect(streamed).toEqual([{ role: 'assistant', text: 'A tree' }])
  })
})

describe('collapseToolSteps', () => {
  it('folds a run of empty assistant rows into one', () => {
    expect(collapseToolSteps([asked, empty, empty, empty, answered])).toEqual([asked, empty, answered])
  })

  it('keeps a lone empty row, because it is the run', () => {
    expect(collapseToolSteps([asked, empty, answered])).toEqual([asked, empty, answered])
  })

  it('starts a new run after a text row', () => {
    expect(collapseToolSteps([empty, answered, empty, empty])).toEqual([empty, answered, empty])
  })

  it('leaves an empty user row alone', () => {
    const blank: ChatMessage = { role: 'user', text: '   ' }
    expect(collapseToolSteps([blank, blank])).toEqual([blank, blank])
  })
})

describe('hideCronDelivery', () => {
  const delivery: ChatMessage = { role: 'user', text: '[Cron delivery: Morning briefing]\nBig tech earnings tonight.' }

  it('drops the delivery that seeded the thread', () => {
    expect(hideCronDelivery([delivery, answered])).toEqual([answered])
  })

  it('matches the label whatever its case and spacing', () => {
    expect(hideCronDelivery([{ role: 'user', text: '[CRON DELIVERY: nightly]  Swept three jobs.' }, answered])).toEqual([
      answered
    ])
  })

  it('leaves a thread whose first turn is a real prompt alone', () => {
    expect(hideCronDelivery([asked, answered])).toEqual([asked, answered])
  })

  it('only drops the opening row, never a later one', () => {
    const rows = [asked, delivery, answered]
    expect(hideCronDelivery(rows)).toEqual(rows)
  })

  it('has nothing to drop when the delivery is already gone', () => {
    expect(hideCronDelivery([answered])).toEqual([answered])
    expect(hideCronDelivery([])).toEqual([])
  })
})

describe('applyFinal', () => {
  it('replaces the answer the screen is painting', () => {
    const streamed: ChatMessage = { role: 'assistant', text: 'A conver' }
    expect(applyFinal([asked, streamed], 'A conversation!')).toEqual([asked, { role: 'assistant', text: 'A conversation!' }])
  })

  it('opens an answer when the newest row is a prompt', () => {
    expect(applyFinal([asked], 'A conversation!')).toEqual([asked, { role: 'assistant', text: 'A conversation!' }])
  })

  it('keeps the rows when the final carries no text', () => {
    expect(applyFinal([asked, answered], null)).toEqual([asked, answered])
  })

  it('leaves the array it was given alone', () => {
    const rows = [asked, answered]
    const next = applyFinal(rows, 'A conversation!')
    expect(rows[1]).toEqual(answered)
    expect(next).not.toBe(rows)
  })
})

describe('replayDelta', () => {
  it('applies a chunk the rebuilt transcript does not end with', () => {
    const row: ChatMessage = { role: 'assistant', text: 'A conver' }
    expect(replayDelta([asked, row], delta('sation!'))).toEqual([asked, { role: 'assistant', text: 'A conversation!' }])
  })

  it('drops a chunk the rebuilt transcript already ends with', () => {
    const row: ChatMessage = { role: 'assistant', text: 'A conversation!' }
    expect(replayDelta([asked, row], delta('sation!'))).toEqual([asked, row])
  })

  it('opens an answer when the newest row is a prompt', () => {
    expect(replayDelta([asked], delta('hi'))).toEqual([asked, { role: 'assistant', text: 'hi' }])
  })
})

describe('applyHeld', () => {
  it('replays a delta through the same dedupe', () => {
    const row: ChatMessage = { role: 'assistant', text: 'A conversation!' }
    expect(applyHeld([asked, row], { delta: delta('sation!') })).toEqual([asked, row])
  })

  it('lands a final on the answer it ends', () => {
    expect(applyHeld([asked, answered], { final: 'A conversation!' })).toEqual([
      asked,
      { role: 'assistant', text: 'A conversation!' }
    ])
  })

  it('drops a prompt the rebuilt transcript already paints', () => {
    expect(applyHeld([asked, answered], { local: asked })).toEqual([asked, answered])
  })

  it('appends a prompt the rebuilt transcript does not carry', () => {
    const sent: ChatMessage = { role: 'user', text: 'and another' }
    expect(applyHeld([asked, answered], { local: sent })).toEqual([asked, answered, sent])
  })
})

describe('markInterim', () => {
  const commentary: ChatMessage = { role: 'assistant', text: 'Boss, reading the seam first.' }
  const quiet = (message: ChatMessage): ChatMessage => ({ ...message, interim: true })

  it('reads what a turn said before its answer as commentary', () => {
    expect(markInterim([asked, commentary, empty, answered])).toEqual([asked, quiet(commentary), empty, answered])
  })

  it('reads a tool-less turn, where commentary sits straight above the answer', () => {
    expect(markInterim([asked, commentary, answered])).toEqual([asked, quiet(commentary), answered])
  })

  it('keeps a turn that is one answer untouched, and hands back the same rows', () => {
    const rows = [asked, answered]
    expect(markInterim(rows)).toBe(rows)
  })

  it('reads every turn on its own', () => {
    const second: ChatMessage = { role: 'user', text: 'And the cache?' }
    const later: ChatMessage = { role: 'assistant', text: 'The cache is fine.' }
    expect(markInterim([asked, commentary, empty, answered, second, commentary, empty, later])).toEqual([
      asked,
      quiet(commentary),
      empty,
      answered,
      second,
      quiet(commentary),
      empty,
      later
    ])
  })

  it('does not end a turn on a steer', () => {
    const rows = transcriptToMessages([
      { role: 'user', text: 'What is a topic?' },
      { role: 'assistant', text: commentary.text },
      { role: 'user', text: 'also the cache', display_kind: STEER_KIND },
      { role: 'assistant', text: '' },
      { role: 'assistant', text: answered.text }
    ])
    expect(markInterim(rows)).toEqual([
      asked,
      quiet(commentary),
      { role: 'user', text: 'also the cache', kind: STEER_KIND },
      empty,
      answered
    ])
  })

  it('reads an answer that was only files as the answer', () => {
    const files: ChatMessage = {
      role: 'assistant',
      text: '',
      attachments: [{ kind: 'file', label: 'report.pdf', path: '/tmp/report.pdf' }]
    }
    expect(markInterim([asked, commentary, empty, files])).toEqual([asked, quiet(commentary), empty, files])
  })

  it('dims nothing when the turn has not answered yet', () => {
    const rows = [asked, commentary, empty]
    expect(markInterim(rows)).toBe(rows)
  })

  it('never marks a tool step or a prompt', () => {
    const rows = markInterim([asked, commentary, empty, answered])
    expect(rows[0]).toEqual(asked)
    expect(rows[2]).toEqual(empty)
  })

  it('leaves a row the gateway classified at full ink', () => {
    const failed: ChatMessage = { role: 'assistant', text: 'The turn failed.', kind: 'failed_turn' }
    expect(markInterim([asked, failed])).toEqual([asked, failed])
  })

  it('keeps the answer bright when a classed notice follows it', () => {
    const done: ChatMessage = { role: 'assistant', text: 'The batch finished.', kind: 'async_delegation_complete' }
    expect(markInterim([asked, commentary, empty, answered, done])).toEqual([
      asked,
      quiet(commentary),
      empty,
      answered,
      done
    ])
  })

  it('leaves the rows it was given alone and is idempotent', () => {
    const rows = [asked, commentary, empty, answered]
    const once = markInterim(rows)
    expect(rows[1]).toEqual(commentary)
    expect(markInterim(once)).toEqual(once)
  })
})
