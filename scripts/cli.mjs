/**
 * How the plugin runs the Plotwork command line: the command named in `PLOTWORK_CLI`, else the `plotwork` a project installed in
 * its `node_modules`, else the pinned release through `npx`. The hook and the skills' wrapper both resolve it here, so the
 * picture a hook draws is the picture the person gets when they run the command themselves.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The release `npx` runs. `pnpm docs:build` writes the file from `CLI_RELEASE`, so it moves with every other pinned command. */
export const CLI_RELEASE = readRelease(join(dirname(fileURLToPath(import.meta.url)), 'cli-release.json'))

/** The plugin ships with no dependencies, so the file's shape is checked by hand rather than with a schema library. */
function readRelease(path) {
  const release = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof release?.packageName !== 'string' || typeof release?.version !== 'string') {
    throw new Error(`${path} must hold { "packageName": string, "version": string }.`)
  }
  return { packageName: release.packageName, version: release.version }
}

/** Long enough for `npx` to download the release the first time, short enough to stay under the hook's own timeout. */
export const CLI_TIMEOUT_MS = 110_000

/**
 * The program and leading arguments that run the command line for a project. `PLOTWORK_CLI` is split on spaces, so a value
 * such as `pnpm diagram` works; a path with a space in it does not.
 */
export function resolveCli({ env = process.env, projectDir = process.cwd(), platform = process.platform, exists = existsSync } = {}) {
  const override = env.PLOTWORK_CLI?.trim()
  if (override) {
    const [program, ...args] = override.split(/\s+/)
    return { program, args, source: 'PLOTWORK_CLI' }
  }
  const binary = platform === 'win32' ? 'plotwork.cmd' : 'plotwork'
  for (let folder = projectDir; ; folder = dirname(folder)) {
    const local = join(folder, 'node_modules', '.bin', binary)
    if (exists(local)) return { program: local, args: [], source: 'node_modules' }
    if (folder === parse(folder).root) break
  }
  return { program: platform === 'win32' ? 'npx.cmd' : 'npx', args: ['-y', `${CLI_RELEASE.packageName}@${CLI_RELEASE.version}`], source: 'npx' }
}

/** One argument quoted for cmd.exe, which runs a `.cmd` file only through a shell. */
const quoteForCmd = (value) => (/^[\w./:@=-]+$/.test(value) ? value : `"${value.replaceAll('"', '""')}"`)

/**
 * Runs one command of the command line and returns its exit code and output. A command that could not start at all (no Node,
 * no network for the first `npx` download, a timeout) comes back with `status` null and the reason in `error`, never thrown.
 */
export function runCli(args, { projectDir = process.cwd(), env = process.env, platform = process.platform, timeout = CLI_TIMEOUT_MS } = {}) {
  const cli = resolveCli({ env, projectDir, platform })
  const all = [...cli.args, ...args]
  const shell = platform === 'win32'
  const result = spawnSync(cli.program, shell ? all.map(quoteForCmd) : all, { cwd: projectDir, env, encoding: 'utf8', timeout, shell })
  return {
    status: result.status,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    error: result.error ? result.error.message : undefined,
    command: [cli.program, ...all].join(' '),
  }
}
