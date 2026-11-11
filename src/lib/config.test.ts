import { beforeEach, describe, expect, it, vi } from 'vitest'

import { device, resetDevice } from '../test/device'
import { clearTokens, hydrateConfig, loadBaseUrl, loadTokens, normalizeBaseUrl, saveBaseUrl, saveTokens, type StoredTokens } from './config'

vi.mock('@capacitor/preferences', async () => ({ Preferences: (await import('../test/device')).Preferences }))
vi.mock('@topoi/auth-session', async () => ({ TopoiAuthSession: (await import('../test/device')).TopoiAuthSession }))

const GATEWAY = 'https://gateway.test'

const tokens: StoredTokens = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_at: 1_800_000_000,
  provider: 'github',
  user_id: 'u1'
}

/** A module graph that has not read the stores yet, which is what the next launch is. */
async function relaunch() {
  vi.resetModules()
  const config = await import('./config')
  await config.hydrateConfig()
  return config
}

beforeEach(async () => {
  resetDevice()
  localStorage.clear()
  await hydrateConfig()
})

describe('normalizeBaseUrl', () => {
  it('trims the whitespace a paste carries', () => {
    expect(normalizeBaseUrl('  https://gateway.test  ')).toBe('https://gateway.test')
  })

  it('strips every trailing slash', () => {
    expect(normalizeBaseUrl('https://gateway.test///')).toBe('https://gateway.test')
  })

  it('keeps the path of a gateway served under one', () => {
    expect(normalizeBaseUrl('https://example.test/hermes/')).toBe('https://example.test/hermes')
  })
})

describe('the gateway URL', () => {
  it('reads as empty until one is saved', () => {
    expect(loadBaseUrl()).toBe('')
  })

  it('reads back what was saved', async () => {
    await saveBaseUrl(GATEWAY)
    expect(loadBaseUrl()).toBe(GATEWAY)
  })

  it('persists through Preferences, not the webview store', async () => {
    await saveBaseUrl(GATEWAY)
    expect(device.preferences.get('topoi.baseUrl')).toBe(GATEWAY)
    expect(localStorage.getItem('topoi.baseUrl')).toBeNull()
    expect((await relaunch()).loadBaseUrl()).toBe(GATEWAY)
  })
})

describe('the stored tokens', () => {
  it('reads as null until a sign-in saves some', () => {
    expect(loadTokens()).toBeNull()
  })

  it('reads back the tokens of a sign-in', async () => {
    await saveTokens(tokens)
    expect(loadTokens()).toEqual(tokens)
  })

  it('keeps them in the Keychain and out of the webview store', async () => {
    await saveTokens(tokens)
    expect(device.keychain.value).toBe(JSON.stringify(tokens))
    expect(localStorage.getItem('topoi.tokens')).toBeNull()
    expect((await relaunch()).loadTokens()).toEqual(tokens)
  })

  it('reads a corrupted Keychain item as no sign-in at all', async () => {
    device.keychain.value = 'not json'
    expect((await relaunch()).loadTokens()).toBeNull()
  })

  it('signs out by deleting the Keychain item and nothing else', async () => {
    await saveBaseUrl(GATEWAY)
    await saveTokens(tokens)
    await clearTokens()
    expect(loadTokens()).toBeNull()
    expect(device.keychain.value).toBeNull()
    expect(loadBaseUrl()).toBe(GATEWAY)
  })

  it('forgets the session in memory even when the Keychain refuses the delete', async () => {
    await saveTokens(tokens)
    device.failDelete = true
    await expect(clearTokens()).rejects.toThrow('Keychain delete failed')
    expect(loadTokens()).toBeNull()
  })
})

