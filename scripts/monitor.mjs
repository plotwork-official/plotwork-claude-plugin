#!/usr/bin/env node
/**
 * The plugin's board monitor: the fallback for a session that cannot load the board channel (`channel.mjs`). Claude Code starts it
 * with the session (`monitors/monitors.json`) and hands each line it prints to Claude as a notification. It does nothing unless
 * `PLOTWORK_LISTEN_MONITOR=on`, because a session that has the channel would otherwise be told every message twice.
 *
 * It waits for the stream the channel left for this project (`streamFile`, written by `listen_to_board`), holds the same push
 * stream, and prints one line a message: who wrote, the words on one line, and how to answer. It reads the file every five seconds
 * on this machine only; it never calls Plotwork until there is a ticket, and never writes a ticket anywhere.
 */
import { fileURLToPath } from 'node:url'

import { BoardStream, readStream } from './board-stream.mjs'

/** How often the monitor looks for the stream the channel left, in milliseconds. */
export const LOOK_MS = 5_000

/** The longest line a message becomes; Claude reads the rest with next_board_messages. */
const LINE_MAX = 400

/** One message as one line of the monitor's output. */
export function lineOf(board, message) {
  const words = message.text.replace(/\s+/g, ' ').trim()
  const cut = words.length > LINE_MAX ? `${words.slice(0, LINE_MAX)} (cut, read it with next_board_messages)` : words
  const where = message.tabName === null ? '' : ` on tab "${message.tabName}"`
  return `Plotwork board ${board}: ${message.from}${where} wrote: ${cut} Act on it in your own revision, then reply_board_message board "${board}" inReplyTo "${message.id}".`
}

/**
 * Watches for this project's stream and holds it, printing a line a message, until the process ends.
 * @param {{ projectDir: string, print: (line: string) => void, now?: () => number, WebSocketImpl?: typeof WebSocket, streamDir?: string }} options
 */
export function watch(options) {
  let held = null
  let stream = null
  const look = () => {
    const found = readStream(options.projectDir, { now: (options.now ?? Date.now)(), ...(options.streamDir === undefined ? {} : { dir: options.streamDir }) })
    if (found === null) {
      stream?.stop()
      stream = null
      held = null
      return
    }
    if (held !== null && held.ticket === found.ticket) return
    stream?.stop()
    held = found
    const board = new URL(found.url).pathname.split('/')[2] ?? ''
    stream = new BoardStream({ url: found.url, ticket: found.ticket, expiresAt: found.expiresAt, onMessages: (messages) => messages.forEach((message) => options.print(lineOf(board, message))), WebSocketImpl: options.WebSocketImpl, now: options.now }).start()
  }
  look()
  const timer = setInterval(look, LOOK_MS)
  return () => {
    clearInterval(timer)
    stream?.stop()
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.env['PLOTWORK_LISTEN_MONITOR'] !== 'on') process.exit(0)
  watch({ projectDir: process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd(), print: (line) => process.stdout.write(`${line}\n`) })
}
