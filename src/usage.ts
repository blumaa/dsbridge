/* Whether the design system is being used, and how.
 *
 * Four questions, and they are not the same question: which components the app
 * renders, which tokens it spends, which tokens it invented instead, and which
 * values it wrote past the system entirely. An app can score well on the first
 * and badly on the last — importing Button and then hard-coding its padding is
 * exactly what a coverage number alone would call adoption.
 *
 * Everything here is counted from the app's own source. What it installed is
 * `discover.ts`, and nothing under `node_modules` is ever the app's to answer
 * for.
 */
import { readFileSync } from "node:fs";
import { blocksIn, declarationsIn } from "./css/parse.js";
import { parseColor, type TokenMap } from "./css/color.js";
import { loadGraph, type Graph } from "./graph.js";
import { openingTags, styleDeclarations } from "./jsx.js";
import { findBrandFiles, findStylesheets, findTokenFiles, rootScoped } from "./sources.js";
import type { Discovery } from "./discover.js";

export type Place = { file: string; line: number };

/** A system component the app renders, and where. */
export type ComponentUse = { name: string; count: number; files: string[] };

/** A custom property the app declared outside the system's namespace. */
export type Invented = Place & {
  name: string;
  value: string;
  /** The system token already holding this value, where there is one. */
  duplicates?: string;
};

/** A literal value written where a token could have been. */
export type Drift = Place & {
  property: string;
  value: string;
  /** System tokens that already hold this exact value. */
  tokens: string[];
};

export type Usage = {
  system: Discovery;
  graph: Graph;
  components: { exported: string[]; used: ComponentUse[]; unused: string[] };
  tokens: {
    /** How many the system declares. */
    total: number;
    /** System tokens the app re-points at the document root. */
    repointed: string[];
    /** System tokens the app reads. */
    spent: string[];
    /** var() at a name the system has no token for. */
    missing: (Place & { name: string })[];
    invented: Invented[];
  };
  drift: Drift[];
  /** Share of written values that came through the system, 0–100. */
  coverage: number;
  /** App stylesheets that re-point the contract: the bridge, whatever it is called. */
  brand: string[];
};

/* ── what the app renders ────────────────────────────────────────────────── */

/** Local name to system name, for one file's imports of one package. */
function importedFrom(source: string, id: string): Map<string, string> {
  const out = new Map<string, string>();
  const imports = /import\s+([\s\S]*?)\s+from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(imports)) {
    /* Subpaths are the same package: `@acme/react/button` is still its Button. */
    const from = match[2] ?? "";
    if (from !== id && !from.startsWith(`${id}/`)) continue;
    const clause = match[1] ?? "";
    const namespace = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause)?.[1];
    if (namespace !== undefined) out.set(`${namespace}.`, "*");
    const named = /\{([^}]*)\}/.exec(clause)?.[1] ?? "";
    for (const part of named.split(",")) {
      const entry = part.trim();
      if (entry === "" || /^type\b/.test(entry)) continue;
      const [original, alias] = entry.split(/\s+as\s+/).map((s) => s.trim());
      out.set(alias ?? original!, original!);
    }
  }
  return out;
}

/**
 * The system components the app renders.
 *
 * Imported *and* rendered, both. An app that rebuilt `Chip` renders a `<Chip>`
 * that is its own, and counting it because the system also exports one would
 * report the system as used in the one place it was replaced.
 */
function componentsUsed(sources: string[], exported: string[], id: string): ComponentUse[] {
  const known = new Set(exported);
  const counts = new Map<string, { count: number; files: Set<string> }>();
  for (const file of sources) {
    const source = readFileSync(file, "utf8");
    const local = importedFrom(source, id);
    if (local.size === 0) continue;
    for (const tag of openingTags(source)) {
      const dot = tag.name.indexOf(".");
      /* `<DS.Button>` is the namespace import rendering the system's Button. */
      const name =
        dot === -1
          ? local.get(tag.name)
          : local.get(`${tag.name.slice(0, dot + 1)}`) === "*"
            ? tag.name.slice(dot + 1)
            : undefined;
      if (name === undefined || !known.has(name)) continue;
      const seen = counts.get(name) ?? { count: 0, files: new Set<string>() };
      seen.count += 1;
      seen.files.add(file);
      counts.set(name, seen);
    }
  }
  return [...counts]
    .map(([name, seen]) => ({ name, count: seen.count, files: [...seen.files].sort() }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/* ── what the app writes ─────────────────────────────────────────────────── */

/** Every var() a value reads, in the order it reads them. */
const referencesIn = (value: string): string[] =>
  [...value.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((m) => m[1]!);

/** A length that is worth naming: zero is zero in every design system. */
const LENGTH = /(?<![\w.])-?\d*\.?\d+(px|rem|em|ch|vw|vh|vmin|vmax|pt|cm|mm|in|pc)\b/;
const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/;

/** Whether a written value is one a token could have held. */
const literal = (value: string): boolean =>
  !value.includes("var(") && (LENGTH.test(value) || COLOR.test(value));

/** `borderRadius` as CSS spells it, so a style prop and a stylesheet compare. */
const kebab = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** A value as the colour math sees it, so `#fff` and `#ffffff` are one value. */
function normalise(value: string, map: TokenMap): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!COLOR.test(trimmed)) return trimmed;
  try {
    const { r, g, b, a } = parseColor(trimmed, map);
    return `rgba(${r},${g},${b},${a})`;
  } catch {
    return trimmed;
  }
}

/** Value to the system tokens holding it — what makes a literal answerable. */
function valueIndex(graph: Graph, prefix: string, map: TokenMap): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const name of graph.names()) {
    if (!name.startsWith(prefix)) continue;
    let resolved: string;
    try {
      resolved = graph.resolve(name, "light");
    } catch {
      continue;
    }
    const key = normalise(resolved, map);
    out.set(key, [...(out.get(key) ?? []), name]);
  }
  for (const names of out.values()) names.sort();
  return out;
}

