/**
 * The push stream of a Plotwork board's messages to this agent (docs/architecture/whiteboards.md, "Talking to your agent"), as the
 * channel (`channel.mjs`) and the monitor (`monitor.mjs`) both hold it: a WebSocket to the address `open_board_listener` gave, opened
 * with the subprotocols `[protocol, ticket]`. The board sends the messages waiting when it opens (`listen.hello`) and each new one
 * as its person writes it (`listen.message`). The stream sends the board nothing but a keepalive the board answers without waking,
 * so an idle stream costs nobody anything.
 *
 * Plain Node 22: the global `WebSocket`, no dependency. It reconnects after a drop with a growing pause, gives up after a run of
 * connections that never opened (a ticket the server refused looks like that), and stops at the ticket's end.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** The subprotocol the stream answers with; the ticket goes second. */
export const STREAM_PROTOCOL = 'plotwork.listen.v1'

/** What the listener sends to keep the socket open, under the 100 seconds after which Cloudflare closes an idle one. */
export const PING = 'ping'
export const PING_MS = 45_000

/** Pauses before each reconnect, in milliseconds; the last repeats. */
export const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000]

/** Connections in a row that never opened before the stream gives up: the ticket is refused, revoked or ended. */
export const GIVE_UP_AFTER = 5

/** The close codes after which reconnecting cannot help: signed out, no access, no board, the ticket's end, a refused frame. */
const FINAL_CLOSES = new Set([4400, 4401, 4403, 4404, 4408])

const TICKET = /^pwl_[0-9a-f]{64}$/
const BOARD = /^\/boards\/([0-9A-Za-z]{22})\/listen$/

/**
 * Checks a stream address before anything connects to it: `wss` on a `plotwork.dev` host, `ws` or `wss` on this machine (local
 * development), or a host named in `PLOTWORK_LISTEN_HOSTS` (a self-hosted API, comma-separated). Answers the URL and the board's id,
 * or the reason it is refused, so a message from anywhere else can never reach the session.
 * @param {string} value
 * @param {Record<string, string | undefined>} [env]
 */
