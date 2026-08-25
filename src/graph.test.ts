/* The token graph: what is declared, by which layer, and what it comes out as
   once the var() chains are followed. */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { expandImports, loadGraph } from "./graph";

const DS = join(__dirname, "__fixtures__", "ds", "styles.css");
const BRAND = join(__dirname, "__fixtures__", "app", "brand.css");

describe("loadGraph", () => {
  const graph = loadGraph({ system: DS });

  /* The namespace is a fact about the stylesheet, not a setting: a design
     system declares nearly everything it owns under one first segment, so
     being told which one is being told what it already says. */
  it("takes the namespace from what the system declares", () => {
    const other = loadGraph({ system: join(__dirname, "__fixtures__", "other", "styles.css") });
    expect(other.prefix).toBe("--acme-");
    expect(graph.prefix).toBe("--mds-");
  });

  it("is told the namespace when it is told", () => {
    expect(loadGraph({ system: DS, prefix: "--x-" }).prefix).toBe("--x-");
  });

  it("follows @import so one entry is the whole system", () => {
    expect(graph.names()).toContain("--mds-space-1");
    expect(graph.names()).toContain("--mds-text-primary");
  });

  it("puts a token in the layer of the file that declared it", () => {
    expect(graph.get("--mds-space-1")?.layer).toBe("core");
    expect(graph.get("--mds-text-primary")?.layer).toBe("semantic");
  });

  it("groups core by its scale and semantic by its role", () => {
    expect(graph.get("--mds-space-1")?.group).toBe("spacing");
    expect(graph.get("--mds-gray-900")?.group).toBe("color");
    expect(graph.get("--mds-text-primary")?.group).toBe("text");
    expect(graph.get("--mds-surface-page")?.group).toBe("surface");
  });

  it("says where a token was written", () => {
    const token = graph.get("--mds-space-2");
    expect(token?.declarations[0]?.line).toBe(3);
    expect(token?.declarations[0]?.file).toContain("core/spacing.css");
  });

  it("resolves a chain down to the value the browser paints", () => {
    expect(graph.resolve("--mds-text-primary", "light")).toBe("#232323");
    expect(graph.resolve("--mds-text-primary", "dark")).toBe("#f6f6f4");
  });

  it("keeps the raw value beside the resolved one, since the alias is the point", () => {
    expect(graph.get("--mds-text-primary")?.raw.light).toBe("var(--mds-gray-900)");
  });

  it("records which tokens a token reads, in either theme", () => {
    /* A token that flips reads one step in light and another in dark; both are
       edges, and dropping the dark one hides half of what a value edit moves. */
    expect(graph.get("--mds-text-primary")?.references).toEqual(["--mds-gray-050", "--mds-gray-900"]);
    expect(graph.get("--mds-space-1")?.references).toEqual([]);
  });

  it("records which tokens read it, so a value edit can be traced forward", () => {
    /* Both themes count: changing a scale step moves everything that reads it,
       and the dark scope is not a different graph. */
    expect(graph.get("--mds-gray-900")?.referencedBy).toEqual([
      "--mds-surface-page",
      "--mds-text-primary",
    ]);
  });

  it("tells a color from a length", () => {
    expect(graph.get("--mds-text-primary")?.kind).toBe("color");
    expect(graph.get("--mds-space-1")?.kind).toBe("length");
  });

  it("marks a token that flips between themes", () => {
    expect(graph.get("--mds-text-primary")?.flips).toBe(true);
    expect(graph.get("--mds-space-1")?.flips).toBe(false);
  });
});

describe("loadGraph with a brand", () => {
  const graph = loadGraph({ system: DS, brand: [BRAND] });

  it("lets the brand win, as loading it after the system does", () => {
    expect(graph.resolve("--mds-surface-page", "light")).toBe("#fffdf7");
  });

  it("keeps the token in its own layer and names the brand as the override", () => {
    const token = graph.get("--mds-surface-page");
    expect(token?.layer).toBe("semantic");
    expect(token?.overriddenBy?.[0]?.file).toContain("brand.css");
  });

  it("does not let a brand re-point a core scale step go unnoticed", () => {
    expect(graph.get("--mds-space-1")?.overriddenBy ?? []).toEqual([]);
  });

  it("carries a token the app invented in its own layer", () => {
    expect(graph.get("--app-own")?.layer).toBe("brand");
  });

  it("still reports the system default the brand replaced", () => {
    expect(graph.get("--mds-surface-page")?.raw.light).toBe("var(--mds-gray-050)");
  });
});

/* An app's stylesheets are not the system's, and they import things the system
   never would: a package by name, a font from a CDN, a file a build step makes.
   None of them are readable from where the sheet sits, and the same policy
   `composes` follows applies — an import pointing outside what was scanned
   resolves to nothing, and the caller sees only what it can actually read. */
describe("an @import that points outside what was scanned", () => {
  const ENTRY = join(__dirname, "__fixtures__", "imports", "entry.css");

  /* Load order, not discovery order: a browser applies an `@import`ed file
     before the rules that follow the import, so a value the entry declares
     itself wins over the same value in a file it imported. Handing back the
     entry first would have the later declaration lose. */
  it("is skipped rather than read, and what is read comes back in load order", () => {
    expect(expandImports(ENTRY).map((f) => f.replace(/^.*[/\\]/, ""))).toEqual([
      "read.css",
      "entry.css",
    ]);
  });

  it("leaves the sheet that wrote it, and its readable imports, loaded", () => {
    const graph = loadGraph({ system: DS, brand: [ENTRY] });
    expect(graph.get("--app-entry")?.layer).toBe("brand");
    expect(graph.get("--mds-surface-page")?.overriddenBy?.[0]?.file).toContain("read.css");
  });

  /* Being pointed at a stylesheet that is not there is the caller's mistake,
     not a sheet's, and it has to be heard: a silent empty graph reports every
     app as using no tokens at all. */
  it("is not the same as an entry that is not there", () => {
    expect(() => expandImports(join(__dirname, "__fixtures__", "imports", "missing.css"))).toThrow();
  });
});
