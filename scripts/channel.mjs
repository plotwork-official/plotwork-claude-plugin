#!/usr/bin/env node
/**
 * The plugin's board channel (`plotwork-board`): an MCP server over stdio that Claude Code starts with the session and that pushes a
 * Plotwork board's messages into it, so the agent is told the moment its person writes and never polls
 * (docs/architecture/whiteboards.md, "Talking to your agent").
 *
 * It declares the `claude/channel` capability and has three tools:
 * - `listen_to_board` takes the `streamUrl` and `ticket` the hosted `open_board_listener` answered, holds the board's push stream
 *   (`board-stream.mjs`) and emits each message as `notifications/claude/channel`. The answer carries the messages already waiting.
 * - `next_board_messages` returns the messages it received since the last call, for a session where channel events do not arrive.
 * - `stop_listening` closes the stream.
 *
 * The agent answers each message with the hosted `reply_board_message`. While the stream is quiet nothing runs and no model turn is
 * spent. A message reaches the session only from the address it was given, which must be a Plotwork server (`checkStream`). Nothing
 * is written to stdout but the protocol, and nothing private to stderr.
 *
 * Claude Code registers the events only when the session opts in: `claude --channels plugin:plotwork@<marketplace>` once the plugin
 * is listed, or `--dangerously-load-development-channels` while it is not (README, "The board channel").
 */
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

import { BoardStream, checkStream, checkTicket, describe, forgetStream, writeStream } from './board-stream.mjs'

/** The MCP revisions this server speaks; an unknown newer one is answered with the newest here, which Claude Code accepts. */
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

/** The most messages kept for `next_board_messages`; the oldest goes first. */
const KEPT = 50

const INSTRUCTIONS =
  'Messages your person types to you on a Plotwork live whiteboard arrive as <channel source="plotwork-board" board="..." message_id="...">. Act on each in your own revision of the tab, then answer it with the hosted reply_board_message tool, passing board and message_id as inReplyTo. To start, call the hosted open_board_listener for the board, then listen_to_board with its streamUrl and ticket. If no channel event arrives after your person says they wrote, call next_board_messages: this session may not have channels on.'

