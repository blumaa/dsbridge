/* The resolver's own math. Every path here is one the design system's own
   defaults may not exercise today but a consuming app's brand file will:
   color-mix, alpha compositing, var() fallbacks, named colors. */
import { describe, expect, it } from "vitest";
import { contrast, parseColor, resolveVars, type TokenMap } from "./color";

const map = (entries: Record<string, string>): TokenMap => new Map(Object.entries(entries));

describe("resolveVars", () => {
  it("follows a chain of aliases to the value at the end", () => {
    const m = map({ "--mds-a": "var(--mds-b)", "--mds-b": "#ff0000" });
    expect(resolveVars("var(--mds-a)", m)).toBe("#ff0000");
  });

  it("takes the fallback when the token is undeclared", () => {
    expect(resolveVars("var(--mds-nope, #00ff00)", map({}))).toBe("#00ff00");
  });

  it("names the token it could not resolve", () => {
    expect(() => resolveVars("var(--mds-nope)", map({}))).toThrow("--mds-nope");
  });

  it("refuses to loop forever on a cycle", () => {
    const m = map({ "--mds-a": "var(--mds-b)", "--mds-b": "var(--mds-a)" });
    expect(() => resolveVars("var(--mds-a)", m)).toThrow(/cycle/);
  });
});

describe("parseColor", () => {
  const m = map({ "--mds-surface-page": "#ffffff" });

  it.each([
    ["#abc", { r: 170, g: 187, b: 204, a: 1 }],
    ["#aabbcc", { r: 170, g: 187, b: 204, a: 1 }],
    ["#00000080", { r: 0, g: 0, b: 0, a: 128 / 255 }],
    ["rgb(1, 2, 3)", { r: 1, g: 2, b: 3, a: 1 }],
    ["rgba(1, 2, 3, 0.5)", { r: 1, g: 2, b: 3, a: 0.5 }],
    ["rgb(1 2 3 / 50%)", { r: 1, g: 2, b: 3, a: 0.5 }],
    ["transparent", { r: 0, g: 0, b: 0, a: 0 }],
    ["white", { r: 255, g: 255, b: 255, a: 1 }],
  ])("reads %s", (input, expected) => {
    const c = parseColor(input, m);
    expect(c.r).toBeCloseTo(expected.r, 5);
    expect(c.g).toBeCloseTo(expected.g, 5);
    expect(c.b).toBeCloseTo(expected.b, 5);
    expect(c.a).toBeCloseTo(expected.a, 5);
  });

  it("mixes toward the midpoint in oklab", () => {
    const mid = parseColor("color-mix(in oklab, #000000, #ffffff)", m);
    expect(mid.r).toBeCloseTo(mid.g, 3);
    expect(mid.g).toBeCloseTo(mid.b, 3);
    expect(mid.r).toBeGreaterThan(90);
    expect(mid.r).toBeLessThan(130);
  });

  it("premultiplies alpha when mixing with transparent", () => {
    const c = parseColor("color-mix(in oklab, #ff0000 50%, transparent)", m);
    expect(c.a).toBeCloseTo(0.5, 5);
    expect(c.r).toBeGreaterThan(250); /* hue survives, only alpha drops */
  });

  it("infers the second weight from the first", () => {
    const quarter = parseColor("color-mix(in oklab, #ffffff 25%, #000000)", m);
    const explicit = parseColor("color-mix(in oklab, #ffffff 25%, #000000 75%)", m);
    expect(quarter.r).toBeCloseTo(explicit.r, 5);
  });

  it("mixes in srgb on the encoded channels", () => {
    const c = parseColor("color-mix(in srgb, #000000 25%, #ffffff)", m);
    expect(c.r).toBeCloseTo(191.25, 2);
    expect(c.a).toBeCloseTo(1, 5);
  });

  it("premultiplies alpha in srgb too", () => {
    const c = parseColor("color-mix(in srgb, #ff0000 50%, transparent)", m);
    expect(c.a).toBeCloseTo(0.5, 5);
    expect(c.r).toBeCloseTo(255, 5);
  });

  it("names a colour space it cannot mix in", () => {
    expect(() => parseColor("color-mix(in lch, #000, #fff)", m)).toThrow(/color-mix in lch/);
  });

  it("resolves var() chains inside a mix", () => {
    const chained = map({ "--mds-base": "#ffffff", "--mds-derived": "color-mix(in oklab, var(--mds-base), #ffffff 100%)" });
    const c = parseColor("var(--mds-derived)", chained);
    expect(c.r).toBeCloseTo(255, 0);
  });

  it("says which value it could not read", () => {
    expect(() => parseColor("chartreuse-ish", m)).toThrow(/chartreuse-ish/);
  });
});

describe("contrast", () => {
  it("puts black on white at 21:1", () => {
    expect(contrast(map({}), "#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("is symmetric", () => {
    const m = map({});
    expect(contrast(m, "#1d4ed8", "#ffffff")).toBeCloseTo(contrast(m, "#ffffff", "#1d4ed8"), 10);
  });

  it("composites a translucent foreground over its background", () => {
    const ratio = contrast(map({}), "rgb(0 0 0 / 0.5)", "#ffffff");
    expect(ratio).toBeGreaterThan(3.5);
    expect(ratio).toBeLessThan(4.5);
  });

  it("composites a translucent background over the backdrop it is given", () => {
    const m = map({ "--ds-soft": "rgb(0 0 0 / 0.1)" });
    /* black text on a 10% black wash over white — near-max contrast */
    expect(contrast(m, "#000000", "--ds-soft", "#ffffff")).toBeGreaterThan(15);
  });

  /* Silence would read as a pass. A translucent surface with nothing stated
     behind it has no ratio, and saying so is the only honest answer. */
  it("refuses to measure a translucent background with no backdrop given", () => {
    expect(() => contrast(map({}), "#000000", "rgb(0 0 0 / 0.1)")).toThrow(/page surface/);
  });

  it("takes token names on either side", () => {
    const m = map({ "--ds-fg": "#000000", "--ds-bg": "#ffffff" });
    expect(contrast(m, "--ds-fg", "--ds-bg")).toBeCloseTo(21, 1);
  });
});
