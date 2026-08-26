import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { discover } from "./discover.js";
import { measure } from "./usage.js";

const APP = resolve(import.meta.dirname, "__fixtures__", "usage", "app");
const usage = measure(discover(APP));
const named = (name: string) => usage.components.used.find((c) => c.name === name);

describe("the components the app renders", () => {
  it("counts every place a system component is rendered", () => {
    expect(named("Button")?.count).toBe(3);
    expect(named("Card")?.count).toBe(1);
  });

  it("counts a renamed import under the name the system gave it", () => {
    expect(named("Card")?.files.map((f) => f.split("/").pop())).toEqual(["App.tsx"]);
  });

  /* The app rebuilt one. Counting `<Chip>` because the system also exports a
     Chip would report the system as used in the one place it was replaced. */
  it("does not count a component of the app's own that shares a name", () => {
    expect(named("Chip")).toBeUndefined();
    expect(usage.components.unused).toContain("Chip");
  });

  it("names what the app installed and never rendered", () => {
    expect(usage.components.unused).toEqual(["Chip", "Sheet", "Stack", "Text"]);
  });

  /* The question is not how many components are rendered, it is how many of
     them the design system is answering for. */
  it("counts the app's own components apart from the system's", () => {
    expect(usage.components.own.map((c) => c.name)).toEqual(["Badge", "Chip", "Feed"]);
    expect(usage.components.used.map((c) => c.name)).toEqual(["Button", "Card"]);
    expect(usage.components.external).toEqual([]);
  });

  it("counts a DOM element as nobody's component", () => {
    const names = [...usage.components.own, ...usage.components.external].map((c) => c.name);
    expect(names).not.toContain("div");
  });

  /* A file that imports the system and declares a Button is wrapping one. A
     file that declares a Button and imports nothing built a second one, and
     that is a file that could be an import. */
  it("names an app component the system already exports by that name", () => {
    expect(usage.components.rebuilt.map((c) => c.name)).toEqual(["Chip"]);
    expect(usage.components.rebuilt[0]!.file.endsWith("Chip.tsx")).toBe(true);
  });

  /* A component whose file reaches for nothing but the system could be the
     system's. One that reaches for an app module is this app's, however often
     it is rendered, and one the system already ships is an import rather than
     a move. */
  it("names the app's own components that could move into the system", () => {
    expect(usage.components.promotable).toEqual(["Badge"]);
  });
});

describe("the tokens the app spends and declares", () => {
  it("names the system tokens the app re-points", () => {
    expect(usage.tokens.repointed).toEqual(["--acme-color-accent"]);
  });

  it("names the system tokens the app spends", () => {
    expect(usage.tokens.spent).toEqual([
      "--acme-color-text",
      "--acme-space-1",
      "--acme-space-2",
    ]);
  });

  it("reports a var() the system has no token for", () => {
    expect(usage.tokens.missing.map((m) => m.name)).toEqual(["--acme-color-missing"]);
    expect(usage.tokens.missing[0]?.file.endsWith("thing.module.css")).toBe(true);
  });

  /* The system declares slots on its own components, never at the root. A
     token read from one is declared — somewhere the root cannot see. */
  it("does not call a token the system declares on a component undeclared", () => {
    expect(usage.tokens.missing.map((m) => m.name)).not.toContain("--acme-icon-slot");
  });

  /* A token nothing reads is not a token, it is a line in a file. */
  it("counts how often the app reads a token of its own", () => {
    const own = new Map(usage.tokens.invented.map((t) => [t.name, t.used]));
    expect(own.get("--app-panel-bg")).toBe(1);
    expect(own.get("--app-shadow")).toBe(0);
  });

  /* A token of the app's own is not wrong. A token of the app's own holding a
     value the system already names is the same decision made twice. */
  it("names the tokens the app invented, and which of them the system already had", () => {
    expect(usage.tokens.invented.map((t) => t.name)).toEqual([
      "--app-gap",
      "--app-panel-bg",
      "--app-shadow",
      "--app-logo",
      "--app-inset",
      "--app-icon",
      "--app-slot",
    ]);
    const duplicates = usage.tokens.invented.filter((t) => t.duplicates !== undefined);
    expect(duplicates.map((t) => [t.name, t.duplicates])).toEqual([
      ["--app-gap", "--acme-space-2"],
      ["--app-panel-bg", "--acme-color-surface"],
      ["--app-inset", "--acme-space-2"],
    ]);
  });

  /* Value equality is not duplication. On an eight-point grid two scales will
     both hold 8px, and what tells them apart is the property each is read
     into: the system spends --acme-space-2 on padding, and --app-logo is a
     height. Nothing reads --app-gap, so nothing contradicts the match. */
  it("does not call a token a duplicate when the two are read into different properties", () => {
    const duplicates = new Map(usage.tokens.invented.map((t) => [t.name, t.duplicates]));
    expect(duplicates.get("--app-logo")).toBeUndefined();
    expect(duplicates.get("--app-icon")).toBeUndefined();
    expect(duplicates.get("--app-inset")).toBe("--acme-space-2");
    expect(duplicates.get("--app-gap")).toBe("--acme-space-2");
  });

  /* One token holding another is a rename, not a use: what --app-icon is for
     is whatever the token reading it is for. */
  it("reads a token's use through the token that renames it", () => {
    const duplicates = new Map(usage.tokens.invented.map((t) => [t.name, t.duplicates]));
    expect(duplicates.get("--app-icon")).toBeUndefined();
  });
});

