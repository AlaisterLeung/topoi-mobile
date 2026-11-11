import { describe, expect, it, vi } from 'vitest'

import {
  addPending,
  attachmentKind,
  attachmentLine,
  attachAll,
  base64Of,
  composeSubmit,
  deliveredFiles,
  kindOfName,
  MAX_ATTACH_BYTES,
  MAX_PENDING,
  needsReencode,
  parseRow,
  pathLabel,
  removePending,
  trimLabel,
  type AttachTarget,
  type PendingAttachment
} from './attachments'

function picked(name: string, type = 'text/plain'): File {
  return new File([new Uint8Array(4)], name, { type })
}

function pending(name: string, type = 'text/plain'): PendingAttachment {
  const file = picked(name, type)
  return { id: name, name, kind: attachmentKind(file), size: file.size, file }
}

describe('trimLabel', () => {
  it('leaves a name that already fits alone', () => {
    expect(trimLabel('notes.pdf')).toBe('notes.pdf')
  })

  it('cuts the stem and never the extension', () => {
    expect(trimLabel('file20characters-long.png')).toBe('file20characte...png')
    expect(trimLabel('file20characters-long.png')).toHaveLength(20)
  })

  it('keeps the extension of a long name and holds the limit', () => {
    const label = trimLabel('a-very-long-report-name-2026.docx')
    expect(label.endsWith('...docx')).toBe(true)
    expect(label.length).toBeLessThanOrEqual(20)
    expect(label).toContain('...')
  })

  it('cuts a name with no extension to the limit', () => {
    expect(trimLabel('a-name-with-no-extension-at-all')).toBe('a-name-with-no-ex...')
  })
})

describe('attachmentKind', () => {
  it('reads an image out of its media type', () => {
    expect(attachmentKind(picked('shot.png', 'image/png'))).toBe('image')
    expect(attachmentKind(picked('report.pdf', 'application/pdf'))).toBe('file')
  })

  it('re-encodes an image type the gateway does not carry', () => {
    expect(needsReencode(picked('shot.heic', 'image/heic'))).toBe(true)
    expect(needsReencode(picked('shot.png', 'image/png'))).toBe(false)
    expect(needsReencode(picked('report.pdf', 'application/pdf'))).toBe(false)
  })

  it('reads a kind out of a name alone, for a file a turn delivered', () => {
    expect(kindOfName('/tmp/chart.png')).toBe('image')
    expect(kindOfName('/tmp/REPORT.PDF')).toBe('file')
    expect(kindOfName('notes')).toBe('file')
  })
})

describe('addPending', () => {
  it('stages what the picker returned', () => {
    const { pending: staged, errors } = addPending([], [picked('shot.png', 'image/png'), picked('notes.pdf')])
    expect(staged.map(attachment => attachment.name)).toEqual(['shot.png', 'notes.pdf'])
    expect(staged.map(attachment => attachment.kind)).toEqual(['image', 'file'])
    expect(errors).toEqual([])
  })

  it('refuses a file over the cap and names it', () => {
    const big = new File([new Uint8Array(MAX_ATTACH_BYTES + 1)], 'big.bin')
    const { pending: staged, errors } = addPending([], [big, picked('notes.pdf')])
    expect(staged.map(attachment => attachment.name)).toEqual(['notes.pdf'])
    expect(errors).toEqual(['big.bin is over 8 MB'])
  })

  it('stops at the per-send limit', () => {
    const many = Array.from({ length: MAX_PENDING + 2 }, (_unused, index) => picked(`file-${index}.txt`))
    const { pending: staged, errors } = addPending([], many)
    expect(staged).toHaveLength(MAX_PENDING)
    expect(errors).toEqual([`Only ${MAX_PENDING} attachments can wait on one message`])
  })
})

describe('removePending', () => {
  it('drops the row that was crossed off', () => {
    const staged = [pending('a.txt'), pending('b.txt')]
    expect(removePending(staged, 'a.txt').map(attachment => attachment.name)).toEqual(['b.txt'])
  })
})

describe('base64Of and pathLabel', () => {
  it('reads the bytes out of a data URL', () => {
    expect(base64Of('data:image/png;base64,AAAA')).toBe('AAAA')
    expect(base64Of('AAAA')).toBe('')
  })

  it('names a row after the last path segment', () => {
    expect(pathLabel('/home/alaister/attachments/report.pdf')).toBe('report.pdf')
    expect(pathLabel('attachments\\notes.txt')).toBe('notes.txt')
  })
})