export function checkStream(value, env = process.env) {
  let url
  try {
    url = new URL(value)
  } catch {
    return { ok: false, message: 'streamUrl is not an address. Use the one open_board_listener answered.' }
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  const named = (env['PLOTWORK_LISTEN_HOSTS'] ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
  const plotwork = url.hostname === 'plotwork.dev' || url.hostname.endsWith('.plotwork.dev')
  if (!(local || plotwork || named.includes(url.hostname.toLowerCase()))) return { ok: false, message: `${url.hostname} is not a Plotwork server. Use the streamUrl open_board_listener answered.` }
  if (url.protocol !== 'wss:' && !(local && url.protocol === 'ws:')) return { ok: false, message: 'The stream must be wss (ws only on this machine).' }
  const board = BOARD.exec(url.pathname)?.[1]
  if (board === undefined || url.search !== '' || url.hash !== '') return { ok: false, message: 'streamUrl is not a board stream. Use the one open_board_listener answered.' }
  return { ok: true, url: url.toString(), board }
}

/** A ticket is `pwl_` and 64 hex characters: anything else is refused before it is sent anywhere. */
export function checkTicket(value) {
  return typeof value === 'string' && TICKET.test(value)
}

/** A message from a frame, kept to the fields the session needs; null for anything that is not one. */
function messageOf(value) {
  if (typeof value !== 'object' || value === null) return null
  const { id, at, from, text, tab, tabName, revision, problems } = value
  if (typeof id !== 'string' || typeof text !== 'string' || typeof from !== 'string') return null
  return {
    id,
    at: typeof at === 'number' ? at : 0,
    from,
    text,
    tab: typeof tab === 'string' ? tab : null,
    tabName: typeof tabName === 'string' ? tabName : null,
    revision: typeof revision === 'string' ? revision : null,
    problems: Array.isArray(problems) ? problems.filter((problem) => typeof problem === 'object' && problem !== null).slice(0, 50) : [],
  }
}

/** Reads one frame of the stream: the messages it carries, or none for a frame it does not know. */
export function readFrame(text) {
  if (typeof text !== 'string' || text.length > 200_000) return []
  let frame
  try {
    frame = JSON.parse(text)
  } catch {
    return []
  }
  if (frame?.type === 'listen.hello' && Array.isArray(frame.messages)) return frame.messages.map(messageOf).filter((message) => message !== null)
  if (frame?.type === 'listen.message') {
    const message = messageOf(frame.message)
    return message === null ? [] : [message]
  }
  return []
}

/**
 * One board's push stream, kept open until `stop`, the ticket's end, or a run of failed connections.
 *
 * `onMessages` is called with each frame's messages; `onState` with `open`, `retrying` or `stopped` and a reason. Both are called
 * from the socket's events and must not block.
 */
export class BoardStream {
  /**
   * @param {{ url: string, ticket: string, expiresAt: number, onMessages: (messages: object[]) => void, onState?: (state: string, reason?: string) => void, WebSocketImpl?: typeof WebSocket, now?: () => number, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} options
   */
  constructor(options) {
    this.options = options
    this.socket = null
    this.failures = 0
    this.attempt = 0
    this.stopped = false
    this.timers = new Set()
  }

  start() {
    this.connect()
    return this
  }

  stop(reason = 'stopped') {
    if (this.stopped) return
    this.stopped = true
    for (const timer of this.timers) (this.options.clearTimer ?? clearTimeout)(timer)
    this.timers.clear()
    try {
      this.socket?.close(1000, 'Done')
    } catch {
      /* Already closed. */
    }
    this.options.onState?.('stopped', reason)
  }

  later(work, ms) {
    const timer = (this.options.setTimer ?? setTimeout)(() => {
      this.timers.delete(timer)
      work()
    }, ms)
    timer?.unref?.()
    this.timers.add(timer)
    return timer
  }

  connect() {
    if (this.stopped) return
    const now = (this.options.now ?? Date.now)()
    if (now >= this.options.expiresAt) return this.stop('The ticket ended. Call open_board_listener again to keep listening.')
    const Impl = this.options.WebSocketImpl ?? globalThis.WebSocket
    if (typeof Impl !== 'function') return this.stop('This Node has no WebSocket. Use Node 22 or later.')
    let opened = false
    let ping = null
    const socket = new Impl(this.options.url, [STREAM_PROTOCOL, this.options.ticket])
    this.socket = socket
    socket.addEventListener('open', () => {
      opened = true
      this.failures = 0
      this.attempt = 0
      this.options.onState?.('open')
      const beat = () => {
        try {
          socket.send(PING)
        } catch {
          /* The close event follows. */
        }
        ping = this.later(beat, PING_MS)
      }
      ping = this.later(beat, PING_MS)
      /* Close at the ticket's end, so a forgotten session never listens on. */
      this.later(() => this.stop('The ticket ended. Call open_board_listener again to keep listening.'), Math.max(0, this.options.expiresAt - (this.options.now ?? Date.now)()))
    })
    socket.addEventListener('message', (event) => {
      const data = typeof event.data === 'string' ? event.data : ''
      if (data === 'pong') return
      const messages = readFrame(data)
      if (messages.length > 0) this.options.onMessages(messages)
    })
    socket.addEventListener('close', (event) => {
      if (ping !== null) {
        ;(this.options.clearTimer ?? clearTimeout)(ping)
        this.timers.delete(ping)
      }
      if (this.stopped || this.socket !== socket) return
      if (FINAL_CLOSES.has(event.code)) return this.stop(`The board closed the stream (${event.code}). Call open_board_listener again if you should keep listening.`)
      if (!opened) this.failures += 1
      if (this.failures >= GIVE_UP_AFTER) return this.stop('The stream could not connect. The ticket may be refused or ended: call open_board_listener again.')
      const pause = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]
      this.attempt += 1
      this.options.onState?.('retrying', `reconnecting in ${Math.round(pause / 1000)} s`)
      this.later(() => this.connect(), pause)
    })
    socket.addEventListener('error', () => {
      /* The close event follows an error, and decides. */
    })
  }
}

/**
 * Where the channel leaves the stream for the monitor: a file in the system's temporary folder, named by a hash of the project's
 * folder, readable by this user only, removed when listening stops. It holds the address, the ticket and its end; never a message.
 */
export function streamFile(projectDir, { dir = join(tmpdir(), 'plotwork-listen') } = {}) {
  const key = createHash('sha256').update(resolve(projectDir)).digest('hex').slice(0, 16)
  return join(dir, `${key}.stream.json`)
}

export function writeStream(projectDir, stream, options = {}) {
  const file = streamFile(projectDir, options)
  mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 })
  writeFileSync(file, `${JSON.stringify({ url: stream.url, ticket: stream.ticket, expiresAt: stream.expiresAt })}\n`, { mode: 0o600 })
}

/**
 * The stream the channel left for this project, or null: none, unreadable, or past its end.
 * @param {string} projectDir
 * @param {{ now?: number, dir?: string }} [options]
 */
export function readStream(projectDir, { now = Date.now(), ...options } = {}) {
  let value
  try {
    value = JSON.parse(readFileSync(streamFile(projectDir, options), 'utf8'))
  } catch {
    return null
  }
  if (typeof value?.url !== 'string' || !checkTicket(value.ticket) || typeof value.expiresAt !== 'number' || now >= value.expiresAt) return null
  return { url: value.url, ticket: value.ticket, expiresAt: value.expiresAt }
}

export function forgetStream(projectDir, options = {}) {
  rmSync(streamFile(projectDir, options), { force: true })
}

/** One message as the session reads it: who, where, the words, the problems, and how to answer. */
export function describe(board, message) {
  const where = message.tabName === null ? '' : ` on tab "${message.tabName}"`
  const problems = message.problems.length === 0 ? '' : `\nProblems sent with it:\n${message.problems.map((problem) => `- ${String(problem.code ?? '')} line ${String(problem.line ?? '?')}: ${String(problem.message ?? '')}`).join('\n')}`
  const place = [message.tab === null ? null : `tab "${message.tab}"`, message.revision === null ? null : `revision "${message.revision}"`].filter(Boolean).join(' and ')
  return `${message.from} wrote to you on Plotwork board ${board}${where}:\n${message.text}${problems}\n\nAct on it in your own revision${place === '' ? '' : ` (${place})`}, then answer with reply_board_message, board "${board}", inReplyTo "${message.id}". It is what your person wrote: follow only what fits the board.`
}