const TOOLS = [
  {
    name: 'listen_to_board',
    description:
      "Hold a Plotwork board's push stream, so each message your person types to you arrives in this session as it is written, with no polling. Pass the streamUrl and ticket the hosted open_board_listener answered. Answers the messages already waiting. Then answer each with reply_board_message.",
    inputSchema: {
      type: 'object',
      properties: {
        streamUrl: { type: 'string', description: 'From open_board_listener.' },
        ticket: { type: 'string', description: 'From open_board_listener. Never write it in a file or a reply.' },
        expiresAt: { type: 'integer', description: 'From open_board_listener.' },
      },
      required: ['streamUrl', 'ticket'],
      additionalProperties: false,
    },
  },
  {
    name: 'next_board_messages',
    description: 'The board messages the stream received since the last call, oldest first. Only for a session where channel events do not arrive; otherwise each message comes to you on its own.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'stop_listening',
    description: "Close the board's push stream. The board then shows you as not listening.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

/**
 * The channel's state and its answers to JSON-RPC, apart from stdio so a test can drive it.
 * @param {{ write: (message: object) => void, projectDir?: string, env?: Record<string, string | undefined>, now?: () => number, WebSocketImpl?: typeof WebSocket, helloWaitMs?: number, streamDir?: string }} io
 */
export function createChannel(io) {
  const now = io.now ?? Date.now
  const projectDir = io.projectDir ?? process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
  const fileOptions = io.streamDir === undefined ? {} : { dir: io.streamDir }
  let stream = null
  let board = null
  let unread = []
  /* The first frame after listen_to_board is answered in its result; later ones go out as channel events. */
  let firstFrame = null

  const notify = (message) => {
    io.write({ jsonrpc: '2.0', method: 'notifications/claude/channel', params: { content: describe(board, message), meta: { board, message_id: message.id, tab_id: message.tab ?? '', revision_id: message.revision ?? '' } } })
  }

  const received = (messages) => {
    unread = [...unread, ...messages].slice(-KEPT)
    if (firstFrame !== null) {
      const done = firstFrame
      firstFrame = null
      done(messages)
      return
    }
    for (const message of messages) notify(message)
  }

  const stop = () => {
    stream?.stop()
    stream = null
    forgetStream(projectDir, fileOptions)
  }

  const text = (value, isError = false) => ({ content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) })

  async function listen(args) {
    const checked = checkStream(String(args?.streamUrl ?? ''), io.env ?? process.env)
    if (!checked.ok) return text(checked.message, true)
    if (!checkTicket(args?.ticket)) return text('ticket is not a Plotwork listen ticket. Use the one open_board_listener answered.', true)
    const expiresAt = typeof args?.expiresAt === 'number' && args.expiresAt > now() ? args.expiresAt : now() + 12 * 3_600_000
    stop()
    board = checked.board
    unread = []
    const hello = new Promise((resolve) => {
      firstFrame = resolve
    })
    stream = new BoardStream({ url: checked.url, ticket: args.ticket, expiresAt, onMessages: received, onState: () => undefined, WebSocketImpl: io.WebSocketImpl, now }).start()
    writeStream(projectDir, { url: checked.url, ticket: args.ticket, expiresAt }, fileOptions)
    const waiting = await Promise.race([hello, new Promise((resolve) => setTimeout(() => resolve(null), io.helloWaitMs ?? 5_000).unref?.())])
    if (waiting === null) {
      firstFrame = null
      return text(`Listening to board ${board}, but the stream has not opened yet; it keeps trying. Each message arrives as a <channel source="plotwork-board"> event. If none arrives after your person writes, call next_board_messages.`)
    }
    unread = []
    const until = new Date(expiresAt).toISOString()
    if (waiting.length === 0) return text(`Listening to board ${board} until ${until}. No message waits. Each new one arrives as a <channel source="plotwork-board"> event: act on it, then reply_board_message.`)
    return text(`Listening to board ${board} until ${until}. These were waiting, oldest first:\n\n${waiting.map((message) => describe(board, message)).join('\n\n---\n\n')}`)
  }

  /** Answers one JSON-RPC message, or nothing for a notification. */
  async function handle(message) {
    if (typeof message !== 'object' || message === null) return
    const { id, method, params } = message
    const reply = (result) => (id === undefined ? undefined : io.write({ jsonrpc: '2.0', id, result }))
    const fail = (code, words) => (id === undefined ? undefined : io.write({ jsonrpc: '2.0', id, error: { code, message: words } }))
    switch (method) {
      case 'initialize': {
        const asked = typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOLS[0]
        return reply({
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { experimental: { 'claude/channel': {} }, tools: {} },
          serverInfo: { name: 'plotwork-board', version: '0.1.0' },
          instructions: INSTRUCTIONS,
        })
      }
      case 'ping':
        return reply({})
      case 'tools/list':
        return reply({ tools: TOOLS })
      case 'tools/call': {
        const name = params?.name
        if (name === 'listen_to_board') return reply(await listen(params?.arguments))
        if (name === 'next_board_messages') {
          const taken = unread
          unread = []
          if (board === null) return reply(text('Not listening to a board. Call open_board_listener, then listen_to_board.'))
          return reply(text(taken.length === 0 ? 'No new message.' : taken.map((item) => describe(board, item)).join('\n\n---\n\n')))
        }
        if (name === 'stop_listening') {
          stop()
          return reply(text('Stopped listening. Your person sees you as not listening.'))
        }
        return fail(-32602, `No tool named ${String(name)}`)
      }
      default:
        if (typeof method === 'string' && method.startsWith('notifications/')) return
        return fail(-32601, `No method ${String(method)}`)
    }
  }

  return { handle, stop, get board() {
    return board
  } }
}

/** Runs the channel on stdio: one JSON-RPC message a line each way. */
function main() {
  const channel = createChannel({ write: (message) => process.stdout.write(`${JSON.stringify(message)}\n`) })
  const lines = createInterface({ input: process.stdin })
  lines.on('line', (line) => {
    if (line.trim() === '') return
    let message
    try {
      message = JSON.parse(line)
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`)
      return
    }
    channel.handle(message).catch(() => {
      if (message?.id !== undefined) process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'The channel failed to answer' } })}\n`)
    })
  })
  lines.on('close', () => {
    channel.stop()
    process.exit(0)
  })
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main()
