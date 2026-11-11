import { beforeEach, describe, expect, it } from 'vitest'

import type { PendingAttachment } from './attachments'
import { clearDrafts, draftKeys, dropDraft, isDraftEmpty, moveDraft, readDraft, writeDraft } from './drafts'

function attachment(name: string): PendingAttachment {
  return { id: name, name, kind: 'file', size: 4, file: new File([new Uint8Array(4)], name) }
}

describe('composer drafts', () => {
  beforeEach(() => clearDrafts())

  it('names a thread draft after the id that survives a gateway restart', () => {
    expect(draftKeys.thread('20261019_120000_ab12cd')).toBe('thread:20261019_120000_ab12cd')
  })

  it('names a new thread after its topic, because each press mints a new session', () => {
    expect(draftKeys.newThread('t_work')).toBe('new:t_work')
  })

  it('hands back what a composer was holding, attachments and all', () => {
    const draft = { text: 'half a thought', attachments: [attachment('notes.pdf')] }
    writeDraft('thread:one', draft)
    expect(readDraft('thread:one')).toEqual(draft)
  })

  it('answers null for a surface that never held anything', () => {
    expect(readDraft('thread:never')).toBeNull()
  })

  it('drops an empty draft instead of storing one', () => {
    writeDraft('thread:one', { text: 'said it', attachments: [] })
    writeDraft('thread:one', { text: '   ', attachments: [] })
    expect(readDraft('thread:one')).toBeNull()
  })

  it('counts an attachment alone as a draft worth keeping', () => {
    expect(isDraftEmpty({ text: '', attachments: [attachment('notes.pdf')] })).toBe(false)
    expect(isDraftEmpty({ text: '', attachments: [] })).toBe(true)
    expect(isDraftEmpty(null)).toBe(true)
  })

  it('moves a draft onto the thread a fresh chat became', () => {
    writeDraft('new:t_work', { text: 'drafted before sending', attachments: [] })
    moveDraft('new:t_work', 'thread:20261019_120000_ab12cd')
    expect(readDraft('new:t_work')).toBeNull()
    expect(readDraft('thread:20261019_120000_ab12cd')?.text).toBe('drafted before sending')
  })

  it('leaves a move with nothing to move alone', () => {
    moveDraft('new:t_work', 'thread:one')
    expect(readDraft('thread:one')).toBeNull()
  })

  it('drops one surface without touching the other threads', () => {
    writeDraft('thread:one', { text: 'one', attachments: [] })
    writeDraft('thread:two', { text: 'two', attachments: [] })
    dropDraft('thread:one')
    expect(readDraft('thread:one')).toBeNull()
    expect(readDraft('thread:two')?.text).toBe('two')
  })
})
