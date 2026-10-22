#!/usr/bin/env node
/**
 * The listen skill's state: which board this project's session listens to, so the optional Stop hook knows to check the board once more
 * before the session stops (`hook.mjs`, `PLOTWORK_LISTEN_STOP=on`).
 *
 *   node listen.mjs start <board> [tab]   remembers the board (and tab) for this project, for two hours at most
 *   node listen.mjs stop                  forgets it
 *   node listen.mjs status                prints what is remembered, or "not listening"
 *
 * The state is a small JSON file in the system's temporary folder, named by a hash of the project's folder, so nothing is written into
 * the repository. It holds the board's id, the tab's id, and two times: never a key, a token or a message.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** How long a listen session is remembered without a new `start`: a forgotten session never keeps a later one going. */
export const LISTEN_HOURS = 2

const ID = /^[0-9A-Za-z]+$/

/** The state file of one project folder. */
export function stateFile(projectDir, { dir = join(tmpdir(), 'plotwork-listen') } = {}) {
  const key = createHash('sha256').update(resolve(projectDir)).digest('hex').slice(0, 16)
  return join(dir, `${key}.json`)
}

/** A board id is 22 letters and digits, a tab id 12: anything else is refused before it is written. */
export function checkIds(board, tab) {
  if (typeof board !== 'string' || board.length !== 22 || !ID.test(board)) return 'The board id is 22 letters and digits, from the board\'s address or list_boards.'
  if (tab !== undefined && tab !== null && (typeof tab !== 'string' || tab.length !== 12 || !ID.test(tab))) return 'The tab id is 12 letters and digits, from open_board.'
  return null
}

/**
 * Remembers that this project listens to a board. Answers the state, or the reason it was refused.
 * @param {string} projectDir
 * @param {string} board
 * @param {string | null | undefined} tab
 * @param {{ now?: number, dir?: string }} [options]
 */
export function startListening(projectDir, board, tab, { now = Date.now(), dir } = {}) {
  const problem = checkIds(board, tab)
  if (problem !== null) return { ok: false, message: problem }
  const file = stateFile(projectDir, dir === undefined ? {} : { dir })
  const state = { board, tab: tab ?? null, startedAt: now, until: now + LISTEN_HOURS * 3_600_000 }
  mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 })
  writeFileSync(file, `${JSON.stringify(state)}\n`, { mode: 0o600 })
  return { ok: true, state }
}

/**
 * Forgets the board this project listens to.
 * @param {string} projectDir
 * @param {{ dir?: string }} [options]
 */
export function stopListening(projectDir, { dir } = {}) {
  rmSync(stateFile(projectDir, dir === undefined ? {} : { dir }), { force: true })
}

/**
 * The board this project listens to, or null: none, unreadable, or older than `LISTEN_HOURS` (which is then forgotten).
 * @param {string} projectDir
 * @param {{ now?: number, dir?: string }} [options]
 */
export function readListening(projectDir, { now = Date.now(), dir } = {}) {
  const file = stateFile(projectDir, dir === undefined ? {} : { dir })
  let state
  try {
    state = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
  if (typeof state !== 'object' || state === null || checkIds(state.board, state.tab) !== null || typeof state.until !== 'number') return null
  if (now >= state.until) {
    rmSync(file, { force: true })
    return null
  }
  return { board: state.board, tab: state.tab ?? null, startedAt: state.startedAt, until: state.until }
}

/**
 * What the Stop hook answers: when this project listens to a board and the session is not already continuing because of this hook, it
 * blocks the stop once with a reason that asks for one more `wait_for_board_messages`, so a message that came in while the agent worked
 * is answered. Hooks cannot call MCP tools and must not hold a key, so the check is the agent's own call. Undefined lets the stop go.
 * @param {{ hook_event_name?: string, stop_hook_active?: boolean } | undefined} event
 * @param {string} projectDir
 * @param {{ env?: Record<string, string | undefined>, now?: number, dir?: string }} [options]
 * @returns {{ decision: 'block', reason: string } | undefined}
 */
export function stopAnswer(event, projectDir, { env = process.env, now = Date.now(), dir } = {}) {
  if (env.PLOTWORK_LISTEN_STOP !== 'on') return undefined
  /* Already continuing because of this hook: the agent checked once, so the stop goes through. */
  if (event?.stop_hook_active === true) return undefined
  const listening = readListening(projectDir, dir === undefined ? { now } : { now, dir })
  if (listening === null) return undefined
  return {
    decision: 'block',
    reason: [
      `You are listening to the Plotwork board ${listening.board} (plotwork:listen).`,
      `Before stopping, call wait_for_board_messages once with board "${listening.board}" and timeoutSeconds 25.`,
      'For each message: do what it asks in your revision, then answer it with reply_board_message.',
      'If nothing came, or the person said to stop listening, stop now.',
    ].join(' '),
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, board, tab] = process.argv.slice(2)
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  if (command === 'start') {
    const started = startListening(projectDir, board, tab)
    if (!started.ok) {
      process.stderr.write(`${started.message}\n`)
      process.exitCode = 2
    } else process.stdout.write(`Listening to board ${board}${tab === undefined ? '' : `, tab ${tab}`}, until ${new Date(started.state.until).toISOString()}.\n`)
  } else if (command === 'stop') {
    stopListening(projectDir)
    process.stdout.write('Stopped listening.\n')
  } else if (command === 'status') {
    const state = readListening(projectDir)
    process.stdout.write(state === null ? 'Not listening.\n' : `Listening to board ${state.board}${state.tab === null ? '' : `, tab ${state.tab}`}, until ${new Date(state.until).toISOString()}.\n`)
  } else {
    process.stderr.write('Usage: node listen.mjs start <board> [tab] | stop | status\n')
    process.exitCode = 2
  }
}
