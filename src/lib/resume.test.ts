import type { SessionResumeResult } from '@topoi/core'
import { describe, expect, it } from 'vitest'

import type { ChatMessage } from './chat'
import { idSet, rebuildTranscript, resumeTranscript } from './resume'

/** A resume answer carrying only the fields the rebuild reads. */
function resumeOf(running: boolean, inflight?: { user?: string; assistant?: string }): SessionResumeResult {
  return { session_id: 'run-1', message_count: 0, messages: [], info: {}, running, inflight }
}

const asked: ChatMessage = { role: 'user', text: 'What is a topic?' }
const answered: ChatMessage = { role: 'assistant', text: 'A tree of threads.' }
const second: ChatMessage = { role: 'user', text: 'And a thread?' }
const partial: ChatMessage = { role: 'assistant', text: 'A convers' }
const longer: ChatMessage = { role: 'assistant', text: 'A conversation!' }

describe('idSet', () => {
  it('keeps one of each name, in the order they were asked', () => {
    expect(idSet('stored-1', 'run-1', 'stored-1')).toEqual(['stored-1', 'run-1'])
  })

  it('drops the names a chat does not have', () => {
    expect(idSet(undefined, '', 'run-1')).toEqual(['run-1'])
    expect(idSet(undefined, undefined)).toEqual([])
  })
})

describe('resumeTranscript', () => {
  it('paints the stored rows of an idle resume', () => {
    expect(resumeTranscript([asked, answered], [], resumeOf(false))).toEqual([asked, answered])
  })

  it('paints a running turn once when the gateway stamped its own image lines onto the prompt', () => {
    // The screen's optimistic row is the parsed text; the resume's snapshot is
    // the same turn as the gateway holds it, with its own refs appended. Read
    // without the parser these are two different rows, which is what painted
    // the turn twice.
    const optimistic: ChatMessage = {
      role: 'user',
      text: 'look at this',
      attachments: [{ kind: 'image', label: 'shot.png' }]
    }
    const resume = resumeOf(true, {
      user: '[User attached image: shot.png]\n\nlook at this\n@image:/home/alaister/.hermes/images/upload_1.png\n[screenshot]'
    })
    expect(resumeTranscript([], [optimistic], resume)).toEqual([optimistic])
  })

  it('ignores the inflight snapshot of an idle resume', () => {
    const resume = resumeOf(false, { user: 'stale prompt', assistant: 'stale answer' })
    expect(resumeTranscript([asked, answered], [], resume)).toEqual([asked, answered])
  })

  it('rebuilds the running turn from the inflight snapshot', () => {
    const resume = resumeOf(true, { user: second.text, assistant: partial.text })
    expect(resumeTranscript([asked, answered], [asked, answered], resume)).toEqual([asked, answered, second, partial])
  })

  it('keeps the screen tail when the resume runs but the snapshot is empty', () => {
    expect(resumeTranscript([asked], [asked, second], resumeOf(true))).toEqual([asked, second])
  })

  it('does not repeat the prompt the screen already sent', () => {
    const local = [asked, answered, second]
    const resume = resumeOf(true, { user: second.text })
    expect(resumeTranscript([asked, answered], local, resume)).toEqual(local)
  })

  it('keeps the screen tail after the last row the gateway has written', () => {
    expect(resumeTranscript([asked], [asked, second], resumeOf(false))).toEqual([asked, second])
  })

  it('drops a whitespace-only inflight value instead of painting a blank row', () => {
    const resume = resumeOf(true, { user: '   ' })
    expect(resumeTranscript([asked], [asked], resume)).toEqual([asked])
  })

  it('does not double a row when the screen was reopened from a stale cache', () => {
    const stored = [asked, answered, second]
    expect(resumeTranscript(stored, [asked], resumeOf(false))).toEqual(stored)
  })

  it('paints the whole screen tail when the transcript is empty', () => {
    expect(resumeTranscript([], [second], resumeOf(false))).toEqual([second])
  })

  it('leaves the arrays it was given alone', () => {
    const stored = [asked, answered]
    const local = [asked, answered, second]
    const painted = resumeTranscript(stored, local, resumeOf(true, { user: second.text }))
    expect(stored).toEqual([asked, answered])
    expect(local).toEqual([asked, answered, second])
    expect(painted).not.toBe(stored)
    expect(painted).not.toBe(local)
  })

  it('paints the running turn once when the screen is behind the snapshot', () => {
    const local = [asked, answered, second, partial]
    const resume = resumeOf(true, { user: second.text, assistant: longer.text })
    expect(resumeTranscript([asked, answered], local, resume)).toEqual([asked, answered, second, longer])
  })

  it('paints the running turn once when the screen is ahead of the snapshot', () => {
    const local = [asked, answered, second, longer]
    const resume = resumeOf(true, { user: second.text, assistant: partial.text })
    expect(resumeTranscript([asked, answered], local, resume)).toEqual([asked, answered, second, longer])
  })

  it('paints the screen answer ahead of the snapshot, because the next delta appends to it', () => {
    const local = [asked, answered, second, longer]
    const resume = resumeOf(true, { user: second.text, assistant: partial.text })
    const painted = resumeTranscript([asked, answered], local, resume)
    expect(painted[painted.length - 1]).toEqual(longer)
    expect(painted.filter(row => row.role === 'assistant')).toHaveLength(2)
  })

  it('keeps a prompt sent while the turn runs, after the turn it followed', () => {
    const queued: ChatMessage = { role: 'user', text: 'and one more thing' }
    const local = [asked, answered, second, partial, queued]
    const resume = resumeOf(true, { user: second.text, assistant: partial.text })
    expect(resumeTranscript([asked, answered], local, resume)).toEqual([asked, answered, second, partial, queued])
  })

  it('keeps the screen partial when the snapshot carries no answer yet', () => {
    const local = [asked, answered, second, partial]
    const resume = resumeOf(true, { user: second.text })
    expect(resumeTranscript([asked, answered], local, resume)).toEqual([asked, answered, second, partial])
  })

  it('paints one prompt when the screen spells it with stray whitespace', () => {
    const stray: ChatMessage = { role: 'user', text: 'And a thread?  ' }
    const local = [asked, answered, stray]
    const resume = resumeOf(true, { user: second.text })
    expect(resumeTranscript([asked, answered], local, resume)).toEqual([asked, answered, second])
  })

  it('keeps a screen partial that is not the snapshot answer', () => {
    const other: ChatMessage = { role: 'assistant', text: 'something else' }
    const local = [asked, answered, second, other]
    const resume = resumeOf(true, { user: second.text, assistant: longer.text })
    expect(resumeTranscript([asked, answered], local, resume)).toEqual([asked, answered, second, longer, other])
  })
})

