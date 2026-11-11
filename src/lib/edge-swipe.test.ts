import { describe, expect, it } from 'vitest'

import { CLAIM_PX, claims, commits, EDGE_PX, edgeOf, travelOf } from './edge-swipe'

const WIDTH = 393

describe('edgeOf', () => {
  it('names the band at each edge', () => {
    expect(edgeOf(0, WIDTH)).toBe('left')
    expect(edgeOf(EDGE_PX, WIDTH)).toBe('left')
    expect(edgeOf(WIDTH - EDGE_PX, WIDTH)).toBe('right')
    expect(edgeOf(WIDTH, WIDTH)).toBe('right')
  })

  it('leaves the middle of the screen to the screen', () => {
    expect(edgeOf(EDGE_PX + 1, WIDTH)).toBeNull()
    expect(edgeOf(WIDTH / 2, WIDTH)).toBeNull()
    expect(edgeOf(WIDTH - EDGE_PX - 1, WIDTH)).toBeNull()
  })
})

describe('travelOf', () => {
  it('reads a swipe as a positive distance whichever edge it came from', () => {
    expect(travelOf('left', 40)).toBe(40)
    expect(travelOf('right', -40)).toBe(40)
  })

  it('reads the other direction as negative, so a pull the wrong way never counts', () => {
    expect(travelOf('left', -40)).toBe(-40)
    expect(travelOf('right', 40)).toBe(-40)
  })
})

describe('claims', () => {
  it('takes a sideways pull the way the edge points', () => {
    expect(claims('left', 20, 4)).toBe(true)
    expect(claims('right', -20, 4)).toBe(true)
  })

  it('leaves a vertical drag to the list', () => {
    expect(claims('left', 14, 30)).toBe(false)
    expect(claims('right', -14, 30)).toBe(false)
  })

  it('leaves a pull the wrong way alone', () => {
    expect(claims('left', -20, 2)).toBe(false)
    expect(claims('right', 20, 2)).toBe(false)
  })
})

describe('commits', () => {
  it('goes through past the share of the width', () => {
    expect(commits(WIDTH * 0.4, WIDTH, 0)).toBe(true)
    expect(commits(WIDTH * 0.39, WIDTH, 0)).toBe(false)
  })

  it('goes through on a flick that never reached the share', () => {
    expect(commits(80, WIDTH, 0.8)).toBe(true)
    expect(commits(80, WIDTH, 0.2)).toBe(false)
  })

  it('never goes through on a wobble, however fast it left', () => {
    expect(commits(CLAIM_PX * 2 - 1, WIDTH, 9)).toBe(false)
    expect(commits(CLAIM_PX * 2, WIDTH, 9)).toBe(true)
  })
})
