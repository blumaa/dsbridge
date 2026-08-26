import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { discover } from "./discover.js";
import { measure } from "./usage.js";
import { measureContrast } from "./contrast.js";
import { report } from "./console.js";

const reading = (name: string) => {
  const usage = measure(discover(resolve(import.meta.dirname, "__fixtures__", name, "app")));
  return { usage, contrast: measureContrast(usage) };
};

const used = reading("usage");
const text = report(used.usage, used.contrast, "2026-08-25", "/tmp/dsbridge/app.html");

const themed = reading("contrast");
const themedText = report(themed.usage, themed.contrast, "2026-08-25", "/tmp/dsbridge/themed.html");

const section = (body: string, heading: string) =>
  body.split("\n\n").find((part) => part.startsWith(heading));

describe("the report as it is read in a terminal", () => {
  it("says which app it read, against which system, on which day", () => {
    expect(text).toContain("app · 2026-08-25");
    expect(text).toContain("@acme/ds");
    expect(text).toContain("38% of written values came through the system");
  });

  it("counts the four areas in one table", () => {
    const summary = section(text, "area")!;
    expect(summary).toMatch(/components\s+6\s+2 rendered, 4 never/);
    expect(summary).toMatch(/tokens\s+\d+\s+\d+ read/);
    expect(summary).toMatch(/drift\s+5\s/);
    expect(summary).toMatch(/contrast\s+\d+\s/);
  });

  /* The whole point of the failing list is that it can be worked through, and
     a failure without a file to open is a fact, not a task. */
  it("gives every contrast failure a file, a pair, a ratio and the threshold", () => {
    const failures = section(themedText, "Contrast failures")!;
    expect(failures).toContain("Contrast failures (3)");
    expect(failures).toContain("src/page.css:");
    expect(failures).toContain(".note");
    expect(failures).toMatch(/\d\.\d\d/);
    expect(failures).toContain("4.5");
  });

  it("names the literal values a token already holds, with the token", () => {
    const drift = section(text, "Drift")!;
    expect(drift).toContain("src/");
    expect(drift).toMatch(/--acme-/);
  });

  it("lists the components the app never rendered", () => {
    expect(section(text, "Never rendered")).toContain("Chip, Sheet, Stack, Text");
  });

  /* A heading with nothing under it reads as a finding until it is read
     twice. */
  it("leaves out a table it has no rows for", () => {
    expect(themedText).not.toContain("Read but never declared");
  });

  it("cuts a long table off and says how many were left", () => {
    const short = report(used.usage, used.contrast, "2026-08-25", "/tmp/x.html", 1);
    expect(short).toContain("and 2 more");
  });

  /* A ratio measured against a surface the rule never paints is a guess, and a
     guess printed in the same column as a measurement reads as one. */
  it("marks a pair measured against the page and says what the mark means", () => {
    const failures = section(themedText, "Contrast failures")!;
    expect(failures).toContain(" *");
    expect(failures).toContain("* the rule paints no surface of its own");
  });

  it("ends with the page it wrote", () => {
    expect(text.trimEnd().endsWith("page: file:///tmp/dsbridge/app.html")).toBe(true);
  });

  /* A path is opened, and half a directory name opens nothing. */
  it("cuts a long path back a whole segment at a time, keeping the file", () => {
    const deep = {
      ...used.usage,
      tokens: {
        ...used.usage.tokens,
        missing: [
          {
            file: `${used.usage.system.root}/apps/web/src/components/very/deeply/nested/Thing.module.css`,
            line: 7,
            name: "--acme-color-missing",
          },
        ],
      },
    };
    const out = report(deep, used.contrast, "2026-08-25", "/tmp/x.html");
    expect(out).toContain("Thing.module.css:7");
    expect(out).toMatch(/…\/[\w./-]+Thing\.module\.css:7/);
    expect(out).not.toMatch(/…\/[a-z]+ed\//);
  });

  /* An installed package is read from the package down: nothing above
     node_modules tells anyone anything. */
  it("shows a file inside a dependency from the package name down", () => {
    const failures = section(themedText, "Contrast failures")!;
    expect(failures).not.toContain("node_modules");
    expect(failures).toContain("styles.css:2");
  });

  /* It is printed, not scrolled sideways. */
  it("keeps every line inside a terminal", () => {
    for (const line of themedText.split("\n")) expect(line.length).toBeLessThanOrEqual(120);
  });
});
