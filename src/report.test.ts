import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { discover } from "./discover.js";
import { measure } from "./usage.js";
import { measureContrast } from "./contrast.js";
import { page } from "./report.js";

const fixture = (name: string) => resolve(import.meta.dirname, "__fixtures__", name, "app");
const report = (name: string) => {
  const usage = measure(discover(fixture(name)));
  return { usage, contrast: measureContrast(usage), html: "" };
};

const themed = report("contrast");
const themedPage = page(themed.usage, themed.contrast, "2026-08-25");

const used = report("usage");
const usedPage = page(used.usage, used.contrast, "2026-08-25");

describe("the page as a file", () => {
  /* It is opened from a folder, mailed, and kept. Anything it has to fetch is
     a thing it can be missing later. */
  it("carries everything it needs", () => {
    expect(themedPage).toMatch(/^<!doctype html>/i);
    expect(themedPage).toContain("<style>");
    expect(themedPage).not.toContain("<link ");
    expect(themedPage).not.toMatch(/src=["']https?:/);
  });

  it("says which app it read and which system it read it against", () => {
    expect(themedPage).toContain("@acme/ds");
    expect(themedPage).toContain("@acme/react");
    expect(themedPage).toContain("2026-08-25");
  });

  /* A selector is text from someone else's file, and this page gets opened in
     a browser. */
  it("writes a selector as text, never as markup", () => {
    const nasty = {
      ...themed.contrast,
      pairs: [{ ...themed.contrast.pairs[0]!, selector: `<img src=x onerror="alert(1)">` }],
      failing: [{ ...themed.contrast.failing[0]!, selector: `<img src=x onerror="alert(1)">` }],
    };
    const html = page(themed.usage, nasty, "2026-08-25");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});

describe("the headline", () => {
  it("leads with the share of written values that came through the system", () => {
    expect(themedPage).toContain("50%");
  });
});

describe("the components block", () => {
  it("counts what the app renders against what the system offers", () => {
    expect(usedPage).toMatch(/2 of 6/);
    expect(usedPage).toContain("Button");
  });

  it("shows how often each one is rendered", () => {
    expect(usedPage).toMatch(/Button[\s\S]{0,120}?2/);
  });

  it("names what the app never reached for", () => {
    expect(usedPage).toContain("Sheet");
  });

  /* Nothing used is a finding, not an empty state to hide. */
  it("says so plainly when the app renders none of them", () => {
    expect(themedPage).toMatch(/0 of 2/);
  });
});

describe("the tokens block", () => {
  it("separates what the app spends from what it re-points", () => {
    expect(usedPage).toMatch(/3 of 7/);
    expect(usedPage).toContain("--acme-color-accent");
  });

  it("lists what the app invented, and what each one duplicates", () => {
    expect(usedPage).toContain("--app-panel-bg");
    expect(usedPage).toContain("--acme-color-surface");
  });

  /* A token the app reads that the system never declared is a broken value in
     the browser, so it is not filed under housekeeping. */
  it("names a token the app reads that nothing declares", () => {
    expect(usedPage).toContain("--acme-color-missing");
  });
});

describe("the drift block", () => {
  it("counts the literal values and the files they are in", () => {
    expect(usedPage).toMatch(/5 literal values/);
    expect(usedPage).toMatch(/2 files/);
  });

  it("offers the token that already holds the value, where one does", () => {
    expect(usedPage).toContain("--acme-space-3");
  });
});

describe("the contrast block", () => {
  it("reports the ratio per theme for a pair the system itself wrote", () => {
    expect(themedPage).toContain(".acme-Button__root");
    expect(themedPage).toContain("1.43");
    expect(themedPage).toContain("13.29");
  });

  /* Which half owns the failure: the app moved the accent, so the system's own
     passing test says nothing about what this app renders. */
  it("names the re-pointed token behind a failure", () => {
    expect(themedPage).toContain("--acme-color-accent");
  });

  it("keeps a pair measured against the page surface apart from one that brought its own", () => {
    expect(themedPage).toMatch(/inherit/i);
    expect(themedPage).toContain(".note");
  });

  /* A disabled control with a low ratio belongs on the page and out of the
     failure count: WCAG exempts it, and hiding it would hide a real colour. */
  it("shows an exempt pair apart from the failures", () => {
    expect(themedPage).toContain(".acme-Button__root:disabled");
    expect(themedPage).toMatch(/not asked to pass/i);
  });

  it("reports what it could not measure, with the reason", () => {
    expect(themedPage).toContain(".hero");
    expect(themedPage).toMatch(/gradient/);
  });

  it("reports text sitting over media, which has no ratio to give", () => {
    expect(themedPage).toContain(".caption");
  });
});
