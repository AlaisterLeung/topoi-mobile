import { describe, expect, it } from 'vitest'

import {
  HOLD_PX,
  MAX_PULL_PX,
  TRIGGER_PX,
  claimsPull,
  indicatorShift,
  pullOf,
  triggers
} from './pull-to-refresh'

describe('pullOf', () => {
  it('gives nothing for an upward or still touch', () => {
    expect(pullOf(0)).toBe(0)
    expect(pullOf(-40)).toBe(0)
  })

  it('damps a downward pull by half', () => {
    expect(pullOf(40)).toBe(20)
    expect(pullOf(120)).toBe(60)
  })

  it('stops at the furthest travel however hard the finger pulls', () => {
    expect(pullOf(400)).toBe(MAX_PULL_PX)
    expect(pullOf(100000)).toBe(MAX_PULL_PX)
  })
})

describe('claimsPull', () => {
  it('takes a downward drag on a list already at its top', () => {
    expect(claimsPull(2, 60, 0)).toBe(true)
  })

  it('leaves a sideways drag to the edge swipes', () => {
    expect(claimsPull(70, 10, 0)).toBe(false)
    expect(claimsPull(-70, 10, 0)).toBe(false)
  })

  it('leaves an upward drag to the list', () => {
    expect(claimsPull(2, -60, 0)).toBe(false)
  })

  it('refuses a list that is scrolled away from its top', () => {
    expect(claimsPull(2, 60, 120)).toBe(false)
  })
})

describe('triggers', () => {
  it('needs the full travel', () => {
    expect(triggers(TRIGGER_PX - 1)).toBe(false)
    expect(triggers(TRIGGER_PX)).toBe(true)
    expect(triggers(MAX_PULL_PX)).toBe(true)
  })
})

describe('indicatorShift', () => {
  it('hides the indicator at rest and brings it to rest at the hold travel', () => {
    expect(indicatorShift(0)).toBe(-HOLD_PX)
    expect(indicatorShift(HOLD_PX)).toBe(0)
    expect(indicatorShift(MAX_PULL_PX)).toBe(MAX_PULL_PX - HOLD_PX)
  })
})
