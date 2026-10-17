---
name: preview
description: Show every Plotwork SVG of the project in a gallery on localhost that reloads when a picture changes. Use when the person wants to see, look at, preview, or review the diagrams, or asks for a local page of the pictures.
---

# Preview the pictures on localhost

`preview.mjs` beside this skill serves a gallery of every `.svg` under a folder at `http://127.0.0.1:3900` (or the next free port). A light picture and its `.dark.svg` sit side by side, grouped by folder, and the page reloads within a second of the hook writing a picture. It listens on 127.0.0.1 only and serves nothing but SVG files. It needs Node 22 and nothing else.

## Steps

1. Start it in the background from the project root, so it keeps running while you work:

   ```sh
   node "<this skill's base directory>/preview.mjs" --root .
   ```

   Run it with `run_in_background`. Pass `--root docs` to show one folder, `--port <number>` to pick the port.
2. Read the first line it prints, `Plotwork preview of <folder> on http://127.0.0.1:<port>`, and give the person that address.
3. Keep working: each `.diagram` file or fence you save is drawn by the hook and shows up on the page.
4. Stop the server when the person is done or asks, and only the one you started.

## When nothing shows

| What you see | Why | Do this |
|---|---|---|
| "No SVG files yet" | Nothing has been drawn under the root | Save a `.diagram` file or a page with a fence, or sync the pages (`plotwork:document`) |
| A picture is missing | It is under `node_modules`, `.git`, or a build folder, which are never searched | Save it elsewhere |
| A picture is stale | The hook could not run the command line | Read the hook's note, or run the `sync` or `render` command yourself |