describe('parseRow', () => {
  it('lifts an image note out of the row and leaves the prose', () => {
    expect(parseRow('[User attached image: IMG_1234.jpg]\nWhat is this?')).toEqual({
      attachments: [{ kind: 'image', label: 'IMG_1234.jpg' }],
      text: 'What is this?'
    })
  })

  it('lifts a file ref out of the row and names it', () => {
    expect(parseRow('@file:attachments/report.pdf\nSummarise it')).toEqual({
      attachments: [{ kind: 'file', label: 'report.pdf', path: 'attachments/report.pdf' }],
      text: 'Summarise it'
    })
  })

  it('unwraps a quoted ref path', () => {
    expect(parseRow('@file:"attachments/annual report.pdf"').attachments).toEqual([
      { kind: 'file', label: 'annual report.pdf', path: 'attachments/annual report.pdf' }
    ])
  })

  it('lifts a file note and a pdf note the same way', () => {
    expect(parseRow('[User attached file: /tmp/notes.txt]').attachments).toEqual([
      { kind: 'file', label: 'notes.txt', path: '/tmp/notes.txt' }
    ])
    expect(parseRow('[User attached PDF: brief.pdf (3 page(s))]').attachments).toEqual([
      { kind: 'file', label: 'brief.pdf', path: 'brief.pdf' }
    ])
  })

  it('drops the image refs and placeholders the gateway stamps onto its own row', () => {
    // The exact row the gateway stored for two pictures sent from the app.
    const stored = [
      '[User attached image: IMG_1719.jpeg]',
      '[User attached image: IMG_1705.png]',
      '',
      'I attached two memes.',
      '@image:/home/alaister/.hermes/images/upload_20261020_052226_1.jpeg',
      '@image:/home/alaister/.hermes/images/upload_20261020_052226_2.png',
      '[screenshot]',
      '[screenshot]'
    ].join('\n')
    expect(parseRow(stored)).toEqual({
      attachments: [
        { kind: 'image', label: 'IMG_1719.jpeg' },
        { kind: 'image', label: 'IMG_1705.png' }
      ],
      text: 'I attached two memes.'
    })
  })

  it('drops the note the gateway writes when it routes an image natively', () => {
    expect(parseRow('[Image attached at: /home/alaister/.hermes/images/upload_1.png]\n[screenshot]')).toEqual({
      attachments: [],
      text: ''
    })
  })

  it('drops the recalled-memory block the gateway appends', () => {
    const stored = 'Two bugs:\n<memory-context>\n[System note: recalled]\n- a memory\n</memory-context>'
    expect(parseRow(stored)).toEqual({ attachments: [], text: 'Two bugs:' })
  })

  it('leaves a row with no attachment untouched', () => {
    const text = 'The MEDIA: directive is mentioned in prose here, not as a line of its own'
    expect(parseRow(text)).toEqual({ attachments: [], text })
  })
})

describe('deliveredFiles', () => {
  it('lifts the media lines out of an answer', () => {
    expect(deliveredFiles('Here it is.\n\nMEDIA:/tmp/report.pdf\nDone.')).toEqual({
      files: ['/tmp/report.pdf'],
      text: 'Here it is.\n\nDone.'
    })
  })

  it('passes an answer with no media line through', () => {
    expect(deliveredFiles('Nothing attached.')).toEqual({ files: [], text: 'Nothing attached.' })
  })
})

/** A `FileReader` stand-in: node has the bytes but no browser reader, and the
 *  composition under test is what the reader feeds. */
class StubFileReader {
  result: string | null = null
  private readonly handlers: Record<string, (() => void)[]> = {}

  addEventListener(type: string, handler: () => void): void {
    this.handlers[type] = [...(this.handlers[type] ?? []), handler]
  }

  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then(bytes => {
      const base64 = Buffer.from(bytes).toString('base64')
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${base64}`
      for (const handler of this.handlers.load ?? []) handler()
    })
  }
}

describe('attachAll', () => {
  const target = (): AttachTarget & { image: unknown[]; file: unknown[] } => ({
    image: [],
    file: [],
    async attachImageBytes(sessionId, payload) {
      this.image.push({ sessionId, ...payload })
      return { attached: true, name: payload.filename, path: 'images/upload_1.png' }
    },
    async attachFile(sessionId, payload) {
      this.file.push({ sessionId, ...payload })
      return { attached: true, ref_text: `@file:attachments/${payload.name}` }
    }
  })

  it('cedes an image to the image queue and a file to its ref', async () => {
    vi.stubGlobal('FileReader', StubFileReader)
    const gateway = target()
    const staged = await attachAll(gateway, 'session-1', [
      pending('shot.png', 'image/png'),
      pending('report.pdf', 'application/pdf')
    ])
    vi.unstubAllGlobals()
    expect(gateway.image).toEqual([
      { sessionId: 'session-1', contentBase64: 'AAAAAA==', filename: 'shot.png' }
    ])
    expect(gateway.file).toHaveLength(1)
    expect(staged[1]?.ref).toBe('@file:attachments/report.pdf')
  })

  it('throws the refusal the gateway answered with rather than dropping the file', async () => {
    vi.stubGlobal('FileReader', StubFileReader)
    const refusing: AttachTarget = {
      async attachImageBytes() {
        return { attached: false, message: 'image too large (30000000 bytes; cap is 25 MB)' }
      },
      async attachFile() {
        return { attached: false }
      }
    }
    await expect(attachAll(refusing, 'session-1', [pending('shot.png', 'image/png')])).rejects.toThrow(
      'image too large (30000000 bytes; cap is 25 MB)'
    )
    vi.unstubAllGlobals()
  })
})

describe('composeSubmit', () => {
  it('puts the refs and notes above what was typed', () => {
    const results = [
      { attachment: pending('shot.png', 'image/png'), path: 'images/upload_1.png' },
      { attachment: pending('report.pdf'), ref: '@file:attachments/report.pdf' }
    ]
    expect(composeSubmit(results, 'Look at these')).toBe(
      '[User attached image: shot.png]\n@file:attachments/report.pdf\n\nLook at these'
    )
  })

  it('submits the image note alone when nothing was typed with it', () => {
    expect(composeSubmit([{ attachment: pending('shot.png', 'image/png') }], '   ')).toBe(
      '[User attached image: shot.png]'
    )
  })

  it('leaves a text-only send alone', () => {
    expect(composeSubmit([], 'Just this')).toBe('Just this')
  })

  it('reads a file back under the name the gateway staged', () => {
    expect(attachmentLine({ attachment: pending('shot.png', 'image/png') })).toBe(
      '[User attached image: shot.png]'
    )
  })
})
