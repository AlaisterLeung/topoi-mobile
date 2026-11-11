import {
  JsonRpcGatewayClient,
  isStableOpen,
  reconnectBackoffDelayMs,
  type ConnectionState,
  type GatewayEvent
} from '@topoi/core'
import type {
  PromptSubmitResult,
  SessionCreateResult,
  SessionListResult,
  SessionListRow,
  SessionResumeResult
} from '@topoi/core'

import { refreshTokens } from './auth'
import type { AttachFileReply, AttachImageReply } from './attachments'
import { loadBaseUrl, loadTokens, type StoredTokens } from './config'
import { gatewayFetch } from './native-http'

/** The app's view of the link. The client's own `closed` never surfaces past
 *  the supervisor: a drop it can repair reads as `reconnecting`. */
export type LinkState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'error'

/** How long a call waits for the link before it gives up. */
const OPEN_WAIT_MS = 20_000

interface OpenWaiter {
  settle: (error?: Error) => void
}

/** One gateway connection: ws-ticket mint, JSON-RPC surface, token refresh.
 *  Tickets are single-use with a 30s TTL, so every dial mints a fresh one.
 *  The client never redials on its own - it hands that to its owner - so this
 *  class owns the socket's lifetime and redials on the shared full-jitter
 *  ladder. Without an owner a drop (socket close, or the heartbeat deadline
 *  after a gateway restart) left every later call to fail with the client's own
 *  `gateway not connected` until the app was relaunched. */
export class Gateway {
  private client: JsonRpcGatewayClient | null = null
  private baseUrl = ''
  private tokens: StoredTokens | null = null
  private link: LinkState = 'idle'
  private readonly linkHandlers = new Set<(state: LinkState) => void>()
  private readonly openWaiters = new Set<OpenWaiter>()
  private dialing: Promise<void> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  /** Failed dials since the last socket that lived past RECONNECT_STABLE_OPEN_MS. */
  private attempt = 0
  private openedAt: number | null = null
  private wantOpen = false
  private listening = false

  get connectionState(): LinkState {
    return this.link
  }

  /** Watch the link: fires once with the current state, then on every change. */
  onState(handler: (state: LinkState) => void): () => void {
    this.linkHandlers.add(handler)
    handler(this.link)
    return () => this.linkHandlers.delete(handler)
  }

  /** Bring the link up and keep it up. Rejects when the first dial fails, and
   *  leaves the supervisor redialing in the background. */
  async connect(): Promise<void> {
    this.wantOpen = true
    this.watchLifecycle()
    await this.dial()
  }

  /** Drop the link and stop supervising it: sign-out. */
  stop(): void {
    this.wantOpen = false
    this.clearTimer()
    this.attempt = 0
    this.openedAt = null
    this.dialing = null
    this.client?.close()
    this.setLink('idle')
  }

  /** Wait for the link, dialing now when it is down: a call made inside a
   *  redial window waits for the connection instead of failing outright. */
  async ensureOpen(timeoutMs = OPEN_WAIT_MS): Promise<void> {
    if (this.link === 'open') return
    if (!loadTokens()) throw new Error('Not signed in')
    this.wantOpen = true
    this.watchLifecycle()
    // A user action dials at once rather than waiting out the ladder; the
    // supervisor takes over again when this attempt fails.
    this.clearTimer()
    void this.dial().catch(() => this.scheduleReconnect())
    await this.waitForOpen(timeoutMs)
  }

  async listSessions(limit = 100): Promise<SessionListRow[]> {
    const result = await this.request<SessionListResult>('session.list', { limit })
    return result.sessions
  }

  async resume(sessionId: string): Promise<SessionResumeResult> {
    return this.request<SessionResumeResult>('session.resume', { session_id: sessionId })
  }

  /** Mint a live session for a new thread. Prompts and events speak the runtime
   *  id it answers with; the stored id is the one the row and the topic filing
   *  use, and its row lands with the first prompt. */
  async createSession(): Promise<SessionCreateResult> {
    return this.request<SessionCreateResult>('session.create', { source: 'mobile' })
  }

  async submit(sessionId: string, text: string): Promise<PromptSubmitResult> {
    return this.request<PromptSubmitResult>('prompt.submit', { session_id: sessionId, text })
  }

  /** Stage one image for the next turn. The bytes ride this frame as base64,
   *  because the file the user picked lives on the phone, not on the gateway,
   *  which is what the core's own `image.attach_bytes` exists for. */
  async attachImageBytes(
    sessionId: string,
    payload: { contentBase64: string; filename: string }
  ): Promise<AttachImageReply> {
    return this.request<AttachImageReply>('image.attach_bytes', {
      session_id: sessionId,
      content_base64: payload.contentBase64,
      filename: payload.filename
    })
  }

