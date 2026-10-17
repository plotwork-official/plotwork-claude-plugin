#!/usr/bin/env node
/**
 * The command line for the skills: `node <plugin>/scripts/plotwork.mjs <command> [options]` runs the same command line the hook
 * runs (see `cli.mjs`), with its output and exit code passed through.
 *
 *   node scripts/plotwork.mjs sync "docs/**\/*.md"
 *   node scripts/plotwork.mjs render docs/diagrams/checkout.diagram --out docs/diagrams/checkout.svg
 */
import { runCli } from './cli.mjs'

const result = runCli(process.argv.slice(2), { projectDir: process.env.CLAUDE_PROJECT_DIR ?? process.cwd() })
process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
if (result.status === null) {
  process.stderr.write(`Could not run ${result.command}: ${result.error ?? 'no exit code'}\n`)
  process.exit(2)
}
process.exit(result.status)
