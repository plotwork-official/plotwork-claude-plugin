/**
 * Steers the agent from other diagram languages to Plotwork. Two parts, both run by `hook.mjs`:
 *
 * - PreToolUse on Write, Edit, MultiEdit and NotebookEdit: a documentation file that gains a Mermaid, PlantUML, Graphviz or D2
 *   diagram is refused, with a reason that names the Plotwork tools to use instead. Only new diagrams count: an edit whose old text
 *   already held the block, or a rewrite of a page that already had as many, goes through, so working near an existing diagram is
 *   never blocked.
 * - UserPromptSubmit: a prompt that asks for a diagram gets two sentences of guidance. Any other prompt gets nothing.
 *
 * `PLOTWORK_MERMAID` picks the mode: `convert` (the default) refuses the write, `warn` lets it through with a note, `allow` says
 * nothing. A repository sets it in the `env` of its `.claude/settings.json`, not in `plotwork.config.json`: that file is checked
 * strictly by every released command line, Action and MCP server, which would refuse a key they do not know.
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'

/** The modes `PLOTWORK_MERMAID` takes. Anything else is the default. */
export const MERMAID_MODES = ['convert', 'warn', 'allow']

/** The fence languages Plotwork draws better, each with the Plotwork route that fits. */
export const FOREIGN_LANGUAGES = ['mermaid', 'plantuml', 'puml', 'dot', 'graphviz', 'd2']

/** The files the guard reads: documentation, where a fence is drawn. In code a fence is only a string, and is left alone. */
export const DOC_EXTENSIONS = ['.md', '.mdx', '.markdown', '.rst', '.txt', '.ipynb']

/** Documentation files that often have no extension. */
const DOC_NAMES = /^(readme|changelog|contributing|architecture|design)$/i

/** Folders whose files are data or someone else's: dependencies, history, build output and test fixtures. */
export const GUARD_SKIPPED_FOLDERS = ['node_modules', '.git', 'dist', 'build', 'out', '.next', 'vendor', 'fixtures', '__fixtures__', '__tests__', 'testdata', 'test-data', '__snapshots__']

/** The tools' names as Claude Code shows them for the plugin's `plotwork` server. */
export const TOOL_PREFIX = 'mcp__plugin_plotwork_plotwork__'

const languages = FOREIGN_LANGUAGES.join('|')
/** A Markdown fence, a Sphinx directive, or an HTML block that a page renders as one of the languages. */
const BLOCK = new RegExp(
  [
    String.raw`^ {0,3}(?:\`{3,}|~{3,})[ \t]*\{?[ \t]*\.?(${languages})\b`,
    String.raw`^[ \t]*\.\.[ \t]+(mermaid|graphviz|uml|digraph|graph)::`,
    String.raw`<(?:div|pre)\b[^>]*\bclass[ \t]*=[ \t]*["'][^"']*\b(mermaid)\b`,
  ].join('|'),
  'gim',
)

/** The languages of the diagram blocks in a text, in order: `mermaid`, `dot` and so on. */
export function diagramBlocks(text) {
  if (typeof text !== 'string' || text === '') return []
  return [...text.matchAll(BLOCK)].map((match) => {
    const name = (match[1] ?? match[2] ?? match[3] ?? '').toLowerCase()
    return name === 'uml' ? 'plantuml' : name === 'digraph' || name === 'graph' ? 'graphviz' : name
  })
}

/** True for a documentation file the guard reads, by its path; false for code, data and skipped folders. */
export function isDocFile(path) {
  if (typeof path !== 'string' || path === '') return false
  const parts = path.split(/[\\/]/)
  if (parts.slice(0, -1).some((part) => GUARD_SKIPPED_FOLDERS.includes(part))) return false
  const extension = extname(path).toLowerCase()
  return DOC_EXTENSIONS.includes(extension) || (extension === '' && DOC_NAMES.test(basename(path)))
}

/** The languages that one text adds over another, counting each language: two Mermaid blocks where there was one adds one. */
function added(before, after) {
  const left = diagramBlocks(before)
  const found = []
  for (const language of diagramBlocks(after)) {
    const at = left.indexOf(language)
    if (at === -1) found.push(language)
    else left.splice(at, 1)
  }
  return found
}

/** The text of a notebook cell, which Jupyter keeps as a string or a list of lines. */
const cellText = (cell) => (Array.isArray(cell?.source) ? cell.source.join('') : typeof cell?.source === 'string' ? cell.source : '')

/** The cell a NotebookEdit replaces, read from the notebook on disk, or undefined. */
function notebookCell(path, cellId, read) {
  try {
    return JSON.parse(read(path))?.cells?.find((cell) => cell?.id === cellId)
  } catch {
    return undefined
  }
}

