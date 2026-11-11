import { TopoiAuthSession } from '@topoi/auth-session'

import { loadBaseUrl, saveTokens, type StoredTokens } from './config'
import { gatewayFetch } from './native-http'

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function generateVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(64)))
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

export function generateState(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

/** PKCE sign-in against the gateway's native authorize route. The redirect is
 *  a loopback URI, which is the only shape the route accepts, so the native
 *  plugin binds the listener and replays the callback URL back to us. */
export async function signIn(baseUrl = loadBaseUrl()): Promise<StoredTokens> {
  const verifier = generateVerifier()
  const challenge = await challengeFor(verifier)
  const state = generateState()

  const params = new URLSearchParams({
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state
  })
  const { url: callbackUrl } = await TopoiAuthSession.start({
    url: `${baseUrl}/auth/native/authorize?${params.toString()}`,
    redirectPath: '/callback'
  })

  const callback = new URL(callbackUrl)
  const error = callback.searchParams.get('error')
  if (error) throw new Error(`Sign-in failed: ${error}`)
  if (callback.searchParams.get('state') !== state) throw new Error('Sign-in state mismatch')
  const code = callback.searchParams.get('code')
  if (!code) throw new Error('Sign-in callback carried no code')

  const tokens = await exchangeCode(baseUrl, code, verifier)
  saveTokens(tokens)
  return tokens
}

export async function exchangeCode(baseUrl: string, code: string, verifier: string): Promise<StoredTokens> {
  const res = await gatewayFetch(`${baseUrl}/auth/native/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier })
  })
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`)
  return (await res.json()) as StoredTokens
}

export async function refreshTokens(baseUrl: string, tokens: StoredTokens): Promise<StoredTokens> {
  const res = await gatewayFetch(`${baseUrl}/auth/native/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: tokens.refresh_token, provider: tokens.provider })
  })
  if (!res.ok) throw new Error(`Token refresh failed (${res.status})`)
  const refreshed = (await res.json()) as StoredTokens
  saveTokens(refreshed)
  return refreshed
}
