---
name: setup-ci
description: Set up Plotwork diagrams and the drift check in this repository. Draws the diagrams from the repository's own files (Terraform, OpenAPI, Compose, Kubernetes, SQL, schemas), adds the GitHub Action that checks them on every pull request and reports to a Plotwork organisation's Drift tab, and opens a pull request. Use when the person asks to add Plotwork to CI, set up the drift check, or keep diagrams in step with the code. Pass the organisation's address name as the argument, such as acme.
---

<!-- Written by pnpm docs:build from packages/diagrams/src/constants/ci-setup.ts. Do not edit. -->

# Set up the drift check

The Plotwork organisation the repository reports to is `$ARGUMENTS`. If that is empty, ask the person which organisation, by its address name.

The plugin's MCP tools help along the way: `import_source` shows what a file draws before you name it as a source, and `draw_diagram` with `svg: "never"` checks a diagram you edit.

## Steps

1. **Look before you write.** Find the files Plotwork draws from: Terraform, OpenAPI documents, Compose files, Kubernetes manifests, SQL, Prisma or Drizzle schemas, GitHub Actions workflows and CSV data. Skip installed dependencies, build output and any file that holds secrets, such as `.env`. If `plotwork.config.json` or `.plotwork/config.json` already exists, add to it instead of replacing it.
2. **Name the sources.** Write `plotwork.config.json` at the repository root with `"$schema": "https://docs.plotwork.dev/schemas/plotwork.config.json"`, `"defaults": { "scheme": "auto" }`, and one entry in `sources` for each diagram: `name`, `from` (a path or a glob), `format`, and `out` (`docs/diagrams/<name>.diagram`, or a `diagram` fence of a Markdown page the repository already has, written `docs/architecture.md#<name>`). `npx -y @buun_group/plotwork@0.3.0 import-source --help` lists the formats. Draw one diagram for each stack, service map or schema; three diagrams people read beat a dozen they do not.
3. **Draw them.** Run `npx -y @buun_group/plotwork@0.3.0 generate`. Fix each problem it prints (a code such as S103 names the line of the settings file), then run `npx -y @buun_group/plotwork@0.3.0 generate --check` until it passes. Read the outline of each diagram with `npx -y @buun_group/plotwork@0.3.0 outline <file>` and check it shows what the files say.
4. **Add the check.** Write `.github/workflows/diagrams.yml` as below. Keep the `uses:` line exactly as written: it pins the release by its commit.

   ```yaml
   name: diagrams

   on:
     pull_request:
     push:
       branches: [main]

   permissions:
     contents: read

   jobs:
     drift:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v7
           with:
             persist-credentials: false
         - uses: plotwork-official/plotwork-action@35c08022ae999fc36bc881aad0becab4ae1034e0 # v1.2.0
           with:
             command: generate
             mode: check
             report-drift: true
           env:
             PLOTWORK_API_KEY: ${{ secrets.PLOTWORK_API_KEY }}
   ```

5. **Leave the key to the person.** The report to the organisation's Drift tab needs an organisation API key in the repository secret `PLOTWORK_API_KEY`; the check itself runs without one. Never ask for the key in the chat and never write it into a file. Ask the person to make the key in the Plotwork portal, under the organisation's Keys and CI, and to set the secret themselves, with `gh secret set PLOTWORK_API_KEY` (it asks for the value) or in the repository's Settings, Secrets and variables, Actions. To sign CI in with no key, the organisation can trust the repository instead, under Keys and CI, Trusted publishers (https://docs.plotwork.dev/trusted-publishers); tell the person it exists, and keep the key in the workflow unless they ask for that.
6. **Open a pull request.** Commit the settings file, the diagrams and the workflow on a new branch, and open a pull request titled "Add Plotwork diagrams and the drift check" that lists each diagram and the files it is drawn from. Once it merges and runs with the secret set, the repository appears on the organisation's Drift tab.
