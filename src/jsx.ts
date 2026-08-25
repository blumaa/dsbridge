/* Reading JSX.
 *
 * Two things a rule needs from a component's markup and cannot get from the
 * stylesheet beside it: what is written in the style prop, and what is written
 * into the tags. `style={{ … }}` is CSS in JavaScript, invisible to every
 * stylesheet rule; a word typed into an `aria-label` is copy nobody can
 * translate. Both are read here so the rules stay about policy.
 *
 * This is a scanner and not a parser: enough of the grammar to find the shapes,
 * and a discriminator for the one construct that looks like a tag and is not.
 */

export type StyleDeclaration = {
  /** As written, quotes and all: `gap`, `"--progress"`. */
  key: string;
  /** As written, expression and all. */
  value: string;
  /** 1-based, in the file. */
  line: number;
};

/** The index of the `}` matching the `{` at `open`, honouring strings. */
export function closingBrace(source: string, open: number): number {
  let depth = 0;
  let quote: string | undefined;
  for (let at = open; at < source.length; at += 1) {
    const character = source[at]!;
    if (quote !== undefined) {
      if (character === "\\") at += 1;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return source.length;
}

/** Top-level commas only: a nested object or call keeps its own. */
function parts(body: string): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let at = 0; at < body.length; at += 1) {
    const character = body[at]!;
    if (quote !== undefined) {
      if (character === "\\") at += 1;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") quote = character;
    else if ("{[(".includes(character)) depth += 1;
    else if ("}])".includes(character)) depth -= 1;
    else if (character === "," && depth === 0) {
      out.push({ text: body.slice(start, at), at: start });
      start = at + 1;
    }
  }
  out.push({ text: body.slice(start), at: start });
  return out.filter((part) => part.text.trim() !== "");
}

const splitKey = (text: string): [string, string] | undefined => {
  let depth = 0;
  let quote: string | undefined;
  for (let at = 0; at < text.length; at += 1) {
    const character = text[at]!;
    if (quote !== undefined) {
      if (character === "\\") at += 1;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") quote = character;
    else if ("{[(".includes(character)) depth += 1;
    else if ("}])".includes(character)) depth -= 1;
    else if (character === ":" && depth === 0) return [text.slice(0, at).trim(), text.slice(at + 1).trim()];
  }
  return undefined;
};

/**
 * Every declaration written into a `style={{ … }}` in a file.
 *
 * A spread is not a declaration — `{ ...style }` passes on whatever the caller
 * wrote, and the caller is where that was written and where it is judged.
 */
export function styleDeclarations(source: string): StyleDeclaration[] {
  const out: StyleDeclaration[] = [];
  const opener = /style=\{\s*\{/g;
  for (const match of source.matchAll(opener)) {
    const open = source.indexOf("{", match.index + "style=".length + 1);
    const end = closingBrace(source, open);
    const body = source.slice(open + 1, end);
    for (const part of parts(body)) {
      if (part.text.trim().startsWith("...")) continue;
      const split = splitKey(part.text);
      if (split === undefined) continue;
      const [key, value] = split;
      const at = open + 1 + part.at + part.text.indexOf(key);
      out.push({ key, value, line: source.slice(0, at).split("\n").length });
    }
  }
  return out;
}

/** One attribute, as written. */
export type JsxAttribute = {
  /** `""` for a spread, whose contents were written at the call site. */
  name: string;
  /** As written, quotes or braces and all. Absent for a bare attribute. */
  value?: string;
  /** 1-based, in the file. */
  line: number;
  /** Index of the value in the source, so a finding can point inside it. */
  at?: number;
};

export type JsxTag = {
  name: string;
  /** 1-based, in the file. */
  line: number;
  attributes: JsxAttribute[];
  /** Index just past the tag's `>`: where its content starts. */
  end: number;
  /** `<img />` closes itself, so nothing after it is inside it. */
  selfClosing: boolean;
};

const lineAt = (source: string, at: number) => source.slice(0, at).split("\n").length;

/** The index of the quote closing the one at `open`. */
function quoted(text: string, open: number): number {
  const quote = text[open]!;
  for (let at = open + 1; at < text.length; at += 1) {
    if (text[at] === "\\") at += 1;
    else if (text[at] === quote) return at;
  }
  return text.length - 1;
}

/**
 * A `<` that opens a tag rather than a type argument.
 *
 * `useRef<HTMLDivElement>(null)` has the shape of a tag and is a generic, and
 * the two are told apart by what comes before the bracket: a type argument
 * follows the name it belongs to, so the character is a word character. JSX
 * follows a space, a `(`, a `{`, a `>` or the start of the file.
 */
const opensATag = (source: string, at: number) => !/[\w$)\]]/.test(source[at - 1] ?? " ");

/** Everything between the tag name and the closing `>`, split into attributes. */
function attributesIn(text: string, base: number, source: string): JsxAttribute[] {
  const out: JsxAttribute[] = [];
  let at = 0;
  while (at < text.length) {
    if (/\s|\//.test(text[at]!)) {
      at += 1;
      continue;
    }
    if (text[at] === "{") {
      const end = closingBrace(text, at);
      out.push({ name: "", value: text.slice(at, end + 1), line: lineAt(source, base + at), at: base + at });
      at = end + 1;
      continue;
    }
    const name = /^[A-Za-z_][\w:.$-]*/.exec(text.slice(at));
    if (name === null) {
      at += 1;
      continue;
    }
    const nameAt = at;
    at += name[0].length;
    while (/\s/.test(text[at] ?? "")) at += 1;
    if (text[at] !== "=") {
      out.push({ name: name[0], line: lineAt(source, base + nameAt) });
      continue;
    }
    at += 1;
    while (/\s/.test(text[at] ?? "")) at += 1;
    const valueAt = at;
    if (text[at] === '"' || text[at] === "'") at = quoted(text, at) + 1;
    else if (text[at] === "{") at = closingBrace(text, at) + 1;
    else while (at < text.length && !/\s/.test(text[at]!)) at += 1;
    out.push({
      name: name[0],
      value: text.slice(valueAt, at),
      line: lineAt(source, base + valueAt),
      at: base + valueAt,
    });
  }
  return out;
}

/** The opening tag beginning at `at`, or nothing when it never closes. */
function readTag(source: string, at: number, name: string): JsxTag | undefined {
  const from = at + 1 + name.length;
  let depth = 0;
  let quote: string | undefined;
  for (let index = from; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote !== undefined) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    else if (character === ">" && depth === 0) {
      return {
        name,
        line: lineAt(source, at),
        attributes: attributesIn(source.slice(from, index), from, source),
        end: index + 1,
        selfClosing: source[index - 1] === "/",
      };
    }
  }
  return undefined;
}

/** Where the scanner is: inside an element's content, or inside the `{ … }` of
    an expression, which is code again however deep in the markup it sits. */
type Frame = { kind: "element" } | { kind: "expression"; braces: number };

export type Scanned = { tags: JsxTag[]; texts: { text: string; line: number }[] };

/**
 * One pass over a file: every tag, and every run of text left standing.
 *
 * What the pass is really tracking is where it is. Markup and code alternate —
 * an element holds text, `{ … }` inside it holds code, a tag inside that holds
 * text again — and everything both callers need follows from knowing which of
 * the two the current character is in. Reading it as one flat thing is how
 * `) : null}` gets reported as copy.
 *
 * Strings are passed over in code and not in markup, because they are only
 * strings in one of the two: `<Tabs>` inside an error message is prose about a
 * tag, and the apostrophe in `<p>don't</p>` is a letter. A quote that reaches
 * the end of its line is given back either way — a real string cannot span one.
 */
function scan(source: string): Scanned {
  const tags: JsxTag[] = [];
  const texts: Scanned["texts"] = [];
  const stack: Frame[] = [];
  const top = () => stack[stack.length - 1];
  let quote: string | undefined;
  let at = 0;

  /* The text between the tag that just ended and whatever comes next: another
     tag, or the `{` of an expression, which is somebody else's value. */
  const takeText = (from: number) => {
    if (top()?.kind !== "element") return;
    const rest = source.slice(from);
    const stop = rest.search(/[<{]/);
    const raw = stop === -1 ? rest : rest.slice(0, stop);
    const text = raw.trim();
    if (text !== "") texts.push({ text, line: lineAt(source, from + (raw.length - raw.trimStart().length)) });
  };

  while (at < source.length) {
    const character = source[at]!;
    const inMarkup = top()?.kind === "element";
    if (quote !== undefined) {
      if (character === "\\") at += 2;
      else {
        if (character === quote || (character === "\n" && quote !== "`")) quote = undefined;
        at += 1;
      }
      continue;
    }
    if (!inMarkup && (character === '"' || character === "'" || character === "`")) {
      quote = character;
      at += 1;
      continue;
    }
    if (character === "{" || character === "}") {
      const frame = top();
      if (character === "{" && frame?.kind === "element") stack.push({ kind: "expression", braces: 1 });
      else if (frame?.kind === "expression") {
        frame.braces += character === "{" ? 1 : -1;
        if (frame.braces === 0) {
          stack.pop();
          takeText(at + 1);
        }
      }
      at += 1;
      continue;
    }
    if (character !== "<") {
      at += 1;
      continue;
    }
    const closes = /^<\/(?:[A-Za-z][\w.-]*)?\s*>/.exec(source.slice(at));
    if (closes !== null) {
      if (top()?.kind === "element") stack.pop();
      at += closes[0].length;
      takeText(at);
      continue;
    }
    if (source[at + 1] === ">") {
      stack.push({ kind: "element" });
      at += 2;
      takeText(at);
      continue;
    }
    const name = /^[A-Za-z][\w.-]*/.exec(source.slice(at + 1));
    const tag = name === null || !opensATag(source, at) ? undefined : readTag(source, at, name[0]);
    if (tag === undefined) {
      at += 1;
      continue;
    }
    tags.push(tag);
    if (!tag.selfClosing) stack.push({ kind: "element" });
    at = tag.end;
    takeText(at);
  }
  return { tags, texts };
}

/**
 * Every opening tag in a file, with what was written into it.
 *
 * The tag is walked rather than matched: `onClick={() => x}` puts a `>` inside
 * a tag, so a regex that stops at the first one reads half of it.
 */
export const openingTags = (source: string): JsxTag[] => scan(source).tags;

/** The text a file leaves standing on the page, with the line it is on. */
export const textNodes = (source: string): Scanned["texts"] => scan(source).texts;

/**
 * The same source with every comment blanked out, line numbers kept.
 *
 * A comment is not code, and everything that reads a `.tsx` file — the style
 * prop, the tags, what a component imports — reads what the file *does*. A
 * documented example of the very thing a rule forbids is the commonest way a
 * rule reports a file that is already right.
 *
 * A quote inside JSX text — `don't` — looks like the start of a string to a
 * scanner and is not, so a `'` or `"` that reaches the end of its line is given
 * back: a real string cannot span one, and the mistake stops there.
 */
export function withoutComments(source: string): string {
  let out = "";
  let at = 0;
  let quote: string | undefined;
  while (at < source.length) {
    const character = source[at]!;
    if (quote !== undefined) {
      out += character;
      if (character === "\\") {
        out += source[at + 1] ?? "";
        at += 2;
        continue;
      }
      if (character === quote || (character === "\n" && quote !== "`")) quote = undefined;
      at += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      out += character;
      at += 1;
      continue;
    }
    if (character === "/" && (source[at + 1] === "/" || source[at + 1] === "*")) {
      const line = source[at + 1] === "/";
      const found = line ? source.indexOf("\n", at) : source.indexOf("*/", at + 2);
      const end = found === -1 ? source.length : line ? found : found + 2;
      out += source.slice(at, end).replace(/[^\n]/g, " ");
      at = end;
      continue;
    }
    out += character;
    at += 1;
  }
  return out;
}
