/* Reading declarations out of a stylesheet. Everything downstream — the token
   listing, the contrast gate, every finding that points at a line — is built
   on what this returns, so it records where a value came from, not just what
   it was. */
import { describe, expect, it } from "vitest";
import { blocksIn, declarationsIn, flatten, stripComments } from "./parse";

describe("stripComments", () => {
  it("takes a comment out without moving the lines after it", () => {
    const css = "a {\n/* one\n   two */\n--mds-x: 1px;\n}";
    expect(stripComments(css).split("\n")).toHaveLength(5);
    expect(stripComments(css)).not.toContain("two");
  });
});

describe("declarationsIn", () => {
  it("records name, value, selector and line", () => {
    const decls = declarationsIn(":root {\n  --mds-a: 1px;\n  --mds-b: 2px;\n}", "core.css");
    expect(decls).toEqual([
      { name: "--mds-a", value: "1px", file: "core.css", line: 2, selector: ":root", conditions: [], theme: "light" },
      { name: "--mds-b", value: "2px", file: "core.css", line: 3, selector: ":root", conditions: [], theme: "light" },
    ]);
  });

  it("ignores properties that are not custom", () => {
    expect(declarationsIn(":root { color-scheme: light; --mds-a: 1px; }", "f.css").map((d) => d.name)).toEqual(["--mds-a"]);
  });

  it("keeps a value with its own semicolons and parens intact", () => {
    const [decl] = declarationsIn(":root { --mds-shadow: 0 1px 2px rgb(0 0 0 / 0.1), 0 2px 4px #000; }", "f.css");
    expect(decl?.value).toBe("0 1px 2px rgb(0 0 0 / 0.1), 0 2px 4px #000");
  });

  it("marks a dark scope as dark", () => {
    const decls = declarationsIn(':root { --mds-a: #fff; }\n[data-theme="dark"] { --mds-a: #000; }', "f.css");
    expect(decls.map((d) => d.theme)).toEqual(["light", "dark"]);
  });

  it("reads through a media query and remembers the condition", () => {
    /* layout.css caps the app column only above --mds-bp-md; a parser that
       skips @media reports the uncapped value as the only value there is. */
    const css = ":root { --mds-frame-width: 100%; }\n@media (min-width: 600px) {\n  :root { --mds-frame-width: 430px; }\n}";
    const decls = declarationsIn(css, "layout.css");
    expect(decls).toHaveLength(2);
    expect(decls[1]).toMatchObject({ value: "430px", line: 3, conditions: ["@media (min-width: 600px)"] });
  });

  it("finds a dark scope nested inside a media query", () => {
    const css = '@media (min-width: 600px) {\n  [data-theme="dark"] { --mds-a: #000; }\n}';
    expect(declarationsIn(css, "f.css")[0]).toMatchObject({ theme: "dark", conditions: ["@media (min-width: 600px)"] });
  });

  it("skips a comment holding what looks like a declaration", () => {
    expect(declarationsIn(":root {\n/* --mds-old: 1px; */\n--mds-new: 2px;\n}", "f.css").map((d) => d.name)).toEqual(["--mds-new"]);
  });
});

describe("flatten", () => {
  const decls = declarationsIn(
    ':root { --mds-a: #fff; --mds-b: #eee; }\n[data-theme="dark"] { --mds-a: #000; }',
    "f.css",
  );

  it("gives one map per theme, dark overlaying light", () => {
    expect(flatten(decls, "light").get("--mds-a")).toBe("#fff");
    expect(flatten(decls, "dark").get("--mds-a")).toBe("#000");
    expect(flatten(decls, "dark").get("--mds-b")).toBe("#eee");
  });

  it("lets the last declaration win, as the cascade does", () => {
    const twice = declarationsIn(":root { --mds-a: 1px; }\n:root { --mds-a: 2px; }", "f.css");
    expect(flatten(twice, "light").get("--mds-a")).toBe("2px");
  });

  it("leaves a conditional value out of the unconditional map", () => {
    /* A media query is a second value, not a replacement. Folding it in would
       report the desktop measure as the value a phone gets. */
    const css = ":root { --mds-frame-width: 100%; }\n@media (min-width: 600px) { :root { --mds-frame-width: 430px; } }";
    expect(flatten(declarationsIn(css, "f.css"), "light").get("--mds-frame-width")).toBe("100%");
  });
});

describe("blocksIn", () => {
  const blocks = blocksIn;

  it("reads every declaration in a rule, not only the custom properties", () => {
    const [block] = blocks(".bar {\n  position: fixed;\n  --mds-x: 1px;\n}");
    expect(block?.selector).toBe(".bar");
    expect(block?.declarations).toEqual([
      { property: "position", value: "fixed", line: 2 },
      { property: "--mds-x", value: "1px", line: 3 },
    ]);
  });

  it("keeps the at-rules a block sits inside", () => {
    const [block] = blocks("@media (min-width: 600px) {\n  .bar {\n    top: 0;\n  }\n}");
    expect(block?.conditions).toEqual(["@media (min-width: 600px)"]);
    expect(block?.selector).toBe(".bar");
  });

  it("survives a value with braces or a semicolon in a string", () => {
    const [block] = blocks('.a { content: ";"; background: url(a;b.png); }');
    expect(block?.declarations.map((d) => d.property)).toEqual(["content", "background"]);
  });

  it("gives every block the line its selector is on", () => {
    const [first, second] = blocks(".a {\n  top: 0;\n}\n\n.b {\n  top: 1px;\n}");
    expect(first?.line).toBe(1);
    expect(second?.line).toBe(5);
  });
});
