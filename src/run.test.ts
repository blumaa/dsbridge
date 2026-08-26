import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { run } from "./run.js";

const APP = resolve(import.meta.dirname, "__fixtures__", "usage", "app");

describe("one reading of one app", () => {
  const reading = run(APP, "2026-08-25");

  /* The app is somebody's repository, not this tool's working directory. */
  it("leaves the app exactly as it found it", () => {
    const before = readdirSync(APP);
    run(APP, "2026-08-26");
    expect(readdirSync(APP)).toEqual(before);
  });

  it("hands back the report laid out for the terminal it is printed in", () => {
    expect(reading.report).toContain("@acme/ds");
    expect(reading.report).toContain("38%");
    expect(reading.report).toMatch(/components\s+6\s+2 rendered, 4 never/);
    expect(reading.report).toMatch(/drift\s+5\s/);
  });

  /* The same reading twice is the same characters: a report that moves between
     runs is a report nobody can diff. */
  it("prints the same characters for the same reading", () => {
    expect(run(APP, "2026-08-25").report).toBe(reading.report);
  });

  it("hands back the measurements too, for whoever wants to ask more", () => {
    expect(reading.usage.coverage).toBe(38);
    expect(reading.contrast.measured).toBe(reading.contrast.pairs.length);
  });

  it("lists every row when asked for more than it shows by default", () => {
    const all = run(APP, "2026-08-25", 500);
    expect(all.report).not.toContain("… and");
  });
});

describe("an app with no design system in it", () => {
  it("says what it looked for rather than failing silently", () => {
    const bare = resolve(import.meta.dirname, "__fixtures__", "discovery", "bare");
    expect(() => run(bare, "2026-08-25")).toThrow(/no design system/i);
  });
});
