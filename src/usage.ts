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

/** A component the app renders, and where. */
export type ComponentUse = { name: string; count: number; files: string[] };

/** What a written value is a value of, which is what token was missing. */
export type Kind = "colour" | "spacing" | "radius" | "border" | "type" | "size" | "shadow" | "other";

/** A custom property the app declared outside the system's namespace. */
export type Invented = Place & {
  name: string;
  value: string;
  /** How many times the app reads it. A token nothing reads is dead weight. */
  used: number;
  /** A system token that holds this same value and does not get it from here.
      Stated as a fact rather than a fault: two tokens can hold one value and
      mean two things. */
  duplicates?: string;
};

/** A literal value written where a token could have been. */
export type Drift = Place & {
  property: string;
  value: string;
  kind: Kind;
  /** System tokens that already hold this exact value. */
  tokens: string[];
};

export type Usage = {
  system: Discovery;
  graph: Graph;
  components: {
    exported: string[];
    /** Rendered, and the system's. */
    used: ComponentUse[];
    unused: string[];
    /** Rendered, and the app's own: a local file, or defined where it is used. */
    own: ComponentUse[];
    /** Rendered, and somebody else's package. */
    external: ComponentUse[];
    /** The app's own, by a name the system already exports, in a file that
        never imports the system: rebuilt rather than wrapped. */
    rebuilt: (Place & { name: string })[];
    /** The app's own, in a file that holds on to nothing of this app's: moving
        one into the system is a file move. */
    promotable: string[];
  };
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
  /** Every value the app wrote, by where it came from. The question the whole
      report answers, in three numbers. */
  written: { system: number; own: number; literal: number };
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

/** Local name to the module it came from, for every value import in a file. */
function importsIn(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const imports = /import\s+([\s\S]*?)\s+from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(imports)) {
    const from = match[2] ?? "";
    const clause = match[1] ?? "";
    if (/^type\b/.test(clause.trim())) continue;
    const namespace = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause)?.[1];
    if (namespace !== undefined) out.set(namespace, from);
    const first = clause.trim().match(/^([A-Za-z_$][\w$]*)\s*(?:,|$)/)?.[1];
    if (first !== undefined) out.set(first, from);
    for (const part of (/\{([^}]*)\}/.exec(clause)?.[1] ?? "").split(",")) {
      const entry = part.trim();
      if (entry === "" || /^type\b/.test(entry)) continue;
      const [, alias] = entry.split(/\s+as\s+/).map((piece) => piece.trim());
      out.set(alias ?? entry, from);
    }
  }
  return out;
}

/** Components this file declares itself, and the line they start on. */
function definedIn(source: string): Map<string, number> {
  const out = new Map<string, number>();
  const declaration = /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|const|let|class)\s+([A-Z][\w$]*)/gm;
  for (const match of source.matchAll(declaration)) {
    const name = match[1]!;
    if (out.has(name)) continue;
    out.set(name, source.slice(0, match.index).split("\n").length);
  }
  return out;
}

