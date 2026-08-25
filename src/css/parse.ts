/* Custom-property declarations out of a stylesheet, each with the place it was
   written. Deliberately not a full CSS parser: it walks braces, keeps the
   at-rule preludes it is nested under, and reads `--name: value` pairs. That
   is the whole surface a token file has. */

export type Theme = "light" | "dark";

export type Declaration = {
  name: string;
  value: string;
  file: string;
  /** 1-based, and the line the name is on. */
  line: number;
  selector: string;
  /** At-rule preludes this declaration sits inside, outermost first. */
  conditions: string[];
  theme: Theme;
};

/** Blanks a comment out in place: the lines after it keep their numbers. */
export const stripComments = (css: string) =>
  css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

const DARK = /\[data-theme=["']?dark["']?\]|prefers-color-scheme:\s*dark/;

/** One declaration as written: not only the custom properties. */
export type Property = { property: string; value: string; line: number };

/**
 * The property a value on this line was written for.
 *
 * Read backwards from where the value sits, because a line may hold several
 * declarations and the first one on it is not always the one being judged.
 * A brace or a semicolon ends the search: neither can appear inside a value.
 */
export const propertyAt = (line: string, at: number): string | undefined =>
  /(--)?([a-zA-Z][-a-zA-Z]*)\s*:[^;{}]*$/.exec(line.slice(0, at))?.[0]?.replace(/\s*:.*$/s, "");

/**
 * One rule block: a selector, what it sits inside, and everything it sets.
 *
 * The layout rules ask questions a flat list of declarations cannot answer —
 * whether the element that pins itself to an edge is the one clearing the
 * safe area, whether a margin is on the component's root or on something
 * inside it. Both are about a block, so a block is what the reader returns.
 */
export type Block = {
  selector: string;
  /** At-rule preludes this block sits inside, outermost first. */
  conditions: string[];
  theme: Theme;
  /** 1-based, the line the selector is on. */
  line: number;
  declarations: Property[];
};

export function blocksIn(source: string): Block[] {
  const css = stripComments(source);
  const out: Block[] = [];
  const stack: Block[] = [];
  let buf = "";
  let bufLine = 1;
  let line = 1;
  let parens = 0;
  let quote: string | undefined;

  const flush = () => {
    const m = /^([-a-z0-9]+)\s*:\s*([\s\S]+)$/i.exec(buf.trim());
    const block = stack[stack.length - 1];
    if (m && block) {
      const property = m[1]!;
      block.declarations.push({
        /* A custom property is case-sensitive; a CSS property is not. */
        property: property.startsWith("--") ? property : property.toLowerCase(),
        value: m[2]!.replace(/\s+/g, " ").trim(),
        line: bufLine,
      });
    }
    buf = "";
  };

  for (const ch of css) {
    if (ch === "\n") line++;
    if (quote !== undefined) {
      if (ch === quote) quote = undefined;
      buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === "(") parens++;
    if (ch === ")") parens--;
    if (parens === 0 && quote === undefined) {
      if (ch === "{") {
        const selector = buf.replace(/\s+/g, " ").trim();
        const conditions = stack.map((b) => b.selector).filter((s) => s.startsWith("@"));
        const scopes = [selector, ...conditions];
        stack.push({
          selector,
          conditions,
          theme: scopes.some((s) => DARK.test(s)) ? "dark" : "light",
          line: bufLine,
          declarations: [],
        });
        buf = "";
        bufLine = line;
        continue;
      }
      if (ch === "}") {
        flush();
        const done = stack.pop();
        if (done) out.push(done);
        bufLine = line;
        continue;
      }
      if (ch === ";") {
        flush();
        bufLine = line;
        continue;
      }
    }
    if (buf === "" && /\s/.test(ch)) {
      bufLine = line;
      continue;
    }
    buf += ch;
  }
  return out;
}

/**
 * The custom-property declarations, in source order.
 *
 * A view of the same reader: a token file is a stylesheet whose declarations
 * happen to all be custom properties, so there is one walker, not two.
 */
export function declarationsIn(source: string, file: string): Declaration[] {
  return blocksIn(source)
    .flatMap((block) =>
      block.declarations
        .filter((d) => d.property.startsWith("--"))
        .map((d) => ({
          name: d.property,
          value: d.value,
          file,
          line: d.line,
          selector: block.selector,
          conditions: block.conditions,
          theme: block.theme,
        })),
    )
    .sort((a, b) => a.line - b.line);
}

/**
 * One flat name-to-value map, as a browser would have it in that theme.
 *
 * Conditional declarations are left out: a media query is a *second* value,
 * not a replacement, and folding it in reports the desktop measure as the one
 * a phone gets. Ask for those through the declarations themselves.
 */
export function flatten(decls: Declaration[], theme: Theme): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of decls) {
    if (d.conditions.length > 0) continue;
    if (d.theme === "dark" && theme !== "dark") continue;
    map.set(d.name, d.value);
  }
  return map;
}