/**
 * The diagram languages a Write, Edit, MultiEdit or NotebookEdit adds to a documentation file, or an empty list. `absolute` is
 * the file on disk, read to compare a Write with the page it replaces.
 */
export function addedBlocks(event, absolute, { exists = existsSync, read = (path) => readFileSync(path, 'utf8') } = {}) {
  const input = event?.tool_input ?? {}
  const before = () => {
    try {
      return absolute !== undefined && exists(absolute) ? read(absolute) : ''
    } catch {
      return ''
    }
  }
  switch (event?.tool_name) {
    case 'Write':
      return added(before(), input.content)
    case 'Edit':
      return added(input.old_string, input.new_string)
    case 'MultiEdit':
      return (Array.isArray(input.edits) ? input.edits : []).flatMap((edit) => added(edit?.old_string, edit?.new_string))
    case 'NotebookEdit': {
      if (input.edit_mode === 'delete') return []
      const cell = input.edit_mode === 'insert' || absolute === undefined ? undefined : notebookCell(absolute, input.cell_id, read)
      const type = input.cell_type ?? cell?.cell_type
      return type === 'markdown' ? added(cellText(cell), input.new_source) : []
    }
    default:
      return []
  }
}

/** The mode from the environment: `convert`, `warn` or `allow`. */
export function mermaidMode(env = process.env) {
  const mode = env.PLOTWORK_MERMAID?.trim().toLowerCase()
  return MERMAID_MODES.includes(mode) ? mode : 'convert'
}

/** What the agent is told to do instead, for the languages it was about to write. */
export function insteadOf(found) {
  const names = [...new Set(found)]
  const tool = (name) => `${TOOL_PREFIX}${name}`
  return [
    `This page is drawn with Plotwork, so write a \`\`\`diagram fence in Plotwork's language instead of ${names.join(', ')}.`,
    `Call ${tool('get_diagram_syntax')} once if you have not read the language, check the source with ${tool('draw_diagram')} (svg "never"), and the plugin syncs the fence into a picture when you save.`,
    names.includes('mermaid')
      ? `To keep this Mermaid, call ${tool('convert_mermaid')} with it and write the Plotwork source it returns; for a whole page of Mermaid, call ${tool('sync_markdown')} with convertMermaid true.`
      : undefined,
    `If the person asked for ${names.join(', ')} by name, tell them the Plotwork plugin refused it and that PLOTWORK_MERMAID=allow lets it through.`,
  ]
    .filter(Boolean)
    .join(' ')
}

/** The PreToolUse answer for a write that adds diagrams in another language, by mode, or undefined to say nothing. */
export function guardAnswer(found, mode) {
  if (found.length === 0 || mode === 'allow') return undefined
  const reason = insteadOf(found)
  if (mode === 'warn') return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', additionalContext: reason } }
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }
}

/** Words that mean the person wants a picture. Whole words only, so "diagrammatic" or "dotted" never match. */
export const DIAGRAM_WORDS = [
  'diagram',
  'diagrams',
  'flowchart',
  'flowcharts',
  'flow chart',
  'flow charts',
  'sequence diagram',
  'architecture diagram',
  'erd',
  'entity relationship',
  'entity-relationship',
  'mermaid',
  'mind map',
  'mindmap',
  'gantt',
  'state machine',
  'c4',
  'swimlane',
  'swim lane',
  'org chart',
  'plantuml',
  'graphviz',
]

const WORDS = new RegExp(`(?<![\\w-])(?:${DIAGRAM_WORDS.map((word) => word.replace(/[-\s]/g, '[-\\s]')).join('|')})(?![\\w-])`, 'i')

/** True when the prompt asks for a diagram. */
export const asksForDiagram = (prompt) => typeof prompt === 'string' && WORDS.test(prompt)

/** The note a diagram prompt gets: two sentences, or one when the person allows other languages. */
export function promptNote(mode) {
  const draw = 'Draw diagrams with the Plotwork MCP tools: suggest_diagram if unsure of the kind, then draw_diagram, and in documents a ```diagram fence that the plugin syncs on save (or sync_markdown).'
  return mode === 'allow' ? draw : `${draw} Do not write Mermaid, PlantUML, Graphviz or D2.`
}

/** The sentence the session note carries, once, or undefined when the person allows other languages. */
export function sessionGuidance(mode) {
  if (mode === 'allow') return undefined
  const rest = mode === 'warn' ? '.' : ': a new block of one of those in a documentation file is refused, with what to do instead.'
  return `Draw every diagram with the Plotwork tools, never Mermaid, PlantUML, Graphviz or D2${rest}`
}
