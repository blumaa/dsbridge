# dsbridge

An MCP server that answers one question about any app: is the contract between
the design system it installed and the app holding. Every value the app writes
and every component it renders, sorted by where it came from — the design
system, a name the app gave itself, or nothing at all — and what the app's own
brand does to contrast.

Ask from inside a consuming app, in plain language — *"check my design system
usage"* — and get the report back as tables, in the terminal, with a file and a
line against every row.

```
web · 2026-08-26

@acme/tokens · @acme/react — 67% of written values came through the system

values written                        count  share
------------------------------------  -----  -----
through a design system token           234    67%
through a token the app named itself    112    32%
through no token at all                   2     1%

Values with no token behind them (2)
kind  written  a token already holds
----  -------  ---------------------
size        2                      —

components rendered                          kinds  places
-------------------------------------------  -----  ------
from the design system                          63     511
the app's own                                  144     649
  of those, could move into the system          14       —
  of those, a name the system already ships      0       —
from another package                             9     132
shipped by the system, never rendered            9       —

The app's own components (144)
component    rendered  in files  note
-----------  --------  --------  --------------------------
AuthorLine          9         4  could move into the system
TagList             6         4  could move into the system
Section             4         4  could move into the system
MemberList         16         3  could move into the system
CountBadge          8         3  could move into the system
FilterChips         8         3  could move into the system
ActionBar           3         3  could move into the system
RailCard            4         3  could move into the system
SplitPane           5         2  could move into the system
Byline              3         2  could move into the system
… and 134 more

Never rendered (9)
Container, DateTimePicker, Popover, ProgressBar, Spinner, Tab, TabList, TabPanel, Tabs

tokens                                  count
--------------------------------------  -----
declared by the design system             268
read by the app                            67
re-pointed by the app's brand              60
declared by the app itself                 47
of those, read anywhere                    46
read by the app and declared by nobody      0

Tokens the app named itself (47)
where                               token          value                  read  the system holds this value too
----------------------------------  -------------  ---------------------  ----  -------------------------------
…/web/src/app/frames.module.css:13  --logo-height  var(--acme-logo-md)       1
…/web/src/app/frames.module.css:28  --logo-height  var(--acme-logo-lg)       1
…/Logo/Logo.module.css:27           --logo-height  var(--acme-logo-sm)       1
…/Logo/Logo.module.css:41           --logo-height  var(--acme-icon-slot…     1
…/src/tokens/brand.css:17           --brand-red    #990100                   1
…/src/tokens/brand.css:18           --brand-rose   #ecdbdb                   1
…/src/tokens/brand.css:19           --brand-paper  #fdfaf1                   2
…/src/tokens/brand.css:20           --brand-white  #ffffff                   1  --acme-color-on-accent
… and 39 more

WCAG 1.4.3 contrast                               pairs  in the system  in the app
------------------------------------------------  -----  -------------  ----------
pass                                                107             97          10
fail                                                  3              3           0
exempt: an inactive control is not asked to pass      7              7           0
not measurable                                       17             17           0
text over media, where no ratio exists                5              —           —

Contrast failures (3)
where                        selector                  text on surface                   light   dark  needs  fails
---------------------------  ------------------------  --------------------------------  -----  -----  -----  -----
…/react/dist/index.css:2559  .acme-ImageCarousel__co…  --acme-text-on-media on --acme-…   2.60  19.88    4.5  light
…/react/dist/index.css:2782  .acme-VideoPlayer__start  --acme-text-on-media on --acme-…   2.60  19.88    4.5  light
…/react/dist/index.css:530   .acme-Chip__variant-soft  --acme-text-accent on --acme-ac…   6.67   4.39    4.5  dark
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
| `design_system_usage` | The report above: a table per question, ten rows in each list |
| `design_system_drift` | The same report with every row rather than the first ten |

Ask for either in words. *"Where is this app drifting from the design system?"*
reaches the second one.

Nothing is written anywhere. The app is read and left exactly as it was found,
and the report is the whole answer — there is no file to open afterwards.

## What it measures

Every value written and every component rendered, sorted by where it came
from: the design system, something the app named itself, or nothing at all.

- **Values** — how many came through a system token, through a token the app
  declared, and through neither, with the ones written by hand broken down by
  what they are values of. A colour scale nobody can reach is a different job
  from a spacing scale nobody used.
- **Components** — how many kinds the app renders from the system, how many are
  its own, and how many come from elsewhere. Of the app's own: which the system
  already ships by that name, and which could move into it — a component whose
  file imports nothing but the system, React and a stylesheet holds on to
  nothing of this app.
- **Tokens** — declared, read, re-pointed by the app's brand, declared by the
  app alongside an existing one, or read and declared by nobody, which is a
  broken reference. Two tokens count as one value only when they are read for
  the same kind of thing: on an eight-point grid a spacing and a height will
  both hold 8px without meaning the same thing.
- **Contrast** — every text and background pair the app can render, resolved
  under the app's own brand in light and dark, against WCAG 1.4.3 and 1.4.11,
  and split by whose stylesheet wrote the pair.

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
