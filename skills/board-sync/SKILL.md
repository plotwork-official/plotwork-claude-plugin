---
name: board-sync
description: Keep a .diagram file in this repository and a tab of a Plotwork live whiteboard in step with the command line's board pull and board push. Sends the file's changes, takes the board's, and explains a conflict instead of overwriting either side. Use when the person asks to sync, pull or push a diagram file with a board, or runs /plotwork:board-sync.
argument-hint: <file> [board] [tab]
---

<!-- Written by pnpm docs:build from tools/docs/board-skills-doc.ts. Do not edit. -->

# Keep a file and a board tab in step

The file is the first word of `$ARGUMENTS`; the board and the tab, when given, follow it. Run every command from the project root with the plugin's wrapper:

```sh
node "<this skill's base directory>/../../scripts/plotwork.mjs" board <command> --json
```

It needs `PLOTWORK_API_KEY` set to an organisation key with the `boards` scope. A trusted publisher, the keyless sign-in of the GitHub Action, never reaches a board. If the wrapper says `board` is not a command, the pinned release is older than the board commands: ask the person to set `PLOTWORK_CLI` to a newer one.

## Steps

1. **Find the pair.** If `<file>.board.json` exists beside the file, it names the board, the tab, the revision and the version the file was pulled at. Otherwise ask the person for the board and the tab, by id, address or name.
2. **First time.** With no sidecar and no file, run `board pull <board> <tab> -o <file>`. With a file that was never pulled, show the person how it differs from the tab (`board pull <board> <tab> -o -` prints the tab's source; `compare_diagrams` compares the two), and ask which side wins before you run `board pull --force` or `board push <board> <tab> <file> --force`.
3. **Send the file's changes.** Run `board push <file> --json`. `changed: false` means the file has not changed since it was pulled; a version means the tab now has the file's source.
4. **Take the board's changes.** When the push sent nothing, run `board pull <board> <tab> -o <file>`: the file had no changes of its own, so nothing is lost, and the command lists what changed on the board since.
5. **A conflict.** `diagram.version_conflict` means both sides changed. Its `details` give `changesSince` (who changed what on the board) and `difference.summary` (how the file differs from the tab now). Tell the person both. To keep both: save the file's text aside, `board pull <board> <tab> -o <file> --force`, write the file again with both sides' changes, check it with `validate`, and `board push <file>`. Use `board push <file> --force` only when the person says the file should replace the board's version; the tab's history keeps the old one.
6. **After a pull.** The plugin's hook draws a file Claude saves, not one the command line writes: run `sync` or `render` for the repository's pictures. Commit the file and its sidecar together only when the person asks; the sidecar records which board version the file matches.

Never run `--force` without the person's yes. For a meeting going on now, `/plotwork:board` works in a revision instead, and the person can run `plotwork board watch <board> <tab>` in a terminal to see each change as it lands.
