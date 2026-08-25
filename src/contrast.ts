/* The accessibility contract, re-proved against what actually ships.
 *
 * A design system proves its own defaults meet WCAG. An app then re-points the
 * colours with a brand file, and nothing re-establishes that proof: the
 * package's own test still passes, on values the app does not render. This is
 * the gap that closes it, and it is the reason the tool resolves colours at all
 * rather than pattern-matching them.
 *
 * Every pair here is found by shape rather than declared: a rule that sets a
 * text colour and a surface under it is a pair, wherever it was written. A tool
 * that needed the design system to publish a list of pairs would be a tool for
 * the one design system that publishes one.
 */
import { readFileSync } from "node:fs";
import { blocksIn, type Block, type Theme } from "./css/parse.js";
import { contrast, parseColor, type TokenMap } from "./css/color.js";
import { expandImports } from "./graph.js";
import { rootScoped } from "./sources.js";
import type { Usage } from "./usage.js";

const THEMES: Theme[] = ["light", "dark"];

/** WCAG 2.2: 4.5:1 for body text, 3:1 once the text is large. */
const NORMAL = 4.5;
const LARGE = 3;

export type Pair = {
  /** Whose stylesheet wrote it. The system's own pairs are the ones a brand
      silently invalidates, so they are worth telling apart. */
  where: "system" | "app";
  file: string;
  line: number;
  selector: string;
  /** As written, so the fix is findable. */
  fg: string;
  bg: string;
  /** The surface came from the document rather than from this rule. */
  inherited: boolean;
  needs: number;
  ratio: Partial<Record<Theme, number>>;
  fails: Theme[];
  /** Tokens in this pair that the app re-points: who owns the failure. */
  repointed: string[];
  /** Why no ratio could be had. Present only on an unmeasured pair. */
  unmeasured?: string;
  /** Why WCAG does not ask this pair to pass. Present only on an exempt pair. */
  exempt?: string;
};

/** Text laid over whatever is behind it, bringing no surface of its own. */
export type OverMedia = {
  file: string;
  line: number;
  selector: string;
  property: string;
  value: string;
};

export type Contrast = {
  /** Pairs that produced a ratio. */
  pairs: Pair[];
  /** Of those, the ones below their threshold, worst first. */
  failing: Pair[];
  /** Measured, below the threshold, and not asked to pass: an inactive control.
      Shown rather than counted, because a low ratio is still worth seeing. */
  exempt: Pair[];
  /** Pairs found and not measurable, each with the reason. Never silent: a pair
      dropped without a word is read as a pair that passed. */
  unmeasured: Pair[];
  overMedia: OverMedia[];
  measured: number;
  /** What the document paints behind everything, per theme, as written. */
  surface: Partial<Record<Theme, string>>;
};

/* ── reading a block ─────────────────────────────────────────────────────── */

const last = <T,>(items: T[]): T | undefined => items[items.length - 1];

const declaredIn = (block: Block, property: string) =>
  last(block.declarations.filter((d) => d.property === property));

/* WCAG 1.4.3 exempts text that is part of an inactive control: a disabled
   button is meant to read as unavailable, and counting it as a failure buries
   the pairs a person can act on. Exempt is not the same as dropped. */
/** Close enough to its background to be unreadable — a ratio no shipped UI has. */
const INDISTINGUISHABLE = 1.1;

