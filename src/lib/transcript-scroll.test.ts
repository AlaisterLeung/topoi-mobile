import { describe, expect, it } from 'vitest'

import { AT_BOTTOM, FOLLOW_PX, readScroll, repaintTop } from './transcript-scroll'

/** A transcript taller than its window: 4000px of rows in an 800px view. */
const TALL = 4000
const WINDOW = 800
const BOTTOM = TALL - WINDOW

describe('readScroll', () => {
  it('follows from the bottom row', () => {
    expect(readScroll(TALL, BOTTOM, WINDOW)).toEqual({ follow: true, top: BOTTOM })
  })

  it('follows from inside the band just above the bottom', () => {
    expect(readScroll(TALL, BOTTOM - FOLLOW_PX, WINDOW).follow).toBe(true)
  })

  it('stops following past the band, which is a reader who scrolled back', () => {
    expect(readScroll(TALL, BOTTOM - FOLLOW_PX - 1, WINDOW).follow).toBe(false)
  })

  it('follows a transcript shorter than its window, where there is nothing to scroll', () => {
    expect(readScroll(300, 0, WINDOW)).toEqual({ follow: true, top: 0 })
  })

  it('never reports a negative place', () => {
    expect(readScroll(TALL, -40, WINDOW).top).toBe(0)
  })
})

describe('repaintTop', () => {
  it('lands a new chat on its newest row', () => {
    expect(repaintTop(AT_BOTTOM, TALL)).toBe(TALL)
  })

  it('keeps a following reader on the bottom after a repaint that grew the transcript', () => {
    const grown = TALL + 900
    const reader = readScroll(TALL, BOTTOM, WINDOW)
    expect(repaintTop(reader, grown)).toBe(grown)
  })

  it('hands a scrolled-back reader the place they were reading', () => {
    const reader = readScroll(TALL, 1200, WINDOW)
    expect(repaintTop(reader, TALL)).toBe(1200)
  })

  it('keeps that place when the repaint brought rows the reader had not seen', () => {
    const reader = readScroll(TALL, 1200, WINDOW)
    expect(repaintTop(reader, TALL + 1500)).toBe(1200)
  })

  it('never scrolls past the transcript it is handed', () => {
    const reader = readScroll(TALL, 3000, WINDOW)
    expect(repaintTop(reader, 900)).toBe(900)
  })
})
