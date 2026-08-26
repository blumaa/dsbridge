/* The report, as it is read where it is printed.
 *
 * The page holds everything; this holds what someone can act on before they
 * open it. Both are rendered from the same reading, so the terminal and the
 * page can disagree about the wording and never about a number.
 *
 * Tables, not prose: the caller of this tool is usually a coding agent, and a
 * paragraph is an invitation to summarise. A table is the answer already.
 */
import { basename, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { table, type Align } from "./table.js";
import type { Contrast, Pair } from "./contrast.js";
import type { Usage } from "./usage.js";

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

function summary(usage: Usage, contrast: Contrast): string {
  const { components, tokens, drift } = usage;
  const replaceable = drift.filter((d) => d.tokens.length > 0).length;
  const files = new Set(drift.map((d) => d.file)).size;
  const duplicates = tokens.invented.filter((t) => t.duplicates !== undefined).length;
  return table(
    ["area", "counted", "found"],
    [
      [
        "components",
        String(components.exported.length),
        `${components.used.length} rendered, ${components.unused.length} never`,
      ],
      [
        "tokens",
        String(tokens.total),
        `${tokens.spent.length} read, ${tokens.repointed.length} re-pointed, ` +
          `${tokens.invented.length} invented, ${duplicates} of those a duplicate`,
      ],
      [
        "drift",
        String(drift.length),
        `${replaceable} a token already holds, in ${files} ${files === 1 ? "file" : "files"}`,
      ],
      [
        "contrast",
        String(contrast.measured),
        `${contrast.failing.length} failing, ${contrast.exempt.length} exempt, ` +
          `${contrast.unmeasured.length} not measurable, ${contrast.overMedia.length} over media`,
      ],
    ],
    ["left", "right", "left"],
  );
}

const themes = (pair: Pair) =>
  ["light", "dark"].map((theme) => {
    const ratio = pair.ratio[theme as "light" | "dark"];
    return ratio === undefined ? "—" : ratio.toFixed(2);
  });

/**
 * The report.
 *
 * `at` and `page` are passed in rather than found here, so the same reading of
 * the same app prints the same characters.
 */
export function report(
  usage: Usage,
  contrast: Contrast,
  at: string,
  page: string,
  limit: number = ROWS,
): string {
  const root = usage.system.root;
  const where = (file: string, line: number) => place(file, line, root);
  const system = [usage.system.tokens.id, usage.system.components?.id].filter(Boolean).join(" · ");

  return [
    `${basename(root)} · ${at}`,
    `${system} — ${usage.coverage}% of written values came through the system`,
    summary(usage, contrast),
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
    ...block(
      "Drift — a literal value a token already holds",
      usage.drift
        .filter((d) => d.tokens.length > 0)
        .map((d) => [
          where(d.file, d.line),
          short(`${d.property}: ${d.value}`, 32),
          short(d.tokens.join(" "), 34),
        ]),
      ["where", "written by hand", "token holding that value"],
      ["left", "left", "left"],
      limit,
    ),
    ...block(
      "Invented tokens holding a value the system already has",
      usage.tokens.invented
        .filter((t) => t.duplicates !== undefined)
        .map((t) => [where(t.file, t.line), short(t.name, 28), short(t.value, 20), short(t.duplicates!, 28)]),
      ["where", "token", "value", "same as"],
      ["left", "left", "left", "left"],
      limit,
    ),
    ...block(
      "Read but never declared",
      usage.tokens.missing.map((t) => [where(t.file, t.line), t.name]),
      ["where", "token"],
      ["left", "left"],
      limit,
    ),
    ...(usage.components.unused.length > 0
      ? [
          `${heading("Never rendered", usage.components.unused.length)}\n` +
            usage.components.unused.join(", "),
        ]
      : []),
    `page: ${pathToFileURL(page).href}`,
  ].join("\n\n");
}
