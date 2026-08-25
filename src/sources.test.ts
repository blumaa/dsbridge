/* Finding the two things every command needs: the design system's stylesheets,
   and the app's own brand file. Wrong here and every finding downstream is
   measured against the wrong values, so both failures are loud. */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { findBrandFiles, findStylesheets, findTokenFiles } from "./sources.js";

const APP = join(__dirname, "__fixtures__", "consumer");
const REPO = join(__dirname, "..", "..", "..");


describe("findBrandFiles", () => {
  const found = findBrandFiles(APP, "--mds-");

  it("finds the stylesheet that declares design system tokens", () => {
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/brand-app\.css$/);
  });

  it("ignores a stylesheet that only reads tokens", () => {
    expect(found.join()).not.toContain("component.module.css");
  });

  /* Every exclusion below passes by finding nothing if the fixture is missing
     the files it is meant to exclude — which is exactly how these went green on
     one machine and red in CI, with `node_modules/` and `dist/` gitignored. */
  it("has on disk the files it claims to skip", () => {
    for (const path of ["dist/bundle.css", "node_modules/x/vendor.css", "playwright/.cache/bundle.css"]) {
      expect(existsSync(join(APP, path)), `${path} is not in the fixture`).toBe(true);
    }
  });

  it("ignores dependencies and build output, which are not the app's to change", () => {
    expect(found.join()).not.toContain("node_modules");
    expect(found.join()).not.toContain("dist");
  });

  it("ignores a cache, where a copy of the brand file would read as a second one", () => {
    /* A test runner's cache holds a built bundle that declares every token the
       brand file does, because it *is* the brand file, compiled. */
    expect(found.join()).not.toContain(".cache");
  });
});

describe("findStylesheets", () => {
  it("collects the app's own stylesheets, brand file included", () => {
    const all = findStylesheets(APP).map((f) => f.replace(/^.*[/\\]/, ""));
    expect(all).toContain("component.module.css");
    expect(all).toContain("brand-app.css");
    expect(all.join()).not.toContain("bundle.css");
  });
});

describe("the app stylesheets that declare tokens", () => {
  /* Wider than the brand files on purpose: what a value resolves to is decided
     by every custom property declared for the document, and a token the app
     named itself resolves in the browser exactly like one the system named. */
  it("takes any custom property declared for the document, namespace or not", () => {
    const files = findTokenFiles(resolve(import.meta.dirname, "__fixtures__", "contrast", "app"));
    expect(files.some((file) => file.endsWith("page.css"))).toBe(true);
  });
});
