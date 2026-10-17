#!/usr/bin/env node
/**
 * The plugin's one hook. Claude Code runs it at the start of a session and after every Write, Edit and MultiEdit, with the event
 * as JSON on standard input.
 *
 * - SessionStart: tells the agent what the hook does and whether the project has a settings file to pass to the tools.
 * - PostToolUse on a `.diagram` file: draws the SVG beside it with the command line.
 * - PostToolUse on a Markdown file with a `diagram` fence: runs `sync`, which draws the light and dark SVGs into
 *   `assets/diagrams` beside the page and writes the picture block under the fence.
 *
 * A mistake in a diagram comes back as a blocking result with its line, column and hint, so the agent fixes it in the same turn.
 * When the command line cannot run at all (no network for the first `npx` download, a timeout), the agent is told and nothing is
 * blocked. `PLOTWORK_HOOKS=off` turns the hook off.
 *
 * `PLOTWORK_PUBLISH=library` (off by default) also saves the file's diagrams to an organisation's private library after a drawing that
 * worked, with `plotwork publish --org`, the key in `PLOTWORK_API_KEY`, and the organisation in `PLOTWORK_ORG` or the settings file's
 * `brand.organization`. It always names the organisation, so a diagram can never land at a public link by this route. The link, or why
 * nothing was saved, is added to the hook's note; a failed save never blocks.
 */
import { existsSync, readFileSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CLI_RELEASE, resolveCli, runCli } from './cli.mjs'

/** The settings files the command line and the tools read, in the order they look for them. */
export const SETTINGS_FILES = ['plotwork.config.json', join('.plotwork', 'config.json')]

/** Folders whose files are never drawn: dependencies, history, and build output. */
const SKIPPED_FOLDERS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out'])

/** A fence the engine reads: three backticks or tildes, then `diagram`. */
const DIAGRAM_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*diagram\b/m

/** The longest output put in front of the agent; the start of a long list of mistakes is enough to act on. */
const MAX_OUTPUT = 4_000

/**
 * What to do with a file the agent just wrote: draw a `.diagram` file to the SVG beside it, sync a Markdown page that has a
 * diagram fence, or nothing. `path` is relative to the project, so the command line prints readable file names.
 */
export function planFor(path, text) {
  if (path.split(/[\\/]/).some((part) => SKIPPED_FOLDERS.has(part))) return null
  const extension = extname(path).toLowerCase()
  if (extension === '.diagram') {
    const svg = `${path.slice(0, -extension.length)}.svg`
    return { action: 'render', args: ['render', path, '--out', svg], wrote: [svg] }
  }
  if (/^\.(md|markdown|mdx)$/.test(extension) && DIAGRAM_FENCE.test(text)) {
    return { action: 'sync', args: ['sync', path], wrote: [] }
  }
  return null
}

const trim = (text) => (text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n(output cut at ${MAX_OUTPUT} characters)` : text).trim()

/**
 * The hook's answer for one run of the command line. Exit 0 adds a note for the agent, exit 1 (a mistake in a diagram) blocks
 * with the mistakes, and anything else (a usage mistake, a command that never started) adds a note and blocks nothing.
 */
export function answerFor(plan, result) {
  const output = trim(`${result.stdout}\n${result.stderr}`)
  if (result.status === 0) {
    const what = plan.action === 'render' ? `Plotwork drew ${plan.wrote.join(', ')}.` : 'Plotwork synced the diagram pictures of this page and wrote the picture blocks into it, so read the page again before the next edit. Never edit between diagram:start and diagram:end by hand.'
    return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: [what, output].filter(Boolean).join('\n') } }
  }
  if (result.status === 1) {
    return {
      decision: 'block',
      reason: `Plotwork could not draw the diagram, so no picture was written. Fix each mistake at its line and column, then save the file again.\n${output}`,
    }
  }
  const why = result.status === null ? result.error ?? 'it did not start' : `exit ${result.status}`
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `The Plotwork hook could not run \`${result.command}\` (${why}), so no picture was drawn. Run it yourself to see why.\n${output}`.trim(),
    },
  }
}

/** The organisation the hook saves to: `PLOTWORK_ORG`, else the `brand.organization` of the project's settings file, else undefined. */
export function libraryOf(projectDir, { env = process.env, exists = existsSync, read = (path) => readFileSync(path, 'utf8') } = {}) {
  const named = env.PLOTWORK_ORG?.trim()
  if (named) return named
  const settings = SETTINGS_FILES.find((name) => exists(join(projectDir, name)))
  if (settings === undefined) return undefined
  try {
    const organization = JSON.parse(read(join(projectDir, settings)))?.brand?.organization
    return typeof organization === 'string' && organization.trim() !== '' ? organization.trim() : undefined
  } catch {
    return undefined
  }
}

