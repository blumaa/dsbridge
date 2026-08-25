import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { discover } from "./discover.js";
import { measure } from "./usage.js";
import { measureContrast } from "./contrast.js";

const APP = resolve(import.meta.dirname, "__fixtures__", "contrast", "app");
const found = measureContrast(measure(discover(APP)));
const pair = (selector: string) => found.pairs.find((p) => p.selector === selector);

describe("the pairs the design system itself writes", () => {
  /* The whole reason this exists. The system proved its own defaults, the app
     re-pointed one of them, and nothing re-ran the proof on what ships. */
  it("re-measures the system's own components under the app's brand", () => {
    const button = pair(".acme-Button__root");
    expect(button?.where).toBe("system");
    expect(button?.fails).toContain("light");
    expect(button?.ratio.light).toBeLessThan(2);
  });

  it("names the token the app re-pointed, so the failure has an owner", () => {
    expect(pair(".acme-Button__root")?.repointed).toEqual(["--acme-color-accent"]);
  });

  it("leaves the pair the brand never touched alone", () => {
    const card = pair(".acme-Card__root");
    expect(card?.fails).toEqual([]);
    expect(card?.ratio.light).toBeCloseTo(18.88, 1);
  });
});

describe("the pairs the app writes", () => {
  it("measures text with no surface of its own against the document surface", () => {
    const note = pair(".note");
    expect(note?.where).toBe("app");
    expect(note?.inherited).toBe(true);
    expect(note?.bg).toBe("var(--acme-color-page)");
    expect(note?.fails).toEqual(["light"]);
  });

  /* Large text clears at 3:1, and holding it to 4.5 would send someone to
     change a colour that was never wrong. */
  it("asks large text for 3:1 and not 4.5:1", () => {
    const heading = pair(".heading");
    expect(heading?.needs).toBe(3);
    expect(heading?.fails).toEqual([]);
  });

  it("measures a scrim by compositing it over the surface behind it", () => {
    const scrimmed = pair(".caption--scrimmed");
    expect(scrimmed?.fails).toEqual([]);
    expect(scrimmed?.ratio.light).toBeGreaterThan(4.5);
  });
});

describe("what cannot be measured", () => {
  /* Silence reads as a pass, which is how a caption over a photograph ends up
     invisible in a build every check called clean. */
  it("reports a gradient as unmeasured rather than dropping it", () => {
    const hero = found.unmeasured.find((p) => p.selector === ".hero");
    expect(hero?.unmeasured).toMatch(/gradient|no colour/i);
    expect(found.pairs).not.toContain(hero);
  });

  it("never invents a ratio for text laid over what is behind it", () => {
    expect(pair(".caption")).toBeUndefined();
  });

  it("asks text laid over media for a surface of its own", () => {
    expect(found.overMedia.map((f) => f.selector)).toEqual([".caption"]);
    expect(found.overMedia[0]?.file.endsWith("page.css")).toBe(true);
  });
});

describe("the summary", () => {
  it("collects the failures, worst first", () => {
    expect(found.failing.map((p) => p.selector)).toEqual([".acme-Button__root", ".panel .label", ".note"]);
  });

  it("counts what it looked at, so the number is not a claim about the rest", () => {
    expect(found.measured).toBe(found.pairs.length);
    expect(found.pairs.length).toBeGreaterThan(0);
  });
});

/* A block that writes `color: inherit` paints nothing of its own: the pair
   belongs to whichever ancestor set the colour, and measuring it here would
   invent a pair nobody wrote — and then report it as unmeasurable. */
it("makes no pair out of text that only inherits its colour", () => {
  const named = (list: { selector: string }[]) => list.filter((p) => p.selector === ".inherits");
  expect(named(found.pairs)).toEqual([]);
  expect(named(found.unmeasured)).toEqual([]);
});

