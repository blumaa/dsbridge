# dsbridge

An MCP server that answers one question about any app: is the design system it
installed actually being used, and how.

Ask from inside a consuming app, in plain language — *"check my design system
usage"* — and get back a five-line headline plus a link to a page you can read.

```
@acme/tokens · @acme/react — 99% of written values came through the system
components: 64 of 73 rendered, 9 never
tokens: 67 of 268 read, 60 re-pointed, 47 invented (15 duplicating a system value), 1 read but never declared
drift: 2 literal values in 2 files
contrast: 119 pairs measured, 3 failing, 7 exempt (inactive controls), 17 not measurable, 6 over media
```

## Install

Node 20 or newer. One command, nothing to clone:

```sh
claude mcp add --scope user dsbridge -- npx -y github:blumaa/dsbridge
```

`--scope user` writes `~/.claude.json`, so the server is available in every
repository without being installed in any of them. No hooks, nothing that runs
on its own, nothing added to the consuming app. Restart the session and
`claude mcp list` should show it connected.

The first run clones this repository and compiles it — the `prepare` script
builds on install, which is why `dist/` is not committed. Later runs come from
the npx cache. To pick up a new version, clear it: `npx clear-npx-cache`.

Any MCP client works. The server speaks stdio and the command is
`npx -y github:blumaa/dsbridge`.

To work on it instead of just using it:

```sh
git clone git@github.com:blumaa/dsbridge.git
cd dsbridge && pnpm install
claude mcp add --scope user dsbridge -- node "$PWD/dist/server.js"
```

## Use

Two tools. Both take an optional `path` and default to the working directory.

| Tool | Returns |
| --- | --- |
| `design_system_usage` | The headline above, plus a `file://` link to a self-contained HTML page written under `$TMPDIR/dsbridge` |
| `design_system_drift` | The fix lists: hand-written values a token already holds, invented tokens duplicating a system value, tokens read but never declared, and contrast failures |

Ask for either in words. *"Where is this app drifting from the design system?"*
reaches the second one.

## What it measures

- **Components** — how many the system exports against how many the app
  renders, and which are never used.
- **Tokens** — read, re-pointed by the app's brand, invented alongside an
  existing one, or read but never declared, which is a broken reference.
- **Drift** — literal values written by hand where a token already holds that
  value, with file and line.
- **Contrast** — every text and background pair the app can render, resolved
  under the app's own brand in light and dark, against WCAG 1.4.3 and 1.4.11.

Nothing is dropped for being hard. Text over a gradient or an image is reported
separately, and a pair that cannot be resolved is reported with the reason.
Inactive controls are shown as exempt rather than counted against the app,
because WCAG does not ask them to pass.

## No configuration

There is no config file and nothing to name. The design system is found by
shape: the tokens package is the installed dependency that declares the most
custom properties, and the components package is the family member that only
spends them. Any design system, any app.

## Development

```sh
pnpm verify   # build, typecheck, test
```

Tests run against fixture apps under `src/__fixtures__`, including their
`node_modules`, which are committed on purpose — how a package states its
exports is the thing under test.

## License

MIT