  /** Stage one non-image file into the session's own attachments directory. The
   *  answer carries the workspace ref the submitted prompt has to carry for the
   *  agent to read the file: it is staged, never pasted into the text. */
  async attachFile(
    sessionId: string,
    payload: { name: string; dataUrl: string }
  ): Promise<AttachFileReply> {
    return this.request<AttachFileReply>('file.attach', {
      session_id: sessionId,
      name: payload.name,
      data_url: payload.dataUrl
    })
  }

  onEvent(handler: (event: GatewayEvent) => void): () => void {
    return this.ensureClient().onEvent(handler)
  }

  /** One JSON-RPC call on this link, dialing first when it is down: the
   *  composer's pickers read and write session state through it. */
  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.request<T>(method, params)
  }

  private request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    return this.ensureOpen().then(() => this.requireClient().request<T>(method, params))
  }

  private requireClient(): JsonRpcGatewayClient {
    if (!this.client) throw new Error('Gateway not connected')
    return this.client
  }

  /** The client is created once and kept: a screen's event subscription rides
   *  its hub, so a redial must never replace the instance. */
  private ensureClient(): JsonRpcGatewayClient {
    if (!this.client) {
      const client = new JsonRpcGatewayClient()
      client.onState(state => this.handleClientState(state))
      this.client = client
    }
    return this.client
  }

  /** One dial at a time, with a ticket minted for this attempt. */
  private dial(): Promise<void> {
    if (!this.dialing) {
      this.dialing = this.runDial().finally(() => {
        this.dialing = null
      })
    }
    return this.dialing
  }

  private async runDial(): Promise<void> {
    this.baseUrl = loadBaseUrl()
    this.tokens = loadTokens()
    if (!this.tokens) throw new Error('Not signed in')
    const ticket = await this.fetchWsTicket(this.tokens)
    const wsUrl = `${this.baseUrl.replace(/^http/, 'ws')}/api/ws?ticket=${encodeURIComponent(ticket)}`
    await this.ensureClient().connect(wsUrl)
  }

  private async fetchWsTicket(tokens: StoredTokens): Promise<string> {
    const res = await gatewayFetch(`${this.baseUrl}/api/auth/ws-ticket`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens.access_token}` }
    })
    if (res.status === 401 && tokens.refresh_token) {
      const refreshed = await refreshTokens(this.baseUrl, tokens)
      this.tokens = refreshed
      return this.fetchWsTicket(refreshed)
    }
    if (!res.ok) throw new Error(`ws-ticket failed (${res.status})`)
    const body = (await res.json()) as { ticket: string }
    return body.ticket
  }

  private handleClientState(state: ConnectionState): void {
    if (state === 'open') {
      this.openedAt = Date.now()
      this.setLink('open')
      return
    }
    if (state === 'connecting') {
      this.setLink(this.openedAt === null && this.attempt === 0 ? 'connecting' : 'reconnecting')
      return
    }
    if (!this.wantOpen) {
      this.setLink('idle')
      return
    }
    // 'closed' / 'error': the client never redials, so the supervisor does.
    this.setLink('reconnecting')
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (!this.wantOpen || this.reconnectTimer !== null || this.dialing) return
    // A socket that lived past the stable-open window clears the ladder; one
    // that accepts and dies keeps escalating (the shared rule).
    if (isStableOpen(this.openedAt)) {
      this.attempt = 0
    }
    const delay = reconnectBackoffDelayMs(this.attempt)
    this.attempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.redial()
    }, delay)
  }

  private async redial(): Promise<void> {
    if (!this.wantOpen || this.link === 'open') return
    try {
      await this.dial()
    } catch {
      this.scheduleReconnect()
    }
  }

  private clearTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private waitForOpen(timeoutMs: number): Promise<void> {
    if (this.link === 'open') return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const waiter: OpenWaiter = {
        settle: error => {
          clearTimeout(timer)
          this.openWaiters.delete(waiter)
          if (error) reject(error)
          else resolve()
        }
      }
      const timer = setTimeout(() => waiter.settle(new Error('gateway not connected')), timeoutMs)
      this.openWaiters.add(waiter)
    })
  }

  /** iOS suspends the webview's timers, so a socket can die in the background
   *  with no event reaching JS and the heartbeat deadline only runs once timers
   *  resume: re-check the link on the way back to the front. */
  private watchLifecycle(): void {
    if (this.listening || typeof document === 'undefined') return
    this.listening = true
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.nudge()
    })
    window.addEventListener('focus', () => void this.nudge())
    window.addEventListener('online', () => void this.nudge())
  }

  private async nudge(): Promise<void> {
    if (!this.wantOpen || this.link === 'open') return
    try {
      await this.ensureOpen()
    } catch {
      // The supervisor keeps redialing; a nudge never surfaces its own error.
    }
  }

  private setLink(state: LinkState): void {
    if (this.link === state) return
    this.link = state
    for (const handler of this.linkHandlers) handler(state)
    if (state === 'open') {
      for (const waiter of [...this.openWaiters]) waiter.settle()
    }
  }
}

export const gateway = new Gateway()
