import { createHash } from 'node:crypto'

import { TopoiAuthSession } from '@topoi/auth-session'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { challengeFor, exchangeCode, generateState, generateVerifier, refreshTokens, signIn } from './auth'
import { loadTokens, type StoredTokens } from './config'

/** The native plugin is stubbed as a plain module, which is the whole of what a
 *  Capacitor plugin needs here: vitest does not automock, so no plugin proxy is
 *  ever constructed and the plugin's own `@capacitor/core` import never loads.
 *  The Keychain slot is hoisted so the factory can close over it. */
const { keychain } = vi.hoisted(() => ({ keychain: { value: null as string | null } }))

vi.mock('@topoi/auth-session', () => ({
  TopoiAuthSession: {
    start: vi.fn(),
    setTokens: async ({ value }: { value: string }) => {
      keychain.value = value
    },
    getTokens: async () => ({ value: keychain.value }),
    clearTokens: async () => {
      keychain.value = null
    }
  }
}))
vi.mock('@capacitor/preferences', async () => ({ Preferences: (await import('../test/device')).Preferences }))

const GATEWAY = 'https://gw.test'

const tokens: StoredTokens = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_at: 1_800_000_000,
  provider: 'github',
  user_id: 'u1'
}

const fetchMock = vi.fn()
const start = vi.mocked(TopoiAuthSession.start)

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** The plugin answers the callback URL the browser would have been sent to, with the state it was handed, so the flow under test is the real one. */
function answerCallback(code?: string, error?: string): void {
  start.mockImplementation(async options => {
    const url = new URL(options.url)
    const callback = new URL('http://127.0.0.1:5555/callback')
    callback.searchParams.set('state', url.searchParams.get('state') ?? '')
    if (code) callback.searchParams.set('code', code)
    if (error) callback.searchParams.set('error', error)
    return { url: callback.toString() }
  })
}

function bodyOf(call: number): Record<string, string> {
  return JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string) as Record<string, string>
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  keychain.value = null
  vi.stubGlobal('fetch', fetchMock)
})

describe('the PKCE pair', () => {
  it('mints a base64url verifier and state that no two sign-ins share', () => {
    const verifier = generateVerifier()
    const state = generateState()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(verifier).toHaveLength(86)
    expect(state).toHaveLength(43)
    expect(generateVerifier()).not.toBe(verifier)
    expect(generateState()).not.toBe(state)
  })

  it('challenges with the SHA-256 of the verifier, in base64url', async () => {
    const verifier = 'a-verifier-for-the-test'
    expect(await challengeFor(verifier)).toBe(createHash('sha256').update(verifier).digest('base64url'))
  })
})

describe('signIn', () => {
  it('sends the challenge, checks the state and stores the tokens', async () => {
    answerCallback('code-1')
    fetchMock.mockResolvedValueOnce(answer(tokens))
    await expect(signIn(GATEWAY)).resolves.toEqual(tokens)
    expect(loadTokens()).toEqual(tokens)
    const options = start.mock.calls[0][0]
    const url = new URL(options.url)
    expect(url.origin + url.pathname).toBe(`${GATEWAY}/auth/native/authorize`)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(options.redirectPath).toBe('/callback')
    expect(fetchMock.mock.calls[0][0]).toBe(`${GATEWAY}/auth/native/token`)
    expect(bodyOf(0).code).toBe('code-1')
    expect(createHash('sha256').update(bodyOf(0).code_verifier).digest('base64url')).toBe(url.searchParams.get('code_challenge'))
  })

  it('refuses a callback that carries an error', async () => {
    answerCallback(undefined, 'access_denied')
    await expect(signIn(GATEWAY)).rejects.toThrow('Sign-in failed: access_denied')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a callback whose state is not the one it asked with', async () => {
    start.mockResolvedValue({ url: 'http://127.0.0.1:5555/callback?code=code-1&state=someone-elses' })
    await expect(signIn(GATEWAY)).rejects.toThrow('Sign-in state mismatch')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a callback with no code', async () => {
    answerCallback()
    await expect(signIn(GATEWAY)).rejects.toThrow('Sign-in callback carried no code')
  })
})

describe('exchangeCode', () => {
  it('names the status when the gateway refuses the code', async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: 'Invalid or expired authorization code.' }, 400))
    await expect(exchangeCode(GATEWAY, 'code-1', 'verifier-1')).rejects.toThrow('Token exchange failed (400)')
  })

  it('sends the verifier with the code', async () => {
    fetchMock.mockResolvedValueOnce(answer(tokens))
    await expect(exchangeCode(GATEWAY, 'code-1', 'verifier-1')).resolves.toEqual(tokens)
    expect(bodyOf(0)).toEqual({ code: 'code-1', code_verifier: 'verifier-1' })
  })
})

describe('refreshTokens', () => {
  it('rotates the tokens and stores the new pair', async () => {
    fetchMock.mockResolvedValueOnce(answer({ ...tokens, access_token: 'access-2' }))
    await expect(refreshTokens(GATEWAY, tokens)).resolves.toEqual({ ...tokens, access_token: 'access-2' })
    expect(bodyOf(0)).toEqual({ refresh_token: 'refresh-1', provider: 'github' })
    expect(loadTokens()?.access_token).toBe('access-2')
  })

  it('names the status when the refresh is refused', async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: 'expired' }, 401))
    await expect(refreshTokens(GATEWAY, tokens)).rejects.toThrow('Token refresh failed (401)')
  })
})
