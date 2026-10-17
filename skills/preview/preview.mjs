#!/usr/bin/env node
/**
 * A gallery of a project's SVGs on localhost that reloads when a picture changes, so a person sees every diagram the agent
 * draws as soon as the hook writes it.
 *
 *   node preview.mjs [--root <folder>] [--port <number>]
 *
 * It listens on 127.0.0.1 only, serves `.svg` files under the root and nothing else, and shows each picture in an `<img>`, where
 * a script inside an SVG never runs. A light picture and its `.dark.svg` sit side by side. No dependencies; Node 22 or newer.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The first port tried; the next nine are tried in turn when it is taken. Outside the 3100s the Plotwork apps use. */
export const DEFAULT_PORT = 3900

/** Folders never searched: dependencies, history, and build output. */
const SKIPPED_FOLDERS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', '.turbo', '.wrangler'])

/** The most pictures listed, so a huge repository still answers at once. */
const MAX_PICTURES = 2_000

/** Every SVG under the root, as paths relative to it with forward slashes, with the time each last changed. */
export function findPictures(root) {
  const found = []
  const walk = (folder) => {
    let entries
    try {
      entries = readdirSync(folder, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (found.length >= MAX_PICTURES) return
      const path = join(folder, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name)) walk(path)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.svg')) {
        found.push({ path: relative(root, path).split(sep).join('/'), changed: statSync(path).mtimeMs })
      }
    }
  }
  walk(root)
  return found
}

/** The pictures paired for display: a light picture with its `.dark.svg`, and a dark picture whose light one is missing on its own. */
export function pairPictures(pictures) {
  const paths = new Set(pictures.map((picture) => picture.path))
  const pairs = []
  for (const { path } of pictures) {
    if (path.endsWith('.dark.svg')) {
      if (!paths.has(path.replace(/\.dark\.svg$/, '.svg'))) pairs.push({ light: undefined, dark: path })
      continue
    }
    const dark = path.replace(/\.svg$/i, '.dark.svg')
    pairs.push({ light: path, dark: paths.has(dark) ? dark : undefined })
  }
  return pairs
}

/** A short fingerprint of every picture's path and change time: the page reloads when it changes. */
export const versionOf = (pictures) => createHash('sha256').update(pictures.map((p) => `${p.path}:${p.changed}`).join('\n')).digest('hex').slice(0, 16)

const escapeHtml = (text) => text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)
const pictureUrl = (path) => `/svg/${path.split('/').map(encodeURIComponent).join('/')}`

