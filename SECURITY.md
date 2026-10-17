# Security policy

How to report a vulnerability in the Plotwork plugin for Claude Code, and what to expect. It is for anyone who finds a security problem in the plugin this repository holds.

## TL;DR

| Question | Answer |
|---|---|
| Where do I report? | Use "Report a vulnerability" on the Security tab of this repository. That report is private. |
| Is there an email address? | No. The private report above is the only channel, so every report stays private until a fix is out. |
| Which versions get fixes? | The latest commit on `main`. |
| Should I open a public issue? | No. Public issues are for bugs that are not security problems. |

## What the plugin does

The plugin is plain Node scripts with no dependencies. Its hook runs the Plotwork command line on a `.diagram` file or Markdown page Claude saves, its MCP config starts the published MCP server with `npx`, and its gallery serves `.svg` files on 127.0.0.1. It counts nothing and sends nothing; the only requests are the `npx` downloads of the published packages. A report is most useful when it shows one of the following:

- the hook or the gallery reading or writing a file outside the project, or running a command other than the command line
- the gallery answering from another machine, or serving a file that is not an SVG
- a file name or diagram that makes a script misbehave or exhaust memory
- a secret or a path of a build machine inside this repository

## What to include

Give the commit of this repository, your Node and Claude Code versions, the smallest input that shows the problem, and what you expected instead.

## What happens next

The maintainers acknowledge a report, confirm the problem, and push a fix to `main`.

## See also

| Link | Why |
|---|---|
| `README.md` | What the plugin is and how to install it |
| [Documentation](https://docs.plotwork.dev) | The commands and the diagram language |
