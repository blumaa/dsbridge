/* The findings, laid out where they are read.
 *
 * One question, asked of every value and every component the app writes: did
 * this come from the design system, from something the app named itself, or
 * from nothing at all. Every table below is that question answered about one
 * kind of thing, and every row carries the file and the line it is answered in.
 *
 * Tables, not prose: the caller of this tool is usually a coding agent, and a
 * paragraph is an invitation to summarise. A table is the answer already.
 */
import { basename, relative } from "node:path";
import { table, type Align } from "./table.js";
import type { Contrast, Pair } from "./contrast.js";
import type { ComponentUse, Kind, Usage } from "./usage.js";

/** Rows past this belong to `design_system_drift`, which lists them all. */
const ROWS = 10;

const short = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, width - 1)}…` : text;

/** As much of the widest column as a terminal has room for. */
const WHERE = 34;

/**
 * Where a finding is, in the room a column has.
 *
 * A path is read from its right — the file is the thing being opened — so what
 * goes is the front of it, and it goes a whole segment at a time: half a
 * directory name is worse than no directory name. An installed package is
 * shown from the package down, because nothing above `node_modules` tells
 * anyone anything.
 */
function place(file: string, line: number, root: string): string {
  const relative_ = relative(root, file);
  const inside = relative_.split("node_modules/").pop() ?? relative_;
  const segments = `${inside}:${line}`.split("/");
  const kept: string[] = [];
  for (const segment of [...segments].reverse()) {
    const next = [segment, ...kept];
    if (next.join("/").length + (next.length < segments.length ? 2 : 0) > WHERE) break;
    kept.unshift(segment);
  }
  if (kept.length === 0) return short(segments.at(-1)!, WHERE);
  return kept.length === segments.length ? kept.join("/") : `…/${kept.join("/")}`;
}

/** What a token reads as once the `var()` around it is noise. */
const bare = (value: string) => value.replace(/var\(\s*(--[\w-]+)\s*\)/g, "$1").trim();

const heading = (title: string, count: number) => `${title} (${count})`;

const places = (list: ComponentUse[]) => list.reduce((total, one) => total + one.count, 0);

/** A heading, its table, the count of what would not fit, and any footnote. */
function block(
  title: string,
  rows: string[][],
  headers: string[],
  align: Align[],
  limit: number,
  foot: string[] = [],
): string[] {
  if (rows.length === 0) return [];
  const shown = rows.slice(0, limit);
  const rest = rows.length - shown.length;
  return [
    [
      heading(title, rows.length),
      table(headers, shown, align),
      ...(rest > 0 ? [`… and ${rest} more`] : []),
      ...foot,
    ].join("\n"),
  ];
}

/* ── the three summaries ─────────────────────────────────────────────────── */

/** Every value the app wrote, by who named it. The contract, in three rows. */
function values(usage: Usage): string {
  const { system, own, literal } = usage.written;
  const all = system + own + literal;
  const share = (count: number) => (all === 0 ? "—" : `${Math.round((count / all) * 100)}%`);
  return table(
    ["values written", "count", "share"],
    [
      ["through a design system token", String(system), share(system)],
      ["through a token the app named itself", String(own), share(own)],
      ["through no token at all", String(literal), share(literal)],
    ],
    ["left", "right", "right"],
  );
}

/** Every component the app renders, by whose it is. */
function components(usage: Usage): string {
  const { used, own, external, unused, rebuilt, promotable } = usage.components;
  const moveable = new Set(promotable);
  return table(
    ["components rendered", "kinds", "places"],
    [
      ["from the design system", String(used.length), String(places(used))],
      ["the app's own", String(own.length), String(places(own))],
      [
        "  of those, could move into the system",
        String(own.filter((one) => moveable.has(one.name)).length),
        "—",
      ],
      ["  of those, a name the system already ships", String(rebuilt.length), "—"],
      ["from another package", String(external.length), String(places(external))],
      ["shipped by the system, never rendered", String(unused.length), "—"],
    ],
    ["left", "right", "right"],
  );
}

/**
 * The app's own components, and what could become of each.
 *
 * A name the system already ships is a component to delete rather than move —
 * the import exists. The ones with something to be done about them go first,
 * because a long list is read from the top.
 */
function ownComponents(usage: Usage, limit: number): string[] {
  const { own, rebuilt, promotable } = usage.components;
  const ships = new Set(rebuilt.map((one) => one.name));
  const moveable = new Set(promotable);
  const NOTES = ["the system already ships one by this name", "could move into the system", ""];
  const rank = (one: ComponentUse) => (ships.has(one.name) ? 0 : moveable.has(one.name) ? 1 : 2);
  return block(
    "The app's own components",
    [...own]
      .sort((a, b) => rank(a) - rank(b) || b.files.length - a.files.length || b.count - a.count)
      .map((one) => [one.name, String(one.count), String(one.files.length), NOTES[rank(one)]!]),
    ["component", "rendered", "in files", "note"],
    ["left", "right", "right", "left"],
    limit,
  );
}

/** The token contract: what is offered, what is taken, what is named twice. */
function tokens(usage: Usage): string {
  const { total, spent, repointed, invented, missing } = usage.tokens;
  return table(
    ["tokens", "count"],
    [
      ["declared by the design system", String(total)],
      ["read by the app", String(spent.length)],
      ["re-pointed by the app's brand", String(repointed.length)],
      ["declared by the app itself", String(invented.length)],
      ["of those, read anywhere", String(invented.filter((token) => token.used > 0).length)],
      ["read by the app and declared by nobody", String(missing.length)],
    ],
    ["left", "right"],
  );
}

const KINDS: Kind[] = ["colour", "spacing", "radius", "border", "type", "size", "shadow", "other"];

/** What is missing from the scales, which is the useful half of a literal. */
function scales(usage: Usage): string[] {
  if (usage.drift.length === 0) return [];
  const rows = KINDS.map((kind) => {
    const written = usage.drift.filter((one) => one.kind === kind);
    const held = written.filter((one) => one.tokens.length > 0).length;
    return { kind, written: written.length, held };
  }).filter((row) => row.written > 0);
  return [
    [
      heading("Values with no token behind them", usage.drift.length),
      table(
        ["kind", "written", "a token already holds"],
        rows.map((row) => [row.kind, String(row.written), row.held === 0 ? "—" : String(row.held)]),
        ["left", "right", "right"],
      ),
    ].join("\n"),
  ];
}

/* ── contrast ────────────────────────────────────────────────────────────── */

const themes = (pair: Pair) =>
  ["light", "dark"].map((theme) => {
    const ratio = pair.ratio[theme as "light" | "dark"];
    return ratio === undefined ? "—" : ratio.toFixed(2);
  });

/**
 * WCAG 2.2 on what this app actually renders, brand applied, both themes.
 *
 * Split by whose stylesheet wrote the pair, because the two failures are
 * different jobs: one is the system's own colours failing under this app's
 * brand, the other is the app painting text itself.
 */
function wcag(contrast: Contrast): string {
  const whose = (pairs: Pair[]) => [
    String(pairs.length),
    String(pairs.filter((pair) => pair.where === "system").length),
    String(pairs.filter((pair) => pair.where === "app").length),
  ];
  return table(
    ["WCAG 1.4.3 contrast", "pairs", "in the system", "in the app"],
    [
      ["pass", ...whose(contrast.pairs.filter((pair) => pair.fails.length === 0))],
      ["fail", ...whose(contrast.failing)],
      ["exempt: an inactive control is not asked to pass", ...whose(contrast.exempt)],
      ["not measurable", ...whose(contrast.unmeasured)],
      ["text over media, where no ratio exists", String(contrast.overMedia.length), "—", "—"],
    ],
    ["left", "right", "right", "right"],
  );
}

/**
 * The report.
 *
 * `at` is passed in rather than found here, so the same reading of the same app
 * prints the same characters.
 */
export function report(usage: Usage, contrast: Contrast, at: string, limit: number = ROWS): string {
  const root = usage.system.root;
  const where = (file: string, line: number) => place(file, line, root);
  const system = [usage.system.tokens.id, usage.system.components?.id].filter(Boolean).join(" · ");

  return [
    `${basename(root)} · ${at}`,
    `${system} — ${usage.coverage}% of written values came through the system`,
    values(usage),
    ...scales(usage),
    ...block(
      "Literal values a token already holds",
      usage.drift
        .filter((one) => one.tokens.length > 0)
        .map((one) => [
          where(one.file, one.line),
          one.kind,
          short(`${one.property}: ${one.value}`, 32),
          short(one.tokens.join(" "), 34),
        ]),
      ["where", "kind", "written by hand", "token holding that value"],
      ["left", "left", "left", "left"],
      limit,
    ),
    components(usage),
    ...ownComponents(usage, limit),
    ...(usage.components.unused.length > 0
      ? [
          `${heading("Never rendered", usage.components.unused.length)}\n` +
            usage.components.unused.join(", "),
        ]
      : []),
    tokens(usage),
    ...block(
      "Tokens the app named itself",
      usage.tokens.invented.map((token) => [
        where(token.file, token.line),
        short(token.name, 28),
        short(token.value, 20),
        String(token.used),
        token.duplicates === undefined ? "" : short(token.duplicates, 28),
      ]),
      ["where", "token", "value", "read", "the system holds this value too"],
      ["left", "left", "left", "right", "left"],
      limit,
    ),
    ...block(
      "Read by the app and declared by nobody",
      usage.tokens.missing.map((token) => [where(token.file, token.line), token.name]),
      ["where", "token"],
      ["left", "left"],
      limit,
    ),
    wcag(contrast),
    ...block(
      "Contrast failures",
      contrast.failing.map((pair) => [
        where(pair.file, pair.line),
        short(pair.selector, 24),
        short(`${bare(pair.fg)} on ${bare(pair.bg)}${pair.inherited ? " *" : ""}`, 32),
        ...themes(pair),
        String(pair.needs),
        pair.fails.join(" "),
      ]),
      ["where", "selector", "text on surface", "light", "dark", "needs", "fails"],
      ["left", "left", "left", "right", "right", "right", "left"],
      limit,
      contrast.failing.some((pair) => pair.inherited)
        ? ["* the rule paints no surface of its own, so it was measured against the page"]
        : [],
    ),
  ].join("\n\n");
}
