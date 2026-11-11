import { Capacitor, CapacitorHttp } from '@capacitor/core'

/** A gateway request that holds up under both origins.
 *
 *  Capacitor's fetch patch sends POST, PUT, PATCH and DELETE through the native
 *  HTTP plugin, but rewrites GET and HEAD to
 *  `${getServerUrl()}/_capacitor_http_interceptor_?...`, and getServerUrl()
 *  stays capacitor://localhost even in live reload. A dev-server origin cannot
 *  load that scheme, so every read failed with `TypeError: Load failed` while
 *  writes kept working. Reads therefore call the native plugin themselves;
 *  the other methods stay on the patched fetch, which is already native.
 *
 *  A browser build has no native rails, so it keeps plain fetch and rides the
 *  gateway's own CORS allowlist. */
export async function gatewayFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  if (!Capacitor.isNativePlatform() || (method !== 'GET' && method !== 'HEAD')) {
    return fetch(url, init)
  }

  const headers: Record<string, string> = {}
  new Headers(init.headers).forEach((value, key) => {
    headers[key] = value
  })

  const {
    data,
    status,
    headers: raw
  } = await CapacitorHttp.request({ url, method, headers, responseType: 'text' })

  // A null-body status rejects a body in the Response constructor. The plugin
  // parses application/json itself whatever responseType asks for, so an object
  // has to be put back into text before Response sees it.
  const body =
    status === 204 || status === 304 ? null : typeof data === 'string' ? data : JSON.stringify(data ?? null)
  return new Response(body, { status, headers: raw })
}