describe("what WCAG does not ask for", () => {
  /* 1.4.3 exempts an inactive control: a disabled button is meant to read as
     unavailable, and grading it as a failure buries the pairs that are real.
     Exempt, not dropped — it is still on the page, under its own heading. */
  const off = found.pairs.find((p) => p.selector === ".acme-Button__root:disabled");

  it("measures a disabled control and says why it is not counted against the app", () => {
    expect(off?.ratio.light).toBeLessThan(4.5);
    expect(off?.exempt).toMatch(/disabled|inactive/i);
  });

  it("keeps it out of the failures", () => {
    expect(found.failing.map((p) => p.selector)).not.toContain(".acme-Button__root:disabled");
    expect(found.exempt.map((p) => p.selector)).toContain(".acme-Button__root:disabled");
  });
});

/* The defect this pins: a design system's entry stylesheet is usually nothing
   but `@import` lines, so reading that one file finds no rules at all — not the
   `body` surface it paints, not the components it styles in another file. */
describe("a system that ships its CSS across several files", () => {
  it("reads the surface the system paints, not only what the app paints", () => {
    expect(found.surface.light).toBe("var(--acme-color-page)");
    expect(found.surface.dark).toBe("var(--acme-color-page)");
  });

  it("measures a pair written in an imported file", () => {
    const body = found.pairs.find((p) => p.selector === "body");
    expect(body?.fg).toBe("var(--acme-color-text)");
    expect(body?.fails).toEqual([]);
  });
});

/* The defect this pins: a browser resolves every custom property in the
   document, whatever it is called. Loading only the system's namespace left a
   pair written in the app's own tokens reported as unmeasurable — a real colour
   on screen, filed as unknown. */
describe("a pair written in the app's own tokens", () => {
  it("resolves it the way the browser would", () => {
    const own = found.pairs.find((p) => p.selector === ".own");
    expect(own?.ratio.light).toBeCloseTo(7.0, 0);
    expect(found.unmeasured.map((p) => p.selector)).not.toContain(".own");
    expect(own?.fails).toEqual([]);
  });
});

describe("what is behind text the rule does not paint behind itself", () => {
  /* The selector says it: `.panel .label` is only ever rendered inside
     `.panel`, and `.panel` paints a surface two rules up. Falling back to the
     page surface there measures a pair the app never renders. */
  it("takes the surface from the ancestor the selector names", () => {
    const label = found.pairs.find((p) => p.selector === ".panel .label");
    expect(label?.bg).toBe("var(--acme-color-accent)");
    expect(label?.inherited).toBe(false);
  });

  /* Nothing paints text in the colour of the surface it sits on. A ratio of 1
     against an assumed surface is the assumption failing, not the colours, and
     reporting it as a failure sends someone to fix a rule that is fine. */
  it("refuses to call text the colour of its assumed surface a failure", () => {
    expect(found.failing.map((p) => p.selector)).not.toContain(".ghost");
    const ghost = found.unmeasured.find((p) => p.selector === ".ghost");
    expect(ghost?.unmeasured).toMatch(/rendered on something else|surface it was measured against/i);
  });

  /* Nor does anything ship text a shade away from invisible. Text that lands
     within a hair of the surface it was measured against says the same thing as
     a ratio of exactly 1: it is painted somewhere this rule does not name. */
  it("says the same of text a shade away from its assumed surface", () => {
    expect(found.failing.map((p) => p.selector)).not.toContain(".wisp");
    expect(found.unmeasured.map((p) => p.selector)).toContain(".wisp");
  });

  /* One theme is enough. A rule is rendered in one place; if the surface it was
     assumed to sit on makes it invisible in either theme, that surface is the
     wrong one for the rule, and the other theme's healthy ratio was measured
     against the same wrong thing. */
  it("takes one invisible theme as proof the assumed surface is wrong", () => {
    expect(found.failing.map((p) => p.selector)).not.toContain(".glint");
    expect(found.unmeasured.map((p) => p.selector)).toContain(".glint");
  });
});

