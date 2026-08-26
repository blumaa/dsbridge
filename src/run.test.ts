import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./run.js";

const APP = resolve(import.meta.dirname, "__fixtures__", "usage", "app");
const out = () => mkdtempSync(join(tmpdir(), "dsbridge-test-"));

describe("one reading of one app", () => {
  const into = out();
  const reading = run(APP, "2026-08-25", into);

  it("writes the page where it was told and nowhere near the app", () => {
    expect(existsSync(reading.path)).toBe(true);
    expect(reading.path.startsWith(into)).toBe(true);
    expect(readdirSync(APP)).not.toContain("dsbridge");
    expect(readFileSync(reading.path, "utf8")).toMatch(/^<!doctype html>/i);
  });

  /* The same reading twice is the same file: a folder filling with dated
     copies is a folder nobody opens. */
  it("writes over its own last reading of the same app", () => {
    const again = run(APP, "2026-08-26", into);
    expect(again.path).toBe(reading.path);
    expect(readdirSync(into)).toHaveLength(1);
  });

  it("hands back the report laid out for the terminal it is printed in", () => {
    expect(reading.report).toContain("@acme/ds");
    expect(reading.report).toContain("38%");
    expect(reading.report).toMatch(/components\s+6\s+2 rendered, 4 never/);
    expect(reading.report).toMatch(/drift\s+5\s/);
    expect(reading.report).toContain(`page: file://${reading.path}`);
  });

  it("hands back the measurements too, for whoever wants to ask more", () => {
    expect(reading.usage.coverage).toBe(38);
    expect(reading.contrast.measured).toBe(reading.contrast.pairs.length);
  });
});

describe("an app with no design system in it", () => {
  it("says what it looked for rather than failing silently", () => {
    const bare = resolve(import.meta.dirname, "__fixtures__", "discovery", "bare");
    expect(() => run(bare, "2026-08-25", out())).toThrow(/no design system/i);
  });
});
