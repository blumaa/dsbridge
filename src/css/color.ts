/* Color resolution over a token map: hex, rgb()/rgba(), transparent, var()
   chains with fallbacks, color-mix(in oklab or srgb) with premultiplied alpha, and
   WCAG contrast with alpha compositing.

   The map is flat and lazy — a value is resolved at lookup, which is what the
   browser does per scope, so a dark block that re-points one token in a chain
   re-points everything derived from it without the chain being rebuilt. */

export type RGBA = { r: number; g: number; b: number; a: number };
/** Declared name to raw declared value, one theme scope flattened. */
export type TokenMap = Map<string, string>;

const MAX_DEPTH = 32;

export function resolveVars(value: string, map: TokenMap, depth = 0): string {
  if (depth > MAX_DEPTH) throw new Error(`var() cycle in: ${value}`);
  return value.replace(/var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)/gi, (_, name: string, fallback?: string) => {
    const next = map.get(name) ?? fallback;
    if (next === undefined) throw new Error(`undefined token ${name}`);
    return resolveVars(next, map, depth + 1);
  });
}

function hex(s: string): RGBA | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (!m) return null;
  const h = m[1]!;
  const pick = (i: number, len: number) =>
    len <= 4 ? parseInt(h[i]! + h[i]!, 16) : parseInt(h.slice(i * 2, i * 2 + 2), 16);
  const a = h.length === 4 ? pick(3, 4) / 255 : h.length === 8 ? pick(3, 8) / 255 : 1;
  return { r: pick(0, h.length), g: pick(1, h.length), b: pick(2, h.length), a };
}

function rgbFn(s: string): RGBA | null {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.%]+))?\s*\)$/.exec(s);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a };
}

export const srgbToLin = (c: number) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};

const linToSrgb = (x: number) => {
  const c = x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, c * 255));
};

function toOklab({ r, g, b }: RGBA): [number, number, number] {
  const [lr, lg, lb] = [srgbToLin(r), srgbToLin(g), srgbToLin(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, A, B]: [number, number, number], a: number): RGBA {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: linToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a,
  };
}

/** color-mix(in oklab, C1 p1%, C2 p2%) — premultiplied alpha, per spec. */
function mixOklab(c1: RGBA, w1: number, c2: RGBA, w2: number): RGBA {
  const a = w1 * c1.a + w2 * c2.a;
  const [l1, a1, b1] = toOklab(c1);
  const [l2, a2, b2] = toOklab(c2);
  const pm = (x1: number, x2: number) => (a === 0 ? 0 : (w1 * c1.a * x1 + w2 * c2.a * x2) / a);
  return fromOklab([pm(l1, l2), pm(a1, a2), pm(b1, b2)], a);
}

/** color-mix(in srgb, …) — the same premultiplied mix, on the encoded channels. */
function mixSrgb(c1: RGBA, w1: number, c2: RGBA, w2: number): RGBA {
  const a = w1 * c1.a + w2 * c2.a;
  const pm = (x1: number, x2: number) => (a === 0 ? 0 : (w1 * c1.a * x1 + w2 * c2.a * x2) / a);
  return { r: pm(c1.r, c2.r), g: pm(c1.g, c2.g), b: pm(c1.b, c2.b), a };
}

/** Split "A 30%, B" style args at top-level commas. */
export function splitArgs(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

const NAMED: Record<string, RGBA> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
};

export function parseColor(value: string, map: TokenMap): RGBA {
  const v = resolveVars(value, map).trim();
  const named = NAMED[v.toLowerCase()];
  if (named) return named;
  const h = hex(v);
  if (h) return h;
  const rgb = rgbFn(v);
  if (rgb) return rgb;
  const mix = /^color-mix\(\s*in\s+([a-z-]+)\s*,(.+)\)$/s.exec(v);
  if (mix) {
    const space = mix[1]!;
    const blend = space === "oklab" ? mixOklab : space === "srgb" ? mixSrgb : undefined;
    if (blend === undefined) throw new Error(`color-mix in ${space} is not supported: ${v}`);
    const [p1, p2] = splitArgs(mix[2]!);
    if (!p1 || !p2) throw new Error(`color-mix needs two colors: ${v}`);
    const weighted = (part: string): { color: string; pct: number | null } => {
      const m = /^(.*?)\s+([\d.]+)%$/s.exec(part);
      return m ? { color: m[1]!.trim(), pct: +m[2]! / 100 } : { color: part, pct: null };
    };
    const A = weighted(p1);
    const B = weighted(p2);
    const wA = A.pct ?? (B.pct !== null ? 1 - B.pct : 0.5);
    const wB = B.pct ?? 1 - wA;
    return blend(parseColor(A.color, map), wA, parseColor(B.color, map), wB);
  }
  throw new Error(`unreadable color: "${value}" -> "${v}"`);
}

export const luminance = ({ r, g, b }: RGBA) =>
  0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);

export const composite = (fg: RGBA, bg: RGBA): RGBA => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

/**
 * WCAG 2.x contrast ratio. Either side may be a token name or a literal.
 * A translucent background is composited over the backdrop before the
 * foreground is composited over it — the ratio a reader actually sees.
 *
 * The backdrop is passed in rather than named here: it is whatever the app
 * paints behind everything, and a colour module that knew one design system's
 * name for it would be a colour module for one design system.
 */
export function contrast(map: TokenMap, fg: string, bg: string, backdrop?: string): number {
  let back = parseColor(map.get(bg) ?? bg, map);
  if (back.a < 1) {
    if (backdrop === undefined) {
      throw new Error(`translucent ${bg} needs the page surface behind it to be measured`);
    }
    back = composite(back, parseColor(map.get(backdrop) ?? backdrop, map));
  }
  const front = composite(parseColor(map.get(fg) ?? fg, map), back);
  const [l1, l2] = [luminance(front), luminance(back)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}
