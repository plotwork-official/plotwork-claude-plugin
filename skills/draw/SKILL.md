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
   | Inside a Markdown page (README, docs page, ADR) | A ```` ```diagram ```` fence with the source, in the page | Runs `sync`: draws the SVG into `assets/diagrams/` beside the page (one that follows the reader's setting, or a light and a dark one with `"scheme": "light-and-dark"`) and writes the picture block under the fence |
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

## Make it look finished

Label each arrow with a verb ("reads", "writes orders", "publishes OrderPlaced", "replicates", "pushes image", "deploys to"): the label draws that relationship's icon, and an arrow into or out of a queue labelled with a message name draws send or receive. Add `role=data`, `role=async`, `role=identity` or `role=private` to the lines that carry stored data, messages nobody waits for, sign-in, or private traffic, so they take a colour and a legend entry; warning `W500` lists the ones to mark. Give every group a `type=` (a group named "VPC", "Production" or "Kafka" gets one by itself), and name nodes after their product ("Postgres", "Redis") so they draw its mark, or after the common part they are ("Load balancer", "Circuit breaker", "Read replica", "Customers") so they draw its icon, with no icon= to write. `get_diagram_syntax` with topic `icon-words` lists every word that draws an icon.

## Rules

- Choose node types and tones for meaning. Colours come from the colour theme, `theme=<name>` on the header (plotwork, slate, ocean, forest, sunset, mono, contrast), and cannot be set one by one.
- Fit the picture to where it goes: on a flow header `spacing=compact` packs the boxes for a dense page and `spacing=roomy` spreads them for a slide. A repository sets it once with `"defaults": { "spacing": "compact" }` in `plotwork.config.json`. The drawing answer's `quality.hints` name the option to change when the picture is cramped, sparse or tangled; apply them before you show it.
- Never invent an icon. Use `map_icons` or `search_icons` and pick from the candidates.
- Publish a hosted link (`publish_diagram`) only when the person asks for one: anyone with the link can see it. When `import_source` split a file into `parts` and the person asks to publish them, publish every part with `series` set to the answer's `series.id`, the part's `index` (the overview is 1) and the total, so they stay together as tabs of one diagram.
