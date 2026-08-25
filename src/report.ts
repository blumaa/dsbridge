/* The page.
 *
 * One file, opened in a browser, that answers the only question worth asking:
 * is the design system being used by this app, and where is it not. Everything
 * on it is something a person can act on this afternoon — a component nobody
 * reached for, a value written by hand that a token already holds, a pair of
 * colours that stopped being readable when the brand moved.
 *
 * It is written to a scratch directory and never into the app it read: the
 * report is about the app, not part of it.
 */
import { basename, relative } from "node:path";
import type { Usage } from "./usage.js";
import type { Contrast, Pair } from "./contrast.js";
import type { Theme } from "./css/parse.js";

/** How many rows of a list a page shows before it says how many are left. */
const ROWS = 40;

const escape = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "#39" }[c]};`);

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** A list, honest about what it left out: a silent cut reads as nothing more to see. */
function rows(items: string[], limit = ROWS): string {
  const shown = items.slice(0, limit).join("");
  const left = items.length - limit;
  return left > 0 ? `${shown}<li class="more">and ${plural(left, "more")}</li>` : shown;
}

const where = (usage: Usage, file: string) => escape(relative(usage.system.root, file));

const bar = (percent: number) =>
  `<div class="bar" style="--fill:${Math.max(0, Math.min(100, percent))}%"><span></span></div>`;

const section = (title: string, note: string, body: string) =>
  `<section><h2>${escape(title)}</h2><p class="note">${note}</p>${body}</section>`;

const empty = (text: string) => `<p class="empty">${escape(text)}</p>`;

function head(usage: Usage, at: string): string {
  const { tokens, components, root } = usage.system;
  const halves = [tokens.id, components?.id].filter((id) => id !== undefined).map(escape).join(" · ");
  return `<header>
  <h1>${escape(basename(root))}</h1>
  <p class="system">${halves}</p>
  <p class="meta">${plural(tokens.declares, "token")} declared · ${plural(usage.brand.length, "brand file")} · ${escape(at)}</p>
  <p class="path">${escape(root)}</p>
</header>`;
}

function headline(usage: Usage): string {
  const written = usage.tokens.spent.length + usage.drift.length;
  return `<section class="headline">
  <p class="figure">${usage.coverage}%</p>
  ${bar(usage.coverage)}
  <p class="note">of the values this app writes came through the system — ${plural(written, "written value")} looked at</p>