describe('rebuildTranscript', () => {
  it('drops a stray copy of an answer the gateway already holds, which the warm merge keeps', () => {
    const stray: ChatMessage = { role: 'assistant', text: 'A tree of threads. (second copy)' }
    const local = [asked, answered, stray]
    expect(resumeTranscript([asked, answered], local, resumeOf(false))).toEqual([asked, answered, stray])
    expect(rebuildTranscript([asked, answered], local, resumeOf(false))).toEqual([asked, answered])
  })

  it('drops a copy that differs from the stored answer only by a tail', () => {
    const older: ChatMessage = { role: 'assistant', text: 'A tree of threads' }
    expect(rebuildTranscript([asked, answered], [asked, older], resumeOf(false))).toEqual([asked, answered])
  })

  it('drops an answer the gateway has not written yet, even when its transcript ends on the prompt', () => {
    // The sub-second settle window: the turn finished, the row is not stored yet.
    // A tapped refresh is authoritative, so the answer goes; the next resume paints
    // it once the gateway has written it. Keeping it would also keep a stray.
    const settled: ChatMessage = { role: 'assistant', text: 'A tree of threads, and how.' }
    expect(rebuildTranscript([asked, second], [asked, second, settled], resumeOf(false))).toEqual([asked, second])
  })

  it('does not keep that answer when it is a copy of one the transcript ends on', () => {
    const copy: ChatMessage = { role: 'assistant', text: 'A tree of threads. (again)' }
    expect(rebuildTranscript([asked, second, answered], [asked, second, answered, copy], resumeOf(false))).toEqual([
      asked,
      second,
      answered
    ])
  })

  it('carries the prompt sent a moment ago', () => {
    expect(rebuildTranscript([asked, answered], [asked, answered, second], resumeOf(false))).toEqual([asked, answered, second])
  })

  it('carries a run of consecutive prompts', () => {
    const again: ChatMessage = { role: 'user', text: 'and another' }
    expect(rebuildTranscript([asked], [asked, second, again], resumeOf(false))).toEqual([asked, second, again])
  })

  it('carries the prompt under a settled answer it drops', () => {
    const settled: ChatMessage = { role: 'assistant', text: 'not stored anywhere' }
    expect(rebuildTranscript([asked, answered], [asked, answered, second, settled], resumeOf(false))).toEqual([
      asked,
      answered,
      second
    ])
  })

  it('does not paint a prompt the inflight snapshot already paints', () => {
    const resume = resumeOf(true, { user: second.text, assistant: partial.text })
    expect(rebuildTranscript([asked, answered], [asked, answered, second], resume)).toEqual([asked, answered, second, partial])
  })

  it('paints the snapshot when the screen is ahead of it on the running answer', () => {
    // A tapped refresh is authoritative: the screen's longer partial is not offered,
    // so the snapshot's shorter one paints and the next delta, or the final, grows
    // it again. A rewind is the price of never painting an answer twice.
    const resume = resumeOf(true, { user: second.text, assistant: partial.text })
    expect(rebuildTranscript([asked, answered], [asked, answered, second, longer], resume)).toEqual([
      asked,
      answered,
      second,
      partial
    ])
  })

  it('does not paint the running answer twice when the screen is behind the snapshot', () => {
    const resume = resumeOf(true, { user: second.text, assistant: longer.text })
    expect(rebuildTranscript([asked, answered], [asked, answered, second, partial], resume)).toEqual([
      asked,
      answered,
      second,
      longer
    ])
  })

  it('paints only the gateway rows when the cached screen is a stale prefix', () => {
    expect(rebuildTranscript([asked, answered, second], [asked], resumeOf(false))).toEqual([asked, answered, second])
  })

  it('leaves the arrays it was given alone', () => {
    const stored = [asked, answered]
    const local = [asked, answered, second]
    const painted = rebuildTranscript(stored, local, resumeOf(false))
    expect(stored).toEqual([asked, answered])
    expect(local).toEqual([asked, answered, second])
    expect(painted).not.toBe(stored)
  })
})
