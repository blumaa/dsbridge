import { describe, expect, it } from "vitest";
import { openingTags, styleDeclarations, textNodes, withoutComments } from "./jsx.js";

describe("reading the style prop", () => {
  it("finds every declaration with the line it is on", () => {
    const source = `const a = (\n  <div style={{ gap: 28, width: 390 }}>\n);`;
    expect(styleDeclarations(source)).toEqual([
      { key: "gap", value: "28", line: 2 },
      { key: "width", value: "390", line: 2 },
    ]);
  });

  it("keeps a declaration split over lines with its own line", () => {
    const source = `<div\n  style={{\n    color: "var(--mds-text-primary)",\n    gap: 4,\n  }}\n/>`;
    expect(styleDeclarations(source).map((d) => [d.key, d.line])).toEqual([
      ["color", 3],
      ["gap", 4],
    ]);
  });

  it("passes over a spread, which is written somewhere else", () => {
    expect(styleDeclarations(`<i style={{ ...vars, ...style }} />`)).toEqual([]);
  });

  it("does not split on a comma or a colon inside a value", () => {
    const source = "<i style={{ font: `var(${token})`, grid: gone ? \"a, b\" : rgb(1, 2, 3) }} />";
    expect(styleDeclarations(source)).toEqual([
      { key: "font", value: "`var(${token})`", line: 1 },
      { key: "grid", value: 'gone ? "a, b" : rgb(1, 2, 3)', line: 1 },
    ]);
  });

  it("reads a custom property key as written", () => {
    const source = '<i style={{ ...({ "--progress": `${n}%` } as CSSProperties) }} />';
    expect(styleDeclarations(source)).toEqual([]);
    expect(styleDeclarations('<i style={{ "--progress": `${n}%` }} />')).toEqual([
      { key: '"--progress"', value: "`${n}%`", line: 1 },
    ]);
  });
});

describe("reading a tag", () => {
  it("gives every attribute with its value as written", () => {
    const [tag] = openingTags(`<button type="submit" onClick={close} disabled />`);
    expect(tag!.name).toBe("button");
    expect(tag!.attributes).toMatchObject([
      { name: "type", value: '"submit"' },
      { name: "onClick", value: "{close}" },
      { name: "disabled" },
    ]);
    expect(tag!.attributes[2]).not.toHaveProperty("value");
  });

  it("keeps a `>` written inside an expression out of the tag", () => {
    const [tag] = openingTags(`<div onKeyDown={(e) => step(e)} aria-label="grid" />`);
    expect(tag!.attributes.map((it) => it.name)).toEqual(["onKeyDown", "aria-label"]);
  });

  it("gives a spread no name, because the caller wrote what is in it", () => {
    const [tag] = openingTags(`<div {...rest} id="x" />`);
    expect(tag!.attributes.map((it) => it.name)).toEqual(["", "id"]);
  });

  it("counts the lines an attribute is on", () => {
    const [tag] = openingTags(`<div\n  id="x"\n  aria-label="y"\n>`);
    expect(tag!.attributes.map((it) => it.line)).toEqual([2, 3]);
  });

  it("reads a generic as a type and not as a tag", () => {
    expect(openingTags(`const ref = useRef<HTMLDivElement>(null);`)).toEqual([]);
  });

  it("reads a tag inside a string as prose about a tag", () => {
    const source = 'throw new Error(`${name} must sit inside <Tabs>`);\nexport interface Props {}';
    expect(openingTags(source)).toEqual([]);
    expect(textNodes(source)).toEqual([]);
  });

  it("passes over a closing tag", () => {
    expect(openingTags(`<span>a</span>`).map((it) => it.name)).toEqual(["span"]);
  });
});

describe("reading the text between tags", () => {
  it("finds the words and the line they are on", () => {
    expect(textNodes(`<div>\n  <span>Loading</span>\n</div>`)).toEqual([{ text: "Loading", line: 2 }]);
  });

  it("gives nothing for an expression", () => {
    expect(textNodes(`<span>{children}</span>`)).toEqual([]);
  });

  it("gives nothing for whitespace between two tags", () => {
    expect(textNodes(`<div>\n  <span />\n</div>`)).toEqual([]);
  });

  it("reads text that runs up to a nested tag", () => {
    expect(textNodes(`<p>Read <a href="/x">more</a></p>`).map((it) => it.text)).toEqual(["Read", "more"]);
  });
});

describe("only what is inside an element", () => {
  it("reads the code after a self-closing tag as code", () => {
    expect(textNodes(`const bar = <Spinner />;\nif (!show) return bar;`)).toEqual([]);
  });

  it("still reads a sibling of a self-closing tag inside a parent", () => {
    expect(textNodes(`<p><Icon />Loading</p>`).map((it) => it.text)).toEqual(["Loading"]);
  });

  it("counts a fragment as an element", () => {
    expect(textNodes(`<>Loading</>`).map((it) => it.text)).toEqual(["Loading"]);
  });
});

describe("markup and code, alternating", () => {
  it("reads the code inside an expression as code", () => {
    const source = "<button>\n  {loading ? (\n    <Spinner />\n  ) : (\n    iconLeft ?? null\n  )}\n</button>";
    expect(textNodes(source)).toEqual([]);
  });

  it("reads the text inside a tag inside an expression as text", () => {
    expect(textNodes("<div>{open ? <p>Hello</p> : null}</div>").map((it) => it.text)).toEqual(["Hello"]);
  });

  it("reads an apostrophe in text as a letter and not as a string", () => {
    expect(textNodes("<p>don't</p>\n<p>Second</p>").map((it) => it.text)).toEqual(["don't", "Second"]);
  });
});

describe("blanking the comments", () => {
  it("takes a line comment out and keeps the line", () => {
    const source = `const a = 1; // <img alt="a cat" />\nconst b = 2;`;
    const blanked = withoutComments(source);
    expect(blanked).toHaveLength(source.length);
    expect(blanked).toMatch(/^const a = 1; +\nconst b = 2;$/);
  });

  it("takes a block comment out and keeps every line it spanned", () => {
    const blanked = withoutComments(`/**\n * <Tag label="Design" />\n */\nconst a = 1;`);
    expect(blanked.split("\n")).toHaveLength(4);
    expect(blanked.trim()).toBe("const a = 1;");
  });

  it("leaves a slash-slash that is inside a string", () => {
    expect(withoutComments(`const url = "https://example.com"; // gone`).trimEnd()).toBe(
      `const url = "https://example.com";`,
    );
  });

  it("gives back a quote that was JSX text, at the end of its line", () => {
    const source = `<p>don't</p>\n/* <img alt="a cat" /> */\nconst a = 1;`;
    expect(withoutComments(source).split("\n")[1]!.trim()).toBe("");
  });
});
