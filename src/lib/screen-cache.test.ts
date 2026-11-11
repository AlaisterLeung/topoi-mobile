import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { device, resetDevice } from '../test/device'

vi.mock('@capacitor/preferences', async () => ({ Preferences: (await import('../test/device')).Preferences }))
vi.mock('@topoi/auth-session', async () => ({ TopoiAuthSession: (await import('../test/device')).TopoiAuthSession }))

const GATEWAY_A = 'https://a.test'
const GATEWAY_B = 'https://b.test'

/** The gateway is persisted, so a test points a launch at one the same way the app does. */
function storeGateway(url: string): void {
  device.preferences.set('topoi.baseUrl', url)
}

/** A module graph that has not read the stores yet: the cache keeps a memory copy of its own, and the config's gateway URL is hydrated at boot. */
async function freshCache() {
  vi.resetModules()
  await (await import('./config')).hydrateConfig()
  return await import('./screen-cache')
}

function storedNames(): string[] {
  const names: string[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const name = localStorage.key(index)
    if (name) names.push(name)
  }
  return names
}

/** Only the entries the cache owns: nothing else lives in the webview store now. */
function cacheNames(): string[] {
  return storedNames().filter(name => name.startsWith('topoi.cache.'))
}

beforeEach(() => {
  resetDevice()
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readCache', () => {
  it('answers null for a key nothing has cached', async () => {
    const cache = await freshCache()
    expect(cache.readCache('topics')).toBeNull()
  })

  it('paints a payload from the memory copy without touching storage', async () => {
    storeGateway(GATEWAY_A)
    const cache = await freshCache()
    cache.writeCache('topics', [{ id: 't_work' }])
    const [name] = cacheNames()
    localStorage.removeItem(name)
    expect(cache.readCache('topics')).toEqual([{ id: 't_work' }])
  })

  it('paints a payload another instance persisted', async () => {
    storeGateway(GATEWAY_A)
    const writer = await freshCache()
    writer.writeCache('topics', [{ id: 't_work' }])
    const reader = await freshCache()
    expect(reader.readCache('topics')).toEqual([{ id: 't_work' }])
  })

  it("never paints another gateway's payload", async () => {
    storeGateway(GATEWAY_A)
    const writer = await freshCache()
    writer.writeCache('topics', [{ id: 't_work' }])
    storeGateway(GATEWAY_B)
    const reader = await freshCache()
    expect(reader.readCache('topics')).toBeNull()
    storeGateway(GATEWAY_A)
    const back = await freshCache()
    expect(back.readCache('topics')).toEqual([{ id: 't_work' }])
  })

  it('drops an entry written by an older shape of the cache', async () => {
    storeGateway(GATEWAY_A)
    const writer = await freshCache()
    writer.writeCache('topics', [{ id: 't_work' }])
    const [name] = cacheNames()
    const envelope = JSON.parse(localStorage.getItem(name) as string) as { v: number }
    envelope.v = 0
    localStorage.setItem(name, JSON.stringify(envelope))
    const reader = await freshCache()
    expect(reader.readCache('topics')).toBeNull()
    expect(cacheNames()).toEqual([])
  })
})

describe('writeCache', () => {
  it('drops the cached transcripts and tries once more when the quota is full', async () => {
    storeGateway(GATEWAY_A)
    const cache = await freshCache()
    cache.writeCache('threads.t_work', ['th_1'])
    cache.writeCache('messages.s1', [{ role: 'user', text: 'one' }])
    const original = localStorage.setItem.bind(localStorage)
    let full = false
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
      if (full && key.includes('messages.')) throw new Error('QuotaExceededError')
      original(key, value)
    })
    full = true
    cache.writeCache('messages.s2', [{ role: 'user', text: 'two' }])
    expect(setItem).toHaveBeenCalledTimes(2)
    expect(cacheNames().filter(name => name.includes('messages.'))).toEqual([])
    expect(cacheNames().filter(name => name.includes('threads.'))).toHaveLength(1)
    expect(cache.readCache('messages.s1')).toBeNull()
    full = false
    const reader = await freshCache()
    expect(reader.readCache('messages.s2')).toBeNull()
    expect(reader.readCache('threads.t_work')).toEqual(['th_1'])
  })
})

describe('clearCache', () => {
  it('forgets every cached payload and leaves the gateway URL alone', async () => {
    storeGateway(GATEWAY_A)
    const cache = await freshCache()
    cache.writeCache('topics', [{ id: 't_work' }])
    cache.writeCache('messages.s1', [{ role: 'user', text: 'one' }])
    cache.clearCache()
    expect(cacheNames()).toEqual([])
    expect(device.preferences.get('topoi.baseUrl')).toBe(GATEWAY_A)
    expect(cache.readCache('topics')).toBeNull()
    const reader = await freshCache()
    expect(reader.readCache('topics')).toBeNull()
  })
})

describe('dropCache', () => {
  it('drops one payload and leaves every other entry cached', async () => {
    storeGateway(GATEWAY_A)
    const cache = await freshCache()
    cache.writeCache('topics', [{ id: 't_work' }])
    cache.writeCache('messages.s1', [{ role: 'user', text: 'one' }])
    cache.dropCache('messages.s1')
    expect(cache.readCache('messages.s1')).toBeNull()
    expect(cacheNames().filter(name => name.includes('messages.'))).toEqual([])
    expect(cache.readCache('topics')).toEqual([{ id: 't_work' }])
    const reader = await freshCache()
    expect(reader.readCache('messages.s1')).toBeNull()
    expect(reader.readCache('topics')).toEqual([{ id: 't_work' }])
  })
})

describe('tailOf', () => {
  const rows = Array.from({ length: 250 }, (_, index) => index)

  it('keeps the newest 200 rows of a long transcript', async () => {
    const cache = await freshCache()
    const kept = cache.tailOf(rows)
    expect(kept).toHaveLength(200)
    expect(kept[0]).toBe(50)
    expect(kept[199]).toBe(249)
  })

  it('hands back a transcript that fits', async () => {
    const cache = await freshCache()
    const short = Array.from({ length: 200 }, (_, index) => index)
    expect(cache.tailOf(short)).toBe(short)
    expect(cache.tailOf([])).toEqual([])
  })
})
