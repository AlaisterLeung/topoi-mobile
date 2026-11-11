#!/usr/bin/env node
/** Prove the gateway leg of mobile attachments: the two attach calls the app
 *  makes, and the prompt that carries what they answer with.
 *
 *  A thread screen on the phone cannot be driven by a script (the composer
 *  keeps its text inside assistant-ui), so the transport is proven here instead:
 *  a real ws-ticket, a real session, the real frames.
 *
 *  Usage:
 *    TOPOI_URL=https://agent.atxoft.com TOPOI_TOKEN=<bearer> node scripts/attach-probe.mjs
 *
 *  The token is the app's own access token (the one its REST client sends as
 *  `authorization: Bearer`). Nothing is written anywhere but the session the
 *  probe mints, which is left behind as a normal empty thread. */

const url = (process.env.TOPOI_URL || '').replace(/\/+$/, '')
const token = process.env.TOPOI_TOKEN || ''

if (!url || !token) {
  console.error('TOPOI_URL and TOPOI_TOKEN are both required')
  process.exit(2)
}

/** A 1x1 PNG: the smallest thing the image pipeline will accept. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const TEXT_BASE64 = Buffer.from('attachment probe\n', 'utf8').toString('base64')

const failures = []

function check(name, condition, detail) {
  if (condition) {
    console.log(`PASS  ${name}${detail ? ` (${detail})` : ''}`)
    return
  }
  failures.push(name)
  console.log(`FAIL  ${name}${detail ? ` (${detail})` : ''}`)
}

async function ticket() {
  const response = await fetch(`${url}/api/auth/ws-ticket`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` }
  })
  if (!response.ok) throw new Error(`ws-ticket failed (${response.status})`)
  const body = await response.json()
  return body.ticket
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl)
  const pending = new Map()
  socket.addEventListener('message', event => {
    let frame
    try {
      frame = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
    } catch {
      return
    }
    // Events and server->client requests are not what this probe is waiting on.
    if (frame.id === undefined || !pending.has(String(frame.id))) return
    const entry = pending.get(String(frame.id))
    pending.delete(String(frame.id))
    if (frame.error) entry.reject(new Error(`${frame.error.message || 'gateway error'} (${frame.error.code})`))
    else entry.resolve(frame.result)
  })
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () => reject(new Error(`could not open ${wsUrl}`)))
  })
  let nextId = 0
  const call = async (method, params = {}, timeoutMs = 30_000) => {
    await ready
    const id = `probe-${nextId++}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      pending.set(id, {
        resolve: value => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: error => {
          clearTimeout(timer)
          reject(error)
        }
      })
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }
  return { call, close: () => socket.close() }
}

const wsUrl = `${url.replace(/^http/, 'ws')}/api/ws?ticket=${encodeURIComponent(await ticket())}`
const gateway = connect(wsUrl)

try {
  const session = await gateway.call('session.create', { source: 'mobile' })
  const sessionId = session.session_id
  check('session.create mints a session', Boolean(sessionId), sessionId)

  const image = await gateway.call('image.attach_bytes', {
    session_id: sessionId,
    content_base64: PNG_BASE64,
    filename: 'probe.png'
  })
  check('image.attach_bytes stages an image', image?.attached === true, image?.path)
  check('an image is queued for the next turn', Boolean(image?.path))

  const file = await gateway.call('file.attach', {
    session_id: sessionId,
    name: 'probe.txt',
    data_url: `data:text/plain;base64,${TEXT_BASE64}`
  })
  check('file.attach stages a file', file?.attached === true, file?.path)
  check('a file answers with the ref the prompt must carry', /^@file:/.test(file?.ref_text || ''), file?.ref_text)

  const composed = [
    `[User attached image: probe.png]`,
    file?.ref_text,
    'Probe: are the attachments above visible to you?'
  ]
    .filter(Boolean)
    .join('\n\n')
  try {
    const submitted = await gateway.call('prompt.submit', { session_id: sessionId, text: composed })
    check('prompt.submit accepts the composed text', submitted !== undefined && submitted !== null)
  } catch (error) {
    // A gateway with no model configured cannot run a turn; that is this
    // machine's state, not the transport's, so it is reported as a skip.
    const message = error instanceof Error ? error.message : String(error)
    if (/provider|model|credential|api key/i.test(message)) {
      console.log(`SKIP  prompt.submit (${message})`)
    } else {
      throw error
    }
  }
} catch (error) {
  failures.push('probe run')
  console.log(`FAIL  probe run (${error instanceof Error ? error.message : String(error)})`)
} finally {
  gateway.close()
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)