/** A module the app wrote, as opposed to one it installed. */
const appModule = (from: string) => /^[./]|^[@~#]\//.test(from);

/**
 * The components the app renders, and whose they are.
 *
 * Imported *and* rendered, both, and told apart by where the import came from:
 * an app that rebuilt `Chip` renders a `<Chip>` that is its own, and counting
 * it because the system also exports one would report the system as used in
 * the one place it was replaced. A lowercase tag is a DOM element and nobody's
 * component.
 */
function whatIsRendered(
  sources: string[],
  exported: string[],
  id: string,
): { system: ComponentUse[]; own: ComponentUse[]; external: ComponentUse[] } {
  const known = new Set(exported);
  const counts = {
    system: new Map<string, { count: number; files: Set<string> }>(),
    own: new Map<string, { count: number; files: Set<string> }>(),
    external: new Map<string, { count: number; files: Set<string> }>(),
  };
  const add = (into: Map<string, { count: number; files: Set<string> }>, name: string, file: string) => {
    const seen = into.get(name) ?? { count: 0, files: new Set<string>() };
    seen.count += 1;
    seen.files.add(file);
    into.set(name, seen);
  };

  for (const file of sources) {
    const source = readFileSync(file, "utf8");
    const fromSystem = importedFrom(source, id);
    const imports = importsIn(source);
    const defined = definedIn(source);
    for (const tag of openingTags(source)) {
      const dot = tag.name.indexOf(".");
      const base = dot === -1 ? tag.name : tag.name.slice(0, dot);
      if (!/^[A-Z]/.test(base)) continue;
      /* `<DS.Button>` is the namespace import rendering the system's Button. */
      const systemName =
        dot === -1
          ? fromSystem.get(tag.name)
          : fromSystem.get(`${base}.`) === "*"
            ? tag.name.slice(dot + 1)
            : undefined;
      if (systemName !== undefined && known.has(systemName)) {
        add(counts.system, systemName, file);
        continue;
      }
      const from = imports.get(base);
      if (from !== undefined && (from === id || from.startsWith(`${id}/`))) {
        add(counts.system, tag.name, file);
        continue;
      }
      if (from !== undefined && !appModule(from)) {
        add(counts.external, tag.name, file);
        continue;
      }
      if (from !== undefined || defined.has(base)) add(counts.own, tag.name, file);
    }
  }

  const listed = (from: Map<string, { count: number; files: Set<string> }>): ComponentUse[] =>
    [...from]
      .map(([name, seen]) => ({ name, count: seen.count, files: [...seen.files].sort() }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { system: listed(counts.system), own: listed(counts.own), external: listed(counts.external) };
}

/**
 * The app's own components that the system already exports by that name.
 *
 * A file that imports the system and declares a `Button` is wrapping one; a
 * file that declares a `Button` and imports nothing from the system built a
 * second one. Only the second is a component that could be an import.
 */
function rebuilt(sources: string[], exported: string[], id: string): (Place & { name: string })[] {
  const known = new Set(exported);
  const out: (Place & { name: string })[] = [];
  for (const file of sources) {
    const source = readFileSync(file, "utf8");
    const imports = [...importsIn(source).values()];
    if (imports.some((from) => from === id || from.startsWith(`${id}/`))) continue;
    for (const [name, line] of definedIn(source)) {
      if (known.has(name)) out.push({ name, file, line });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** React, a stylesheet, or the design system: nothing that ties a file here. */
const portable = (from: string, id: string) =>
  from === id || from.startsWith(`${id}/`) || /^react(\/|$)/.test(from) || /\.css$/.test(from);

/**
 * The app's own components that could be the system's.
 *
 * A file that imports nothing but the system, React and its own stylesheet has
 * no hold on this app: moving what it declares is a file move. A file that
 * reaches for an app module declares this app's component, however widely it is
 * rendered. Names the system already ships are left out — those are an import,
 * not a move.
 */
function promotable(sources: string[], exported: string[], id: string): string[] {
  const known = new Set(exported);
  const out = new Set<string>();
  for (const file of sources) {
    const source = readFileSync(file, "utf8");
    if ([...importsIn(source).values()].some((from) => !portable(from, id))) continue;
    for (const name of definedIn(source).keys()) if (!known.has(name)) out.add(name);
  }
  return [...out].sort();
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

/* What the property is a property of. A missing token is missing from a scale,
   and the scale is the useful half of the answer: nine spacings written by hand
   is one gap in the spacing scale, not nine unrelated mistakes. */
const KINDS: [RegExp, Kind][] = [
  [/shadow/, "shadow"],
  [/radius/, "radius"],
  [/^(padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left)/, "spacing"],
  [/^(border|outline)/, "border"],
  [/^(font|line-height|letter-spacing|word-spacing|text-indent)/, "type"],
  [/(width|height|size|flex-basis)/, "size"],
];

const kindOf = (property: string, value: string): Kind => {
  for (const [pattern, kind] of KINDS) if (pattern.test(property)) return kind;
  return COLOR.test(value) ? "colour" : "other";
};

/**
 * Whether a system token holds its value *because of* an app token.
 *
 * An app that declares its ramp and points the contract at it — `--mds-accent:
 * var(--kb-red)` — has two names for one value on purpose, and the app's is the
 * source. Reading that as the app duplicating the system reverses the arrow and
 * asks for the one change that would break it.
 */
function derivesFrom(graph: Graph, system: string, app: string): boolean {
  const seen = new Set<string>();
  const stack = [system];
  while (stack.length > 0) {
    const name = stack.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const reference of graph.get(name)?.references ?? []) {
      if (reference === app) return true;
      stack.push(reference);
    }
  }
  return false;
}

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
  const id = system.components?.id ?? "";
  const shown = whatIsRendered(system.sources, exported, id);
  const rendered = new Set(shown.system.map((u) => u.name));

  /* The system declares tokens on its own components as well as at the root:
     a slot a component reads from itself is still the system's name, and
     calling it undeclared sends someone looking for a bug that is a feature. */
  const scoped = new Set(
    system.components?.stylesheet
      ? declarationsIn(readFileSync(system.components.stylesheet, "utf8"), system.components.stylesheet)
          .map((d) => d.name)
          .filter((name) => name.startsWith(system.prefix))
      : [],
  );

  const spent = new Set<string>();
  const missing: (Place & { name: string })[] = [];
  const invented: Invented[] = [];
  const drift: Drift[] = [];
  const ownReads = new Map<string, number>();
  let references = 0;
  let own = 0;

  /** Every var() in one value, counted against whoever named it. */
  const spend = (value: string, file: string, line: number) => {
    for (const name of referencesIn(value)) {
      if (!name.startsWith(system.prefix)) {
        own += 1;
        ownReads.set(name, (ownReads.get(name) ?? 0) + 1);
        continue;
      }
      if (graph.get(name) !== undefined) {
        spent.add(name);
        references += 1;
      } else if (scoped.has(name)) references += 1;
      else missing.push({ name, file, line });
    }
  };

  /* One pass per app stylesheet: every declaration is either spending a token,
     declaring one, or writing a value the system could have held. */
  const stylesheets = findStylesheets(system.root).filter((file) => !file.startsWith(system.tokens.stylesheet));
  for (const file of stylesheets) {
    const source = readFileSync(file, "utf8");
    for (const block of blocksIn(source)) {
      for (const declaration of block.declarations) {
        spend(declaration.value, file, declaration.line);
        if (declaration.property.startsWith("--")) continue;
        if (!literal(declaration.value)) continue;
        drift.push({
          file,
          line: declaration.line,
          property: declaration.property,
          value: declaration.value.trim(),
          kind: kindOf(declaration.property, declaration.value),
          tokens: holders.get(normalise(declaration.value, map)) ?? [],
        });
      }
    }
    /* A custom property outside the namespace is the app naming something of
       its own — fine in itself, and worth reading twice when the system already
       holds that value without getting it from here. */
    for (const declared of declarationsIn(source, file)) {
      if (declared.name.startsWith(system.prefix)) continue;
      const holder = holders
        .get(normalise(declared.value, map))
        ?.find((name) => !derivesFrom(graph, name, declared.name));
      invented.push({
        name: declared.name,
        value: declared.value.trim(),
        file,
        line: declared.line,
        used: 0,
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
      spend(value, file, declaration.line);
      const property = kebab(declaration.key.replace(/^["'`]|["'`]$/g, ""));
      if (property.startsWith("--")) continue;
      if (!literal(value)) continue;
      drift.push({
        file,
        line: declaration.line,
        property,
        value,
        kind: kindOf(property, value),
        tokens: holders.get(normalise(value, map)) ?? [],
      });
    }
  }

  const place = (a: Place, b: Place) => a.file.localeCompare(b.file) || a.line - b.line;
  drift.sort(place);
  missing.sort(place);
  invented.sort((a, b) => place(a, b) || a.name.localeCompare(b.name));
  for (const token of invented) token.used = ownReads.get(token.name) ?? 0;

  const written = { system: references, own, literal: drift.length };
  const all = written.system + written.own + written.literal;
  return {
    system,
    graph,
    components: {
      exported,
      used: shown.system,
      unused: exported.filter((name) => !rendered.has(name)),
      own: shown.own,
      external: shown.external,
      rebuilt: rebuilt(system.sources, exported, id),
      promotable: promotable(system.sources, exported, id),
    },
    tokens: {
      total: graph.names().filter((name) => name.startsWith(system.prefix)).length,
      repointed: [...new Set(brand.flatMap((file) => repointedIn(file, system.prefix)))].sort(),
      spent: [...spent].sort(),
      missing,
      invented,
    },
    drift,
    written,
    coverage: all === 0 ? 0 : Math.round((written.system / all) * 100),
    brand,
  };
}

/** The system tokens one app stylesheet re-points for the whole document. */
const repointedIn = (file: string, prefix: string): string[] =>
  declarationsIn(readFileSync(file, "utf8"), file)
    .filter((d) => d.name.startsWith(prefix) && rootScoped(d.selector))
    .map((d) => d.name);