</section>`;
}

function components(usage: Usage): string {
  const { exported, used, unused } = usage.components;
  if (exported.length === 0) {
    return section("Components", "The system ships no component package.", "");
  }
  const counts = used.map(
    (c) =>
      `<li><span class="name">${escape(c.name)}</span><span class="count">${plural(c.count, "place")}</span></li>`,
  );
  const never = unused.map((name) => `<li>${escape(name)}</li>`);
  return section(
    "Components",
    `<strong>${used.length} of ${exported.length}</strong> rendered somewhere in the app`,
    `<div class="split">
      <div><h3>Rendered</h3>${used.length ? `<ul class="counted">${rows(counts)}</ul>` : empty("None of them.")}</div>
      <div><h3>Never rendered</h3>${never.length ? `<ul class="chips">${rows(never)}</ul>` : empty("Every one is used.")}</div>
    </div>`,
  );
}

function tokens(usage: Usage): string {
  const { total, spent, repointed, invented, missing } = usage.tokens;
  const duplicates = invented.filter((t) => t.duplicates !== undefined);
  const inventedRows = invented.map(
    (t) =>
      `<li><code>${escape(t.name)}</code><span class="value">${escape(t.value)}</span>${
        t.duplicates ? `<span class="dupe">same value as <code>${escape(t.duplicates)}</code></span>` : ""
      }<span class="at">${where(usage, t.file)}:${t.line}</span></li>`,
  );
  const missingRows = missing.map(
    (t) => `<li><code>${escape(t.name)}</code><span class="at">${where(usage, t.file)}:${t.line}</span></li>`,
  );
  return section(
    "Tokens",
    `<strong>${spent.length} of ${total}</strong> read by the app · <strong>${repointed.length}</strong> re-pointed by its brand`,
    `${missing.length ? `<h3 class="bad">Read but never declared — ${plural(missing.length, "token")}</h3><ul class="plain">${rows(missingRows)}</ul>` : ""}
     <h3>Invented — ${plural(invented.length, "token")}${duplicates.length ? `, ${duplicates.length} holding a value the system already has` : ""}</h3>
     ${invented.length ? `<ul class="plain">${rows(inventedRows)}</ul>` : empty("The app invented none.")}
     <h3>Re-pointed</h3>
     ${repointed.length ? `<ul class="chips">${rows(repointed.map((n) => `<li><code>${escape(n)}</code></li>`))}</ul>` : empty("The app takes the system's values as they come.")}`,
  );
}

function drift(usage: Usage): string {
  const files = new Set(usage.drift.map((d) => d.file));
  const items = usage.drift.map(
    (d) =>
      `<li><code>${escape(d.property)}: ${escape(d.value)}</code>${
        d.tokens.length ? `<span class="fix">${d.tokens.map((n) => `<code>${escape(n)}</code>`).join(" ")}</span>` : `<span class="none">no token holds this value</span>`
      }<span class="at">${where(usage, d.file)}:${d.line}</span></li>`,
  );
  return section(
    "Drift",
    `<strong>${plural(usage.drift.length, "literal value")}</strong> written by hand in ${plural(files.size, "file")}`,
    usage.drift.length ? `<ul class="plain">${rows(items)}</ul>` : empty("Every value came from a token."),
  );
}

const ratios = (pair: Pair): string =>
  (["light", "dark"] as Theme[])
    .filter((theme) => pair.ratio[theme] !== undefined)
    .map(
      (theme) =>
        `<span class="ratio ${pair.fails.includes(theme) ? "bad" : "ok"}">${theme} ${pair.ratio[theme]!.toFixed(2)}</span>`,
    )
    .join("");

const pairRow = (usage: Usage, pair: Pair): string =>
  `<li>
    <span class="selector">${escape(pair.selector)}</span>
    <span class="colours"><code>${escape(pair.fg)}</code> on <code>${escape(pair.bg)}</code></span>
    ${ratios(pair)}<span class="needs">needs ${pair.needs}</span>
    <span class="tag">${pair.where}</span>
    ${pair.repointed.length ? `<span class="dupe">the app re-points ${pair.repointed.map((n) => `<code>${escape(n)}</code>`).join(" ")}</span>` : ""}
    <span class="at">${where(usage, pair.file)}:${pair.line}</span>
  </li>`;

/** Reasons, counted: the same sentence 112 times is one finding, not 112. */
function reasons(usage: Usage, pairs: Pair[]): string {
  const grouped = new Map<string, Pair[]>();
  for (const pair of pairs) {
    const reason = (pair.unmeasured ?? "").replace(/var\(--[\w-]+\)|--[\w-]+|#[0-9a-fA-F]{3,8}/g, "…");
    grouped.set(reason, [...(grouped.get(reason) ?? []), pair]);
  }
  const items = [...grouped]
    .sort((a, b) => b[1].length - a[1].length)
    .map(
      ([reason, group]) =>
        `<li><span class="count">${group.length}</span><span class="why">${escape(reason)}</span>
         <span class="at">${group
           .slice(0, 6)
           .map((p) => `<code>${escape(p.selector)}</code>`)
           .join(" ")}${group.length > 6 ? ` and ${group.length - 6} more` : ""}</span></li>`,
    );
  return `<ul class="plain">${rows(items)}</ul>`;
}

function contrast(usage: Usage, report: Contrast): string {
  const own = report.failing.filter((p) => !p.inherited);
  const inherited = report.failing.filter((p) => p.inherited);
  const media = report.overMedia.map(
    (o) =>
      `<li><span class="selector">${escape(o.selector)}</span><code>${escape(o.property)}: ${escape(o.value)}</code><span class="at">${where(usage, o.file)}:${o.line}</span></li>`,
  );
  const nosurface = (["light", "dark"] as Theme[]).filter((theme) => report.surface[theme] === undefined);
  return section(
    "Contrast",
    `<strong>${plural(report.measured, "pair")}</strong> measured under light and dark with this app's brand applied · <strong class="${report.failing.length ? "bad" : "ok"}">${plural(report.failing.length, "failure")}</strong>`,
    `${
      nosurface.length
        ? `<p class="warn">Nothing in this app's CSS says what colour the page is${
            nosurface.length === 1 ? ` in ${nosurface[0]}` : ""
          }, so text that brings no background of its own cannot be measured.</p>`
        : ""
    }
     <h3 class="bad">Fails on the surface it declares — ${own.length}</h3>
     ${own.length ? `<ul class="pairs">${rows(own.map((p) => pairRow(usage, p)))}</ul>` : empty("None.")}
     <h3 class="bad">Fails against the page surface it inherits — ${inherited.length}</h3>
     <p class="note">These write no background of their own, so they were measured against ${
       report.surface.light ? `<code>${escape(report.surface.light)}</code>` : "the page"
     }. Where the app renders them somewhere else, the pair is somewhere else too.</p>
     ${inherited.length ? `<ul class="pairs">${rows(inherited.map((p) => pairRow(usage, p)))}</ul>` : empty("None.")}
     <h3>Not asked to pass — ${report.exempt.length}</h3>
     <p class="note">Measured, and below the threshold, but exempt: WCAG 1.4.3 does not ask an inactive control to pass. Worth a look, not a failure.</p>
     ${report.exempt.length ? `<ul class="pairs">${rows(report.exempt.map((p) => pairRow(usage, p)))}</ul>` : empty("None.")}
     <h3>Not measurable — ${report.unmeasured.length}</h3>
     ${report.unmeasured.length ? reasons(usage, report.unmeasured) : empty("Everything written could be measured.")}
     <h3>Text over media — ${report.overMedia.length}</h3>
     <p class="note">No ratio exists against a photograph. The ask is a surface of the box's own.</p>
     ${report.overMedia.length ? `<ul class="plain">${rows(media)}</ul>` : empty("None.")}`,
  );
}

