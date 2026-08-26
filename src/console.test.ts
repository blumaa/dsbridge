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
const text = report(used.usage, used.contrast, "2026-08-25");

const themed = reading("contrast");
const themedText = report(themed.usage, themed.contrast, "2026-08-25");

const section = (body: string, heading: string) =>
  body.split("\n\n").find((part) => part.startsWith(heading));

describe("the report as it is read in a terminal", () => {
  it("says which app it read, against which system, on which day", () => {
    expect(text).toContain("app · 2026-08-25");
    expect(text).toContain("@acme/ds");
    expect(text).toContain("40% of written values came through the system");
  });

  /* The contract in three numbers: the system named this value, the app named
     it, or nobody did. */
  it("splits every value the app wrote by who named it", () => {
    const values = section(text, "values written")!;
    expect(values).toMatch(/through a design system token\s+4\s+40%/);
    expect(values).toMatch(/through a token the app named itself\s+1\s+10%/);
    expect(values).toMatch(/through no token at all\s+5\s+50%/);
  });

  /* A missing scale is the actionable half: five literals is a number, three
     spacings with no token is a job. */
  it("says what kind of value went through no token, and what a token holds", () => {
    const kinds = section(text, "Values with no token behind them (5)")!;
    expect(kinds).toMatch(/spacing\s+3\s+3/);
    expect(kinds).toMatch(/radius\s+1\s+—/);
    expect(kinds).toMatch(/colour\s+1\s+—/);
  });

  it("names the literal values a token already holds, with the token", () => {
    const drift = section(text, "Literal values a token already holds")!;
    expect(drift).toContain("src/");
    expect(drift).toMatch(/--acme-/);
  });

  it("splits every component the app rendered by whose it is", () => {
    const parts = section(text, "components rendered")!;
    expect(parts).toMatch(/from the design system\s+2\s+4/);
    expect(parts).toMatch(/the app's own\s+3\s+3/);
    expect(parts).toMatch(/from another package\s+0\s+0/);
    expect(parts).toMatch(/never rendered\s+4/);
  });

  /* The two things that can be done with an app's own component: import the one
     that already exists, or move this one up. */
  it("says of each of the app's own components what could become of it", () => {
    const own = section(text, "The app's own components (3)")!;
    expect(own).toMatch(/Chip\s+1\s+1\s+the system already ships one by this name/);
    expect(own).toMatch(/Badge\s+1\s+1\s+could move into the system/);
    expect(own).toMatch(/Feed\s+1\s+1\s*$/m);
    const summary = section(text, "components rendered")!;
    expect(summary).toMatch(/of those, could move into the system\s+1/);
    expect(summary).toMatch(/of those, a name the system already ships\s+1/);
  });

  it("lists the components the app never rendered", () => {
    expect(section(text, "Never rendered")).toContain("Chip, Sheet, Stack, Text");
  });

  it("counts what the system offers against what the app takes", () => {
    const counts = section(text, "tokens")!;
    expect(counts).toMatch(/declared by the design system\s+7/);
    expect(counts).toMatch(/read by the app\s+3/);
    expect(counts).toMatch(/declared by the app itself\s+3/);
    expect(counts).toMatch(/of those, read anywhere\s+1/);
  });

  it("names the tokens the app declared itself, with what reads them", () => {
    const invented = section(text, "Tokens the app named itself (3)")!;
    expect(invented).toMatch(/--app-gap\s+8px\s+0\s+--acme-space-2/);
    expect(invented).toContain("--app-panel-bg");
  });

  it("names a token the app reads that nothing declares", () => {
    const missing = section(text, "Read by the app and declared by nobody")!;
    expect(missing).toContain("--acme-color-missing");
  });

  /* Whose stylesheet failed decides whose job the fix is: the system's colours
     under this brand, or the app painting text itself. */
  it("counts every contrast pair by outcome and by whose stylesheet wrote it", () => {
    const wcag = section(themedText, "WCAG 1.4.3 contrast")!;
    expect(wcag).toMatch(/pass\s+5\s+2\s+3/);
    expect(wcag).toMatch(/fail\s+3\s+1\s+2/);
    expect(wcag).toMatch(/exempt: an inactive control is not asked to pass\s+1\s+1\s+0/);
    expect(wcag).toMatch(/not measurable\s+4\s+0\s+4/);
    expect(wcag).toMatch(/text over media, where no ratio exists\s+1\s+—\s+—/);
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

  /* A heading with nothing under it reads as a finding until it is read
     twice. */
  it("leaves out a table it has no rows for", () => {
    expect(themedText).not.toContain("Read by the app and declared by nobody (");
    expect(themedText).not.toContain("The app's own components (");
  });

  it("cuts a long table off and says how many were left", () => {
    const short = report(used.usage, used.contrast, "2026-08-25", 1);
    expect(short).toContain("and 2 more");
  });

  /* A ratio measured against a surface the rule never paints is a guess, and a
     guess printed in the same column as a measurement reads as one. */
  it("marks a pair measured against the page and says what the mark means", () => {
    const failures = section(themedText, "Contrast failures")!;
    expect(failures).toContain(" *");
    expect(failures).toContain("* the rule paints no surface of its own");
  });

  /* Nothing to open afterwards, and nothing left in the app: the answer is
     the whole answer. */
  it("writes nothing anywhere and points at nothing to open", () => {
    expect(text).not.toContain("file://");
    expect(text).not.toContain(".html");
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
    const out = report(deep, used.contrast, "2026-08-25");
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
