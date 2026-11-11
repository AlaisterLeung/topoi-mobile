import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { shortStamp } from './time'

const at = (year: number, month: number, day: number, hour: number, minute: number): number =>
  Math.floor(new Date(year, month, day, hour, minute).getTime() / 1000)

describe('shortStamp', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 18, 9, 3))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('answers nothing for a row with no time', () => {
    expect(shortStamp(null)).toBe('')
    expect(shortStamp(undefined)).toBe('')
    expect(shortStamp(0)).toBe('')
  })

  it('reads the clock for a row from today, on the 24 hour dial', () => {
    expect(shortStamp(at(2026, 9, 18, 14, 5))).toBe('14:05')
    expect(shortStamp(at(2026, 9, 18, 0, 5))).toBe('00:05')
  })

  it('reads the date for a row from earlier this year', () => {
    expect(shortStamp(at(2026, 9, 14, 9, 3))).toBe('Oct 14')
  })

  it('carries the year for a row from an earlier one', () => {
    expect(shortStamp(at(2025, 9, 14, 9, 3))).toBe('Oct 14 2025')
  })
})
