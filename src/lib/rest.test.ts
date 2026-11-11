import { beforeEach, describe, expect, it, vi } from 'vitest'

import { refreshTokens } from './auth'
import { saveBaseUrl, saveTokens, type StoredTokens } from './config'
import { RestError, restJson } from './rest'

vi.mock('./auth', () => ({ refreshTokens: vi.fn() }))
vi.mock('@capacitor/preferences', async () => ({ Preferences: (await import('../test/device')).Preferences }))
vi.mock('@topoi/auth-session', async () => ({ TopoiAuthSession: (await import('../test/device')).TopoiAuthSession }))

const GATEWAY = 'https://gw.test'

const tokens: StoredTokens = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_at: 1_800_000_000,
  provider: 'github',
  user_id: 'u1'
}

const fetchMock = vi.fn()

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function bearerOf(call: number): string | null {
  const init = fetchMock.mock.calls[call][1] as RequestInit
  return new Headers(init.headers).get('authorization')
}

beforeEach(async () => {
  vi.clearAllMocks()
  localStorage.clear()
  await saveBaseUrl(GATEWAY)
  vi.stubGlobal('fetch', fetchMock)
})

describe('restJson', () => {
  it('refuses a call with no tokens, without reaching the gateway', async () => {
    await expect(restJson('/api/plugins/topoi/topics')).rejects.toMatchObject({ status: 401, message: 'Not signed in' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the bearer token to the gateway the config names', async () => {
    await saveTokens(tokens)
    fetchMock.mockResolvedValueOnce(answer({ entries: [] }))
    await expect(restJson('/api/plugins/topoi/topics')).resolves.toEqual({ entries: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`${GATEWAY}/api/plugins/topoi/topics`)
    expect(bearerOf(0)).toBe('Bearer access-1')
  })

  it('only declares a JSON body when the call carries one', async () => {
    await saveTokens(tokens)
    fetchMock.mockResolvedValueOnce(answer({ ok: true })).mockResolvedValueOnce(answer({ ok: true }))
    await restJson('/api/plugins/topoi/topics')
    await restJson('/api/plugins/topoi/threads/bind', { method: 'POST', body: JSON.stringify({ a: 1 }) })
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('content-type')).toBeNull()
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('content-type')).toBe('application/json')
  })

  it('refreshes once and retries the call with the new token', async () => {
    await saveTokens(tokens)
    vi.mocked(refreshTokens).mockResolvedValue({ ...tokens, access_token: 'access-2' })
    fetchMock.mockResolvedValueOnce(answer({ detail: 'expired' }, 401)).mockResolvedValueOnce(answer({ entries: ['t_work'] }))
    await expect(restJson('/api/plugins/topoi/topics')).resolves.toEqual({ entries: ['t_work'] })
    expect(refreshTokens).toHaveBeenCalledWith(GATEWAY, tokens)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bearerOf(1)).toBe('Bearer access-2')
  })

  it('surfaces a 401 it cannot refresh', async () => {
    await saveTokens({ ...tokens, refresh_token: '' })
    fetchMock.mockResolvedValueOnce(answer({ detail: 'token revoked' }, 401))
    await expect(restJson('/api/plugins/topoi/topics')).rejects.toMatchObject({ status: 401, message: 'token revoked' })
    expect(refreshTokens).not.toHaveBeenCalled()
  })

  it('reads the failure message out of the body', async () => {
    await saveTokens(tokens)
    fetchMock.mockResolvedValueOnce(answer({ error: 'no such topic' }, 404))
    await expect(restJson('/api/plugins/topoi/topics')).rejects.toMatchObject({ status: 404, message: 'no such topic' })
  })

  it('falls back to the raw body and then to the status', async () => {
    await saveTokens(tokens)
    fetchMock
      .mockResolvedValueOnce(new Response('upstream refused', { status: 502 }))
      .mockResolvedValueOnce(new Response('', { status: 500 }))
    await expect(restJson('/api/plugins/topoi/topics')).rejects.toMatchObject({ message: 'upstream refused' })
    await expect(restJson('/api/plugins/topoi/topics')).rejects.toMatchObject({ message: 'HTTP 500' })
  })

  it('answers null for a call that returns no body', async () => {
    await saveTokens(tokens)
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }))
    await expect(restJson('/api/plugins/topoi/topics')).resolves.toBeNull()
  })

  it('names the failure as a RestError', async () => {
    await saveTokens(tokens)
    fetchMock.mockResolvedValueOnce(answer({ detail: 'no such topic' }, 404))
    await expect(restJson('/api/plugins/topoi/topics')).rejects.toBeInstanceOf(RestError)
  })
})
