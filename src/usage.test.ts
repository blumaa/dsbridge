import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { discover } from "./discover.js";
import { measure } from "./usage.js";

const APP = resolve(import.meta.dirname, "__fixtures__", "usage", "app");
const usage = measure(discover(APP));
const named = (name: string) => usage.components.used.find((c) => c.name === name);

describe("the components the app renders", () => {
  it("counts every place a system component is rendered", () => {
    expect(named("Button")?.count).toBe(2);
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

  /* A token of the app's own is not wrong. A token of the app's own holding a
     value the system already names is the same decision made twice. */
  it("names the tokens the app invented, and which of them the system already had", () => {
    expect(usage.tokens.invented.map((t) => t.name)).toEqual([
      "--app-gap",
      "--app-panel-bg",
      "--app-shadow",
    ]);
    const duplicates = usage.tokens.invented.filter((t) => t.duplicates !== undefined);
    expect(duplicates.map((t) => [t.name, t.duplicates])).toEqual([
      ["--app-gap", "--acme-space-2"],
      ["--app-panel-bg", "--acme-color-surface"],
    ]);
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
    ]);
  });

  it("names the token that already holds the value, where one does", () => {
    const byValue = new Map(usage.drift.map((d) => [d.value, d.tokens]));
    expect(byValue.get("12px")).toEqual(["--acme-space-3"]);
    expect(byValue.get("8px")).toEqual(["--acme-space-2"]);
    expect(byValue.get("3px")).toEqual([]);
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

describe("the headline", () => {
  /* Three values come through the system and five are written past it. */
  it("is the share of written values that came from the system", () => {
    expect(usage.coverage).toBe(38);
  });
});
