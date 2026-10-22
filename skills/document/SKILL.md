---
name: document
description: Illustrate documentation with Plotwork diagrams, keep their pictures in step, and convert Mermaid. Use when the person asks to add diagrams to a README or docs folder, to illustrate a design doc or ADR, to refresh stale diagram pictures, to move Mermaid blocks to Plotwork, or to check diagrams in CI.
---

# Illustrate documentation

Pictures in docs live as ```` ```diagram ```` fences in the Markdown. The command line's `sync` draws each fence to an SVG in `assets/diagrams/` beside the page and writes a picture block under the fence, so the diagram shows on GitHub, GitLab and any Markdown site. It is one SVG that follows the reader's light or dark setting, or a light and a dark SVG with `"defaults": { "scheme": "light-and-dark" }` in `plotwork.config.json`. The plugin's hook runs `sync` every time you save a page that has a fence.

## Add diagrams to a document

1. If the repository has `plotwork.config.json` or `.plotwork/config.json`, read it and pass it as `settings` to the tools.
2. Call `plan_document_diagrams` with the page's text. It returns the sections a picture would help, each with a starter that parses.
3. For each section worth a picture, finish the starter (follow the `plotwork:draw` skill for picking the kind and checking with `draw_diagram`, `svg: "never"`).
4. Put each diagram in the page as a fence right after the paragraph it explains, with a sentence before it that says what it shows.
5. Save the page. The hook syncs it. Read its answer: fix any mistake it lists and save again; on success, read the page again before the next edit.

## Refresh many pages

From the project root, sync every page at once with the wrapper beside this skill:

```sh
node "<this skill's base directory>/../../scripts/plotwork.mjs" sync README.md "docs/**/*.md"
```

Quote globs: the command line expands them itself and never looks in `node_modules`, `.git` or build output. `--assets <dir>` changes the picture folder, relative to each page.

## Convert Mermaid

For one page, call `sync_markdown` with the page, its path, and `convertMermaid: true`; write the Markdown and files it returns, read every diagnostic and its hint, then choose node types and icons where it left them plain. For one block, call `convert_mermaid`. The command line's `import` converts a Mermaid file with no agent at all.

Never write a new Mermaid, PlantUML, Graphviz or D2 block into a document: the plugin refuses it and says which tool to call. Editing next to a block that is already there is fine.

## Keep the pictures honest in CI

Suggest a check that fails a pull request when a picture is stale:

```sh
npx -y @buun_group/plotwork@<version> sync --check "docs/**/*.md"
```

On GitHub the Plotwork Action does the same with an annotation on each stale fence. Use the version in `scripts/cli-release.json` beside the plugin, so CI draws what the hook draws.

## Rules

- Never edit between `diagram:start` and `diagram:end`; the next sync rewrites it.
- One idea per diagram. Split a picture that needs a paragraph to explain.
- Commit the SVGs with the page: the picture block points at them.
