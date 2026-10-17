---
name: draw
description: Draw a Plotwork diagram and save it into the repository as an SVG the docs can show. Use when the person asks for a diagram, chart, architecture picture, flow, sequence, schema, or any other picture of a system, or asks to update an existing Plotwork SVG. Combines the Plotwork MCP tools (write and check the source) with the command line the plugin's hook runs (draw the SVG on disk).
---

# Draw a diagram into the repository

The MCP tools write and check the source. The command line draws the pictures on disk. The plugin's hook joins them: when you save a `.diagram` file or a Markdown page with a `diagram` fence, the hook runs the command line and the SVGs appear. You never pass an SVG through your answer.

## Steps

1. **Settings.** If the repository has `plotwork.config.json` or `.plotwork/config.json` at its root, read it and pass it as `settings` to every Plotwork tool that takes settings.
2. **Pick the start.**

   | The request | Call |
   |---|---|
   | A diagram from a file the person has (SQL, Prisma, OpenAPI, Terraform, Compose, Kubernetes, a workflow, CSV) | `import_source` with the file's text and format |
   | A common architecture (three-tier, serverless API, queue with workers) | `find_pattern`, then `draw_from_pattern` |
   | Unsure which kind fits | `suggest_diagram` with the request in plain words |
   | Anything else | `get_diagram_syntax` (once with no kind, once with the kind), then write the source |

3. **Check before saving.** Call `draw_diagram` with `svg: "never"`. Fix every error at its line and column and call again until it is valid. Read the outline to check the meaning matches the request.
4. **Save it where the docs live.** Pick the place by where the picture is used:

   | Where it is shown | What to write | What the hook does |
   |---|---|---|
   | Inside a Markdown page (README, docs page, ADR) | A ```` ```diagram ```` fence with the source, in the page | Runs `sync`: draws a light and a dark SVG into `assets/diagrams/` beside the page and writes the picture block under the fence |
   | A picture on its own, used by a site or several pages | The source in `<docs folder>/diagrams/<name>.diagram` | Runs `render`: writes `<name>.svg` beside it, with the source inside |

   Use the folder the repository already keeps its docs and images in (look for `docs/`, an existing `assets/diagrams/`, or the docs app's content folder). Name files after what they show, in kebab case.
5. **Read the hook's answer.** A blocked result lists each mistake with line, column and hint: fix them and save again. A success names the files written. After a `sync`, read the page again before your next edit, and never edit the lines between `diagram:start` and `diagram:end`.
6. **Link it.** For a `.diagram` file, reference the SVG from the pages that need it: `![What it shows](./diagrams/<name>.svg)`. A fence needs no link; its picture block is the link.
7. **Offer a look.** Tell the person they can run the `plotwork:preview` skill to see every picture on localhost, reloading as they change.

## Changing an existing picture

Call `read_diagram` with the SVG's text or hosted link to get its source back, change it with `edit_diagram` or by hand, check it with `draw_diagram` (`svg: "never"`), then save the `.diagram` file or the fence again. The hook redraws the SVG.

## When the hook is not running

The hook is off when `PLOTWORK_HOOKS=off` is set, or when the file is outside the project. Run the command line yourself with the wrapper beside this skill, from the project root:

```sh
node "<this skill's base directory>/../../scripts/plotwork.mjs" render docs/diagrams/checkout.diagram --out docs/diagrams/checkout.svg
node "<this skill's base directory>/../../scripts/plotwork.mjs" sync README.md "docs/**/*.md"
```

A drawing tool's answer can also carry a `saveCommand`. It writes the same SVG from the view link with no request; change its `--out` to the path you want and run it.

## Rules

- Choose node types and tones for meaning. Colours come from the theme and cannot be set.
- Never invent an icon. Use `map_icons` or `search_icons` and pick from the candidates.
- Publish a hosted link (`publish_diagram`) only when the person asks for one: anyone with the link can see it.
