import { Preferences } from '@capacitor/preferences'

import { TopoiAuthSession } from '@topoi/auth-session'

/** The tokens a sign-in leaves behind. They live in the Keychain through the app's own native plugin, never in web storage: the refresh token is a long-lived credential and a webview's storage file is in every backup. */
export interface StoredTokens {
  access_token: string
  refresh_token: string
  expires_at: number
  provider: string
  user_id: string
}

/** The gateway is not a secret, so it rides Preferences (UserDefaults on iOS), which the OS does not evict the way it reclaims a webview's storage. */
const BASE_URL_KEY = 'topoi.baseUrl'

let baseUrl = ''
let tokens: StoredTokens | null = null

export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

/** The gateway this session talks to. Both stores are read once at boot, so every reader stays synchronous and none of them can decide before the value is known. */
export function loadBaseUrl(): string {
  return baseUrl
}

export function loadTokens(): StoredTokens | null {
  return tokens
}

/** Read both stores before the first render. The sign-in gate and the link both decide from these values, so a render that beat them would show a signed-out app over a session that exists. */
export async function hydrateConfig(): Promise<void> {
  baseUrl = (await preference(BASE_URL_KEY)) ?? ''
  tokens = parseTokens(await keychainRead())
}

export async function saveBaseUrl(url: string): Promise<void> {
  baseUrl = url
  await Preferences.set({ key: BASE_URL_KEY, value: url })
}

export async function saveTokens(next: StoredTokens): Promise<void> {
  tokens = next
  await TopoiAuthSession.setTokens({ value: JSON.stringify(next) })
}

/** Forget the session. The memory copy goes first, so the app is signed out even when the Keychain refuses the delete. */
export async function clearTokens(): Promise<void> {
  tokens = null
  await TopoiAuthSession.clearTokens()
}

function parseTokens(raw: string | null): StoredTokens | null {
  if (raw === null) return null
  try {
    return JSON.parse(raw) as StoredTokens
  } catch {
    return null
  }
}

async function preference(key: string): Promise<string | null> {
  try {
    const { value } = await Preferences.get({ key })
    return value
  } catch {
    return null
  }
}

async function keychainRead(): Promise<string | null> {
  try {
    const { value } = await TopoiAuthSession.getTokens()
    return value
  } catch {
    // A browser dev build has no Keychain; it reads as no session and lands on the gate.
    return null
  }
}