describe("the values written past the system", () => {
  it("finds every literal the app writes, in CSS and in a style prop alike", () => {
    expect(usage.drift.map((d) => `${d.property}: ${d.value}`)).toEqual([
      "padding: 12px",
      "padding: 12px",
      "margin: 8px",
      "border-radius: 3px",
      "color: #0088ff",
      "font-size: 12px",
      "height: 8px",
    ]);
  });

  it("names the token that already holds the value, where one does", () => {
    const written = new Map(usage.drift.map((d) => [`${d.property}: ${d.value}`, d.tokens]));
    expect(written.get("padding: 12px")).toEqual(["--acme-space-3"]);
    expect(written.get("margin: 8px")).toEqual(["--acme-space-2"]);
    expect(written.get("border-radius: 3px")).toEqual([]);
  });

  /* The same eight pixels, and the system holds them for padding. Offering a
     spacing token to a height is offering the wrong scale. */
  it("offers nothing for a length the system holds for another kind of property", () => {
    const written = new Map(usage.drift.map((d) => [`${d.property}: ${d.value}`, d.tokens]));
    expect(written.get("height: 8px")).toEqual([]);
  });

  /* Nothing anywhere reads --acme-space-3, so the only thing that says what it
     is for is its name, and a spacing is not a font size. */
  it("takes a token's own name for what it is for, where nothing reads it", () => {
    const written = new Map(usage.drift.map((d) => [`${d.property}: ${d.value}`, d.tokens]));
    expect(written.get("padding: 12px")).toEqual(["--acme-space-3"]);
    expect(written.get("font-size: 12px")).toEqual([]);
  });

  /* The brand re-pointed the accent, so the app's hard-coded copy is the value
     the system used to have. Offering it as a match would send the app back. */
  it("offers nothing for a value the system no longer holds", () => {
    expect(usage.drift.find((d) => d.value === "#0088ff")?.tokens).toEqual([]);
  });

  it("leaves alone what no token could hold", () => {
    const written = usage.drift.map((d) => d.value);
    expect(written).not.toContain("0");
    expect(written).not.toContain("100%");
  });

  it("points at the file and the line", () => {
    const first = usage.drift[0]!;
    expect(first.file.endsWith("App.tsx")).toBe(true);
    expect(first.line).toBe(9);
  });
});

describe("where every value the app writes came from", () => {
  /* The whole report in three numbers: four values read a system token, five
     read a token of the app's own, seven went through no token at all. */
  it("counts the system, the app's own tokens and the literals apart", () => {
    expect(usage.written).toEqual({ system: 4, own: 5, literal: 7 });
  });

  it("is the share of written values that came from the system", () => {
    expect(usage.coverage).toBe(25);
  });

  /* A token of the app's own is not the design system, however tidy it is. */
  it("does not count a token of the app's own as coming through the system", () => {
    expect(usage.tokens.spent).not.toContain("--app-panel-bg");
  });

  /* Nine spacings written by hand is one gap in the spacing scale, not nine
     unrelated mistakes. */
  it("says what kind of value went through no token", () => {
    expect(usage.drift.map((d) => d.kind)).toEqual([
      "spacing",
      "spacing",
      "spacing",
      "radius",
      "colour",
      "type",
      "size",
    ]);
  });
});
