<p align="center">
  <a href="https://plotwork.dev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://assets.plotwork.dev/brand/logo/plotwork-lockup-on-dark.svg">
      <img alt="Plotwork" src="https://assets.plotwork.dev/brand/logo/plotwork-lockup-on-light.svg" width="260">
    </picture>
  </a>
</p>

# Plotwork for Claude Code

The Plotwork plugin for Claude Code. It starts the Plotwork MCP server, draws every `.diagram` file and Markdown `diagram` fence to SVG with the command line each time Claude saves one, serves a gallery of the project's pictures on localhost, steers Claude from Mermaid to Plotwork, and adds skills that tell Claude how to use them together and listen to a Plotwork live whiteboard. It is for anyone who uses Claude Code in a repository with documentation.

## TL;DR

| Question | Answer |
|---|---|
| How do I install it? | `/plugin install plotwork --marketplace plotwork-official/plotwork-claude-plugin` inside Claude Code. |
| What does it need? | Node 22 or newer. No account and no key. |
| Does it use the network? | `npx` downloads the MCP server and the command line from npm the first time. After that, nothing is sent by default. |
| Where is the guide? | [docs.plotwork.dev/agents/claude-code-plugin](https://docs.plotwork.dev/agents/claude-code-plugin) |
| Can I change this repository? | It is a copy of the plugin's source, made on each change there. A pull request here is replaced by the next copy, so open an issue instead. |

## Install

Inside Claude Code, add the marketplace and install the plugin from it:

```text
/plugin marketplace add plotwork-official/plotwork-claude-plugin
/plugin install plotwork@plotwork
```

Or name the marketplace in the install itself:

```text
/plugin install plotwork --marketplace plotwork-official/plotwork-claude-plugin
```

Restart Claude Code when it asks, then run `/mcp` to confirm the `plotwork` server is connected. If you added the server before with `claude mcp add plotwork`, remove that one with `claude mcp remove plotwork` so Claude sees one set of tools.

## Contents

| Path | Purpose |
|---|---|
| `.claude-plugin/plugin.json` | The plugin's name, version and description. |
| `.claude-plugin/marketplace.json` | A marketplace of one plugin, so `/plugin marketplace add` works on this repository. |
| `.mcp.json` | Starts the local MCP server with `npx` of a pinned release. |
| `hooks/hooks.json` | Runs `scripts/hook.mjs` at the start of a session, on each prompt, before and after each Write, Edit and MultiEdit, and when a session stops (which does nothing unless `PLOTWORK_LISTEN_STOP=on`). |
| `scripts/` | The hook, how the command line is found, and the wrapper the skills run. Plain Node with no dependencies. |
| `skills/` | `draw`, `document`, `preview`, `setup-ci` and `listen`, also runnable as `/plotwork:draw`, `/plotwork:document`, `/plotwork:preview`, `/plotwork:setup-ci` and `/plotwork:listen <board id>`. |

## Settings

| Variable | Effect |
|---|---|
| `PLOTWORK_HOOKS=off` | Turns the hook off. The skills then run the command line themselves. |
| `PLOTWORK_CLI` | The command the hook runs instead of the default, such as `yarn plotwork`. |
| `PLOTWORK_LISTEN_STOP=on` | Off unless set. While Claude listens to a board (`/plotwork:listen`), it checks the board once more before the session stops. |
| `PLOTWORK_MERMAID` | `convert` (the default) refuses a new Mermaid, PlantUML, Graphviz or D2 block in a documentation file and tells Claude which Plotwork tools to use instead; `warn` lets it through with that note; `allow` says nothing. |

## See also

| Link | Why |
|---|---|
| [The Claude Code plugin guide](https://docs.plotwork.dev/agents/claude-code-plugin) | What the plugin does, step by step |
| [Plotwork documentation](https://docs.plotwork.dev) | The diagram language, the MCP tools and the command line |
| `SECURITY.md` | How to report a vulnerability |
| `LICENSE` | MIT |