const INACTIVE = /:disabled\b|\[disabled\]|\[aria-disabled=["']?true["']?\]/;

/** Paint the reader has to see through nothing. */
const BACKGROUNDS = ["background-color", "background"];

/** A value painting no colour at all. */
const NOTHING = new Set(["none", "transparent", "initial", "unset", "inherit", "currentcolor", "0"]);

/** Out of flow, so it is laid over what is behind it rather than following it. */
const OVER = new Set(["absolute", "fixed", "sticky"]);

/** A surface of the box's own: a scrim, a fill, a blur, or an outline drawn
    around the letters themselves. */
const BACKING = new Set([
  "background",
  "background-color",
  "background-image",
  "backdrop-filter",
  "-webkit-backdrop-filter",
  "text-shadow",
  "-webkit-text-stroke",
  "-webkit-text-stroke-color",
]);

/** A pointer or a keyboard is on it right now, which is not how it sits at
    rest — and at rest is when it has to be readable. */
const STATE = /:(hover|active|focus|focus-visible|focus-within|target)\b/;

/** Whether a value stands for a colour of its own at all. */
const paints = (value: string): boolean => !NOTHING.has(value.trim().toLowerCase());

/** Whether a value resolves to a colour in this theme. */
function isColour(value: string, map: TokenMap): boolean {
  if (!paints(value)) return false;
  try {
    parseColor(value, map);
    return true;
  } catch {
    return false;
  }
}

const px = (value: string): number | undefined => {
  const match = /(-?\d*\.?\d+)(px|rem|em|pt)?/.exec(value.trim());
  if (match === null) return undefined;
  const size = Number(match[1]);
  const unit = match[2] ?? "px";
  /* 16px to the rem is the browser default and the only figure available
     without running the page. */
  return unit === "px" ? size : unit === "pt" ? (size * 4) / 3 : size * 16;
};

/** WCAG's large text: 24px, or 18.66px once it is bold. */
function threshold(block: Block): number {
  const size = px(declaredIn(block, "font-size")?.value ?? "");
  if (size === undefined) return NORMAL;
  const weight = declaredIn(block, "font-weight")?.value.trim() ?? "";
  const bold = weight === "bold" || Number(weight) >= 700;
  if (size >= 24) return LARGE;
  return bold && size >= 18.66 ? LARGE : NORMAL;
}

/* ── the document's own surface ──────────────────────────────────────────── */

type Sheet = { file: string; where: "system" | "app"; blocks: Block[] };

/**
 * What the page paints behind everything, per theme.
 *
 * Text that declares no surface of its own sits on this, and a translucent
 * scrim is composited over it. Read from the stylesheets rather than assumed to
 * be white: an app whose page is dark and whose tool assumes white is told its
 * light text fails when it is the only thing that passes.
 */
function documentSurface(sheets: Sheet[], maps: Record<Theme, TokenMap>): Partial<Record<Theme, string>> {
  const out: Partial<Record<Theme, string>> = {};
  for (const sheet of sheets) {
    for (const block of sheet.blocks) {
      if (!rootScoped(block.selector)) continue;
      for (const property of BACKGROUNDS) {
        const declared = declaredIn(block, property);
        if (declared === undefined) continue;
        for (const theme of THEMES) {
          /* A block written under a dark scope states the dark surface only. */
          if (block.theme === "dark" && theme !== "dark") continue;
          if (isColour(declared.value, maps[theme])) out[theme] = declared.value.trim();
        }
      }
    }
  }
  return out;
}

/* ── what is behind a rule that paints no surface ────────────────────────── */

/** The parts of a selector, nearest ancestor first: `.panel .label` → `.panel`. */
function ancestorsOf(selector: string): string[] {
  const one = selector.split(",")[0]!.trim();
  const parts = one.split(/\s*[>+~]\s*|\s+/).filter((part) => part.length > 0);
  return parts.slice(0, -1).reverse();
}

/**
 * The surface an ancestor named in the selector paints.
 *
 * `.panel .label` is only ever rendered inside `.panel`, so what `.panel`
 * paints is written down two rules up. Reaching for the page surface instead
 * measures a pair the app never renders — and then reports it as a failure.
 */
function ancestorSurface(
  selector: string,
  sheets: Sheet[],
  maps: Record<Theme, TokenMap>,
): string | undefined {
  for (const ancestor of ancestorsOf(selector)) {
    let found: string | undefined;
    for (const sheet of sheets) {
      for (const block of sheet.blocks) {
        if (!block.selector.split(",").some((part) => part.trim() === ancestor)) continue;
        const declared = last(
          BACKGROUNDS.map((property) => declaredIn(block, property)).filter((d) => d !== undefined),
        );
        if (declared === undefined) continue;
        if (isColour(declared.value, maps.light) || isColour(declared.value, maps.dark)) {
          found = declared.value.trim();
        }
      }
    }
    if (found !== undefined) return found;
  }
  return undefined;
}

/* ── the measurement ─────────────────────────────────────────────────────── */

const referencesIn = (value: string): string[] =>
  [...value.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((m) => m[1]!);

export function measureContrast(usage: Usage): Contrast {
  const maps: Record<Theme, TokenMap> = {
    light: usage.graph.map("light"),
    dark: usage.graph.map("dark"),
  };
  const read = (file: string, where: "system" | "app"): Sheet => ({
    file,
    where,
    blocks: blocksIn(readFileSync(file, "utf8")),
  });
  /* Expanded, because a system's entry stylesheet is usually nothing but
     `@import` lines: reading that one file finds no rules at all — not the
     surface the system paints on `body`, not a component styled next door. */
  const system = [usage.system.tokens.stylesheet, usage.system.components?.stylesheet]
    .filter((file): file is string => file !== undefined)
    .flatMap((entry) => expandImports(entry));
  /* The system first and the app after it, which is the order a browser loads
     them and therefore the order the document's surface is decided in. */
  const sheets = [
    ...system.map((file) => read(file, "system")),
    ...usage.system.stylesheets.map((file) => read(file, "app")),
  ];
  const surface = documentSurface(sheets, maps);
  const repointed = new Set(usage.tokens.repointed);

  const pairs: Pair[] = [];
  const unmeasured: Pair[] = [];
  const overMedia: OverMedia[] = [];

  for (const sheet of sheets) {
    for (const block of sheet.blocks) {
      /* `inherit` and `currentcolor` paint nothing of their own: the pair belongs
         to whichever ancestor set the colour, and a pair made here would be one
         nobody wrote. */
      const written = declaredIn(block, "color");
      const paint = written !== undefined && paints(written.value) ? written : undefined;
      const positioned = OVER.has(declaredIn(block, "position")?.value.trim() ?? "");
      const backed = block.declarations.some(
        (d) => BACKING.has(d.property) && paints(d.value),
      );

      /* No ratio exists against a photograph: the surface under the text is
         whatever picture the app was handed that day. The only thing that can
         be asked for is that the box brings a surface of its own. */
      if (paint !== undefined && positioned && !backed && !STATE.test(block.selector)) {
        overMedia.push({
          file: sheet.file,
          line: paint.line,
          selector: block.selector,
          property: paint.property,
          value: paint.value.trim(),
        });
        continue;
      }
      if (paint === undefined) continue;

      const declared = last(BACKGROUNDS.map((property) => declaredIn(block, property)).filter((d) => d !== undefined));
      const base: Omit<Pair, "ratio" | "fails"> = {
        where: sheet.where,
        file: sheet.file,
        line: paint.line,
        selector: block.selector,
        fg: paint.value.trim(),
        bg: "",
        inherited: false,
        needs: threshold(block),
        repointed: [],
      };

      if (declared !== undefined && !isColour(declared.value, maps.light) && !isColour(declared.value, maps.dark)) {
        unmeasured.push({
          ...base,
          bg: declared.value.trim(),
          ratio: {},
          fails: [],
          unmeasured: `${declared.property} paints no colour to measure against — ${declared.value.trim()}`,
        });
        continue;
      }

      let bg: string;
      const ancestor = declared === undefined ? ancestorSurface(block.selector, sheets, maps) : undefined;
      if (declared !== undefined) bg = declared.value.trim();
      else if (ancestor !== undefined) bg = ancestor;
      else {
        const inherited = surface.light ?? surface.dark;
        if (inherited === undefined) {
          unmeasured.push({
            ...base,
            ratio: {},
            fails: [],
            unmeasured: "no surface is declared for the document, so there is nothing under this text to measure",
          });
          continue;
        }
        bg = inherited;
        base.inherited = true;
      }

      base.bg = bg;
      base.repointed = [...referencesIn(base.fg), ...referencesIn(bg)].filter((name) => repointed.has(name));

      const ratio: Partial<Record<Theme, number>> = {};
      let failed: string | undefined;
      for (const theme of THEMES) {
        /* A block written under the dark scope says nothing about light. */
        if (block.theme === "dark" && theme !== "dark") continue;
        /* An inherited surface is per theme; a surface the rule declares itself
           is the same value in both, and sits on the page like anything else. */
        const behind = base.inherited ? (surface[theme] ?? bg) : bg;
        try {
          ratio[theme] = contrast(maps[theme], base.fg, behind, surface[theme] ?? surface.light);
        } catch (error) {
          failed = (error as Error).message;
          break;
        }
      }
      if (failed !== undefined) {
        unmeasured.push({ ...base, ratio: {}, fails: [], unmeasured: failed });
        continue;
      }
      /* Text is never painted the colour of the surface it sits on, and nothing
         ships text a shade away from invisible either. Landing on its own
         assumed surface is the assumption failing, not the colours: the text is
         rendered somewhere this file does not say. One theme settles it — the
         rule is rendered in one place, so a surface that hides it in either
         theme is the wrong surface for the rule, and the other theme's healthy
         ratio was measured against that same wrong thing. */
      const measuredValues = THEMES.map((theme) => ratio[theme]).filter((r) => r !== undefined);
      if (base.inherited && measuredValues.some((r) => r! <= INDISTINGUISHABLE)) {
        unmeasured.push({
          ...base,
          ratio: {},
          fails: [],
          unmeasured:
            "it paints the surface it was measured against, near enough to be invisible on it, so this text is rendered on something else",
        });
        continue;
      }

      const fails = THEMES.filter((theme) => ratio[theme] !== undefined && ratio[theme]! < base.needs);
      const inactive = INACTIVE.test(block.selector);
      pairs.push({
        ...base,
        ratio,
        fails,
        ...(inactive ? { exempt: "an inactive control, which WCAG 1.4.3 does not ask to pass" } : {}),
      });
    }
  }

  const worst = (pair: Pair) => Math.min(...pair.fails.map((theme) => pair.ratio[theme]!));
  return {
    pairs,
    failing: pairs
      .filter((pair) => pair.fails.length > 0 && pair.exempt === undefined)
      .sort((a, b) => worst(a) - worst(b)),
    exempt: pairs.filter((pair) => pair.fails.length > 0 && pair.exempt !== undefined),
    unmeasured,
    overMedia,
    measured: pairs.length,
    surface,
  };
}
