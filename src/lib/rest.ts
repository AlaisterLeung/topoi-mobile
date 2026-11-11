import { refreshTokens } from './auth'
import { loadBaseUrl, loadTokens } from './config'
import { gatewayFetch } from './native-http'

/** A failed gateway REST call: `status` is the HTTP status, `message` the
 *  server's own detail when the body carried one. */
export class RestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** One authenticated call against the gateway's REST surface. The native rails
 *  rotate tokens through /auth/native/refresh, so a 401 refreshes once and
 *  retries before it surfaces. */
export async function restJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const tokens = loadTokens()
  if (!tokens) throw new RestError(401, 'Not signed in')
  const response = await send(path, init, tokens.access_token)
  if (response.status === 401 && tokens.refresh_token) {
    const refreshed = await refreshTokens(loadBaseUrl(), tokens)
    return finish<T>(await send(path, init, refreshed.access_token))
  }
  return finish<T>(response)
}

async function send(path: string, init: RequestInit, accessToken: string): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${accessToken}`)
  if (init.body) headers.set('content-type', 'application/json')
  return gatewayFetch(`${loadBaseUrl()}${path}`, { ...init, headers })
}

async function finish<T>(response: Response): Promise<T> {
  const body = await response.text()
  if (!response.ok) throw new RestError(response.status, failureOf(body, response.status))
  return (body ? JSON.parse(body) : null) as T
}

function failureOf(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { detail?: string; error?: string }
    return parsed.detail || parsed.error || `HTTP ${status}`
  } catch {
    return body || `HTTP ${status}`
  }
}