const STYLE = `
:root { color-scheme: light dark; --ink: #14161a; --dim: #5c6470; --line: #e3e6ea; --page: #fbfbfc; --card: #ffffff; --bad: #b4232c; --ok: #1f7a45; --accent: #2c5fd0; }
@media (prefers-color-scheme: dark) { :root { --ink: #e9ecf1; --dim: #9aa4b2; --line: #2a2f37; --page: #14161a; --card: #1b1e24; --bad: #ff7b82; --ok: #5fd39a; --accent: #7fa5ff; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 2.5rem 1.5rem 6rem; background: var(--page); color: var(--ink); font: 15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; }
main { max-width: 62rem; margin: 0 auto; }
h1 { margin: 0; font-size: 1.9rem; letter-spacing: -0.02em; }
h2 { margin: 0 0 0.25rem; font-size: 1.15rem; letter-spacing: -0.01em; }
h3 { margin: 1.5rem 0 0.5rem; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--dim); }
code { font: 12.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: color-mix(in srgb, var(--accent) 10%, transparent); border-radius: 3px; padding: 0.1em 0.35em; }
header { border-bottom: 1px solid var(--line); padding-bottom: 1.5rem; margin-bottom: 2rem; }
header .system { margin: 0.35rem 0 0; font-weight: 600; color: var(--accent); }
header .meta, header .path { margin: 0.2rem 0 0; color: var(--dim); font-size: 0.85rem; }
header .path { font-family: ui-monospace, monospace; font-size: 0.75rem; }
section { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 1.5rem; margin-bottom: 1.25rem; }
section > .note, p.note { margin: 0 0 0.75rem; color: var(--dim); font-size: 0.9rem; }
.headline { text-align: center; padding: 2rem 1.5rem; }
.headline .figure { margin: 0; font-size: 4rem; font-weight: 700; letter-spacing: -0.04em; line-height: 1; }
.bar { height: 10px; border-radius: 999px; background: var(--line); overflow: hidden; margin: 1rem auto 0.75rem; max-width: 34rem; }
.bar span { display: block; height: 100%; width: var(--fill); background: var(--accent); }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
@media (max-width: 40rem) { .split { grid-template-columns: 1fr; } }
ul { list-style: none; margin: 0; padding: 0; }
ul.plain li, ul.counted li, ul.pairs li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; padding: 0.45rem 0; border-top: 1px solid var(--line); }
ul.chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
ul.chips li { border: 1px solid var(--line); border-radius: 999px; padding: 0.15rem 0.6rem; font-size: 0.85rem; }
.name { font-weight: 600; }
.count { font-variant-numeric: tabular-nums; font-weight: 600; }
.at { margin-left: auto; color: var(--dim); font-size: 0.75rem; font-family: ui-monospace, monospace; }
.value, .why, .colours { color: var(--dim); font-size: 0.85rem; }
.selector { font-family: ui-monospace, monospace; font-size: 0.8rem; font-weight: 600; max-width: 100%; overflow-wrap: anywhere; }
.ratio { font-variant-numeric: tabular-nums; font-size: 0.78rem; border-radius: 4px; padding: 0.05em 0.4em; border: 1px solid var(--line); }
.ratio.bad { color: var(--bad); border-color: currentColor; }
.ratio.ok { color: var(--ok); border-color: currentColor; }
.needs, .tag { font-size: 0.75rem; color: var(--dim); }
.tag { border: 1px solid var(--line); border-radius: 4px; padding: 0.05em 0.4em; text-transform: uppercase; letter-spacing: 0.06em; }
.dupe, .fix { font-size: 0.8rem; color: var(--dim); }
.none { font-size: 0.8rem; color: var(--bad); }
.bad { color: var(--bad); }
.ok { color: var(--ok); }
.empty, .more { color: var(--dim); font-size: 0.85rem; padding: 0.45rem 0; }
.warn { border-left: 3px solid var(--bad); padding: 0.5rem 0.75rem; margin: 0 0 1rem; background: color-mix(in srgb, var(--bad) 8%, transparent); font-size: 0.9rem; }
`;

/**
 * The whole report, as one file.
 *
 * `at` is passed in rather than read from the clock so the same reading of the
 * same app produces the same page.
 */
export function page(usage: Usage, report: Contrast, at: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Design system usage — ${escape(basename(usage.system.root))}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${head(usage, at)}
${headline(usage)}
${components(usage)}
${tokens(usage)}
${drift(usage)}
${contrast(usage, report)}
</main>
</body>
</html>
`;
}