/**
 * The sentence for the agent after a save to the library: the links the command line printed, or why nothing was saved. `org` is
 * undefined when no organisation was found, and then nothing was run.
 */
export function libraryNote(org, result) {
  if (org === undefined) return 'PLOTWORK_PUBLISH=library is set, but no organisation is named: set PLOTWORK_ORG, or brand.organization in plotwork.config.json. Nothing was saved to a library.'
  const output = trim(`${result.stdout}\n${result.stderr}`)
  if (result.status === 0) return `Plotwork saved the diagrams to the private library of ${org}. Give the person the link:\n${output}`
  return `Plotwork could not save the diagrams to the private library of ${org}, so they are only in this repository.\n${output}`.trim()
}

/** The note at the start of a session: what happens on save, which command line runs, and the settings file if there is one. */
export function sessionNote(projectDir, { env = process.env, exists = existsSync } = {}) {
  const cli = resolveCli({ env, projectDir, exists })
  const runs = cli.source === 'npx' ? `\`npx ${CLI_RELEASE.packageName}@${CLI_RELEASE.version}\`` : `\`${[cli.program, ...cli.args].join(' ')}\``
  const settings = SETTINGS_FILES.find((name) => exists(join(projectDir, name)))
  return [
    'The Plotwork plugin is on. After you write or edit a `.diagram` file, its SVG is drawn beside it; after you write or edit a Markdown file with a ```diagram fence, its pictures are synced into assets/diagrams and the picture block is written under the fence.',
    `Mistakes come back as a blocked result with line, column and hint: fix them and save again. The command line is ${runs}.`,
    settings ? `This project has ${settings}: read it and pass it as \`settings\` to every Plotwork tool that takes settings.` : undefined,
    'Use the plotwork:draw, plotwork:document and plotwork:preview skills for the full workflow.',
  ]
    .filter(Boolean)
    .join(' ')
}

/** The file a Write, Edit or MultiEdit touched, relative to the project, or undefined when it is outside the project. */
export function touchedFile(event, projectDir) {
  const filePath = event?.tool_input?.file_path
  if (typeof filePath !== 'string' || filePath === '') return undefined
  const absolute = isAbsolute(filePath) ? filePath : resolve(projectDir, filePath)
  const path = relative(projectDir, absolute)
  return path === '' || path.startsWith(`..${sep}`) || path === '..' || isAbsolute(path) ? undefined : path
}

/** Runs one event and returns the JSON to print, or undefined when the hook has nothing to say. */
export function handle(event, { env = process.env, run = runCli } = {}) {
  if (env.PLOTWORK_HOOKS === 'off') return undefined
  const projectDir = env.CLAUDE_PROJECT_DIR || event?.cwd || process.cwd()
  if (event?.hook_event_name === 'SessionStart') {
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: sessionNote(projectDir, { env }) } }
  }
  if (event?.hook_event_name !== 'PostToolUse') return undefined
  const path = touchedFile(event, projectDir)
  if (path === undefined || !existsSync(join(projectDir, path))) return undefined
  const plan = planFor(path, readFileSync(join(projectDir, path), 'utf8'))
  if (plan === null) return undefined
  const result = run(plan.args, { projectDir, env })
  const answer = answerFor(plan, result)
  if (env.PLOTWORK_PUBLISH !== 'library' || result.status !== 0 || answer.hookSpecificOutput === undefined) return answer
  /* The drawing worked: save the file's diagrams to the named library too, and say where, in the same note. */
  if (!env.PLOTWORK_API_KEY) {
    answer.hookSpecificOutput.additionalContext += '\nPLOTWORK_PUBLISH=library is set, but PLOTWORK_API_KEY is not: nothing was saved to a library.'
    return answer
  }
  const org = libraryOf(projectDir, { env })
  const saved = org === undefined ? undefined : run(['publish', path, '--org', org], { projectDir, env })
  answer.hookSpecificOutput.additionalContext += `\n${libraryNote(org, saved)}`
  return answer
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const answer = handle(JSON.parse(await readStdin()))
    if (answer !== undefined) process.stdout.write(`${JSON.stringify(answer)}\n`)
  } catch (error) {
    /* A broken hook must never stop the agent's work: report on stderr, which Claude Code shows only in verbose mode. */
    process.stderr.write(`Plotwork hook: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}