/* ── the measurement ─────────────────────────────────────────────────────── */

export function measure(system: Discovery): Usage {
  const brand = findBrandFiles(system.root, system.prefix);
  /* Every app stylesheet that declares tokens, not only the ones re-pointing
     the system: what a value resolves to is decided by all of them together. */
  const graph = loadGraph({
    system: system.tokens.stylesheet,
    brand: findTokenFiles(system.root),
    prefix: system.prefix,
  });
  const map = graph.map("light");
  const holders = valueIndex(graph, system.prefix, map);

  const exported = system.components?.names ?? [];
  const used = componentsUsed(system.sources, exported, system.components?.id ?? "");
  const rendered = new Set(used.map((u) => u.name));

  const spent = new Set<string>();
  const missing: (Place & { name: string })[] = [];
  const invented: Invented[] = [];
  const drift: Drift[] = [];
  let references = 0;

  /* One pass per app stylesheet: every declaration is either spending a token,
     declaring one, or writing a value the system could have held. */
  const stylesheets = findStylesheets(system.root).filter((file) => !file.startsWith(system.tokens.stylesheet));
  for (const file of stylesheets) {
    const source = readFileSync(file, "utf8");
    for (const block of blocksIn(source)) {
      for (const declaration of block.declarations) {
        for (const name of referencesIn(declaration.value)) {
          if (!name.startsWith(system.prefix)) continue;
          if (graph.get(name) === undefined) missing.push({ name, file, line: declaration.line });
          else {
            spent.add(name);
            references += 1;
          }
        }
        if (declaration.property.startsWith("--")) continue;
        if (!literal(declaration.value)) continue;
        drift.push({
          file,
          line: declaration.line,
          property: declaration.property,
          value: declaration.value.trim(),
          tokens: holders.get(normalise(declaration.value, map)) ?? [],
        });
      }
    }
    /* A custom property outside the namespace is the app naming something of
       its own — fine in itself, and worth reading twice when the system already
       named the same value. */
    for (const declared of declarationsIn(source, file)) {
      if (declared.name.startsWith(system.prefix)) continue;
      const holder = holders.get(normalise(declared.value, map))?.[0];
      invented.push({
        name: declared.name,
        value: declared.value.trim(),
        file,
        line: declared.line,
        ...(holder ? { duplicates: holder } : {}),
      });
    }
  }

  /* A style prop is a stylesheet with no file of its own; the same value written
     there is the same decision. */
  for (const file of system.sources) {
    const source = readFileSync(file, "utf8");
    for (const declaration of styleDeclarations(source)) {
      const value = declaration.value.trim().replace(/^["'`]|["'`]$/g, "");
      for (const name of referencesIn(value)) {
        if (!name.startsWith(system.prefix)) continue;
        if (graph.get(name) === undefined) missing.push({ name, file, line: declaration.line });
        else {
          spent.add(name);
          references += 1;
        }
      }
      const property = kebab(declaration.key.replace(/^["'`]|["'`]$/g, ""));
      if (property.startsWith("--")) continue;
      if (!literal(value)) continue;
      drift.push({
        file,
        line: declaration.line,
        property,
        value,
        tokens: holders.get(normalise(value, map)) ?? [],
      });
    }
  }

  const place = (a: Place, b: Place) => a.file.localeCompare(b.file) || a.line - b.line;
  drift.sort(place);
  missing.sort(place);
  invented.sort((a, b) => place(a, b) || a.name.localeCompare(b.name));

  const written = references + drift.length;
  return {
    system,
    graph,
    components: {
      exported,
      used,
      unused: exported.filter((name) => !rendered.has(name)),
    },
    tokens: {
      total: graph.names().filter((name) => name.startsWith(system.prefix)).length,
      repointed: [...new Set(brand.flatMap((file) => repointedIn(file, system.prefix)))].sort(),
      spent: [...spent].sort(),
      missing,
      invented,
    },
    drift,
    coverage: written === 0 ? 0 : Math.round((references / written) * 100),
    brand,
  };
}

/** The system tokens one app stylesheet re-points for the whole document. */
const repointedIn = (file: string, prefix: string): string[] =>
  declarationsIn(readFileSync(file, "utf8"), file)
    .filter((d) => d.name.startsWith(prefix) && rootScoped(d.selector))
    .map((d) => d.name);