/** The gallery page, grouped by folder. Every path is escaped; nothing is put into the page from a picture's content. */
export function galleryPage(root, pictures) {
  const groups = new Map()
  for (const pair of pairPictures(pictures)) {
    const path = pair.light ?? pair.dark
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.'
    groups.set(folder, [...(groups.get(folder) ?? []), pair])
  }
  const figure = (path, label) =>
    `<figure class="${label}"><a href="${pictureUrl(path)}" target="_blank" rel="noopener"><img src="${pictureUrl(path)}" alt="${escapeHtml(path)}" loading="lazy"></a><figcaption>${escapeHtml(path.split('/').pop())}</figcaption></figure>`
  const sections = [...groups]
    .map(([folder, pairs]) => `<section><h2>${escapeHtml(folder)}</h2><div class="grid">${pairs.map((pair) => `<div class="pair">${pair.light ? figure(pair.light, 'light') : ''}${pair.dark ? figure(pair.dark, 'dark') : ''}</div>`).join('')}</div></section>`)
    .join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plotwork preview</title>
<style>
:root { color-scheme: light dark; --bg: #f7f7f5; --card: #ffffff; --ink: #1c1c1a; --muted: #6b6b66; --line: #e3e3de; --dark-card: #16171a; }
@media (prefers-color-scheme: dark) { :root { --bg: #0f1012; --card: #1a1b1e; --ink: #ececea; --muted: #9a9a94; --line: #2a2b2f; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px 48px; background: var(--bg); color: var(--ink); font: 14px/1.5 system-ui, sans-serif; }
header { max-width: 1400px; margin: 0 auto 24px; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; }
h1 { font-size: 18px; margin: 0; }
header p { margin: 0; color: var(--muted); overflow-wrap: anywhere; }
section { max-width: 1400px; margin: 0 auto 32px; }
h2 { font-size: 13px; font-weight: 600; color: var(--muted); margin: 0 0 12px; overflow-wrap: anywhere; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr)); gap: 16px; }
.pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 8px; }
figure { margin: 0; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
figure.dark { background: var(--dark-card); }
figure img { width: 100%; height: auto; max-height: 480px; object-fit: contain; display: block; }
figcaption { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
figure.dark figcaption { color: #9a9a94; }
.empty { max-width: 1400px; margin: 0 auto; color: var(--muted); }
</style>
<script src="/reload.js" defer></script>
</head>
<body>
<header><h1>Plotwork preview</h1><p>${escapeHtml(root)} · ${pictures.length} SVG${pictures.length === 1 ? '' : 's'} · reloads when one changes</p></header>
${sections || '<p class="empty">No SVG files yet. Save a .diagram file or a Markdown page with a diagram fence and it appears here.</p>'}
</body>
</html>
`
}

/** Polls the fingerprint once a second and reloads the page when it changes. Served as a file, so the page's policy allows no inline script. */
const RELOAD_SCRIPT = `let version
async function poll() {
  try {
    const next = await (await fetch('/version', { cache: 'no-store' })).text()
    if (version !== undefined && next !== version) location.reload()
    version = next
  } catch {
    /* The server stopped or is restarting: keep polling, and the page reloads once it answers with a new fingerprint. */
  }
  setTimeout(poll, 1000)
}
poll()
`

const PAGE_POLICY = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'"
const PICTURE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"

/** The file a `/svg/...` request names, or undefined when it is not an SVG inside the root. */
export function pictureFile(root, requestPath) {
  let path
  try {
    path = decodeURIComponent(requestPath.slice('/svg/'.length))
  } catch {
    return undefined
  }
  const file = resolve(root, path)
  if (!file.startsWith(`${root}${sep}`) || !file.toLowerCase().endsWith('.svg')) return undefined
  if (file.split(sep).some((part) => SKIPPED_FOLDERS.has(part))) return undefined
  return file
}

export function createPreviewServer(root) {
  return createServer((request, response) => {
    const send = (status, type, body, policy = PAGE_POLICY) => {
      response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'content-security-policy': policy, 'x-content-type-options': 'nosniff' })
      response.end(body)
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return send(405, 'text/plain; charset=utf-8', 'Only GET.')
    const { pathname } = new URL(request.url ?? '/', 'http://localhost')
    if (pathname === '/') return send(200, 'text/html; charset=utf-8', galleryPage(root, findPictures(root)))
    if (pathname === '/version') return send(200, 'text/plain; charset=utf-8', versionOf(findPictures(root)))
    if (pathname === '/reload.js') return send(200, 'text/javascript; charset=utf-8', RELOAD_SCRIPT)
    if (pathname.startsWith('/svg/')) {
      const file = pictureFile(root, pathname)
      if (file === undefined) return send(404, 'text/plain; charset=utf-8', 'Not found.')
      try {
        return send(200, 'image/svg+xml', readFileSync(file), PICTURE_POLICY)
      } catch {
        return send(404, 'text/plain; charset=utf-8', 'Not found.')
      }
    }
    return send(404, 'text/plain; charset=utf-8', 'Not found.')
  })
}

/** `--root` and `--port` from the command line; anything else is a mistake. */
export function readOptions(argv, cwd = process.cwd()) {
  const options = { root: cwd, port: DEFAULT_PORT }
  for (let index = 0; index < argv.length; index += 1) {
    const [name, value] = [argv[index], argv[index + 1]]
    if (name === '--root' && value) options.root = resolve(cwd, value)
    else if (name === '--port' && value && /^\d+$/.test(value)) options.port = Number(value)
    else throw new Error(`Unknown option ${name}. Use --root <folder> and --port <number>.`)
    index += 1
  }
  return options
}

/** Listens on the first free port from `port`, trying ten in all. */
function listen(server, port, tries = 10) {
  return new Promise((done, fail) => {
    server.once('error', (error) => (error.code === 'EADDRINUSE' && tries > 1 ? listen(server, port + 1, tries - 1).then(done, fail) : fail(error)))
    server.listen(port, '127.0.0.1', () => done(port))
  })
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { root, port } = readOptions(process.argv.slice(2))
    if (!statSync(root).isDirectory()) throw new Error(`${root} is not a folder.`)
    const bound = await listen(createPreviewServer(root), port)
    process.stdout.write(`Plotwork preview of ${root} on http://127.0.0.1:${bound}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  }
}
