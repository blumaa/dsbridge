import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { discover, workspaceMembers } from "./discover.js";

const fixture = (name: string) => resolve(import.meta.dirname, "__fixtures__", name);

describe("discover", () => {
  const found = discover(fixture("discovery/app"));

  it("names the dependency that declares the tokens, not the one that spends them", () => {
    expect(found.tokens.id).toBe("@acme/ds");
    expect(found.tokens.stylesheet.endsWith("@acme/ds/styles.css")).toBe(true);
    expect(found.tokens.declares).toBe(5);
  });

  it("reads the namespace off what the system declares", () => {
    expect(found.prefix).toBe("--acme-");
  });

  it("lists the components the system exports, from the copy the app installed", () => {
    expect(found.components?.id).toBe("@acme/react");
    expect(found.components?.names).toEqual(["Button", "Card", "Stack", "Text"]);
  });

  it("finds the app's own stylesheets and sources, and nothing it installed", () => {
    expect(found.stylesheets.map((f) => f.split("/").pop())).toEqual(["App.module.css"]);
    expect(found.sources.map((f) => f.split("/").pop())).toEqual(["App.tsx"]);
  });

  it("says so when nothing installed declares a single custom property", () => {
    expect(() => discover(fixture("discovery/bare"))).toThrow(/no design system/i);
  });

  it("says so when there is no manifest to read", () => {
    expect(() => discover(fixture("discovery/app/src"))).toThrow(/package\.json/);
  });

  it("finds a system a workspace installed beside one of its packages", () => {
    const workspace = discover(fixture("workspace"));
    expect(workspace.tokens.id).toBe("@acme/ds");
    expect(workspace.components).toBeUndefined();
  });
});

describe("workspaceMembers", () => {
  it("expands the globs a monorepo declares", () => {
    const members = workspaceMembers(fixture("workspace")).map((dir) => dir.split("/").slice(-2).join("/"));
    expect(members).toEqual(["apps/web", "packages/ui"]);
  });

  it("is empty for an app that declares none", () => {
    expect(workspaceMembers(fixture("discovery/app"))).toEqual([]);
  });
});

/* The defect this pins: a package states in `exports` which files may be
   imported, and a well-behaved one does not list its own `package.json`. Asking
   Node to resolve `<id>/package.json` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`
   for every such package, which reported a design system that was plainly
   installed as shipping no components at all. The directory is read instead. */
describe("a package that publishes a strict exports map", () => {
  const system = discover(fixture("exports-map"));

  it("reads the tokens through the stylesheet the map names", () => {
    expect(system.tokens.id).toBe("@strict/tokens");
    expect(system.tokens.declares).toBe(4);
    expect(system.prefix).toBe("--strict-");
  });

  it("still reads the components, which the map does not offer a way to ask for", () => {
    expect(system.components?.id).toBe("@strict/react");
    expect(system.components?.names).toEqual(["Button", "Card"]);
  });

  it("takes the component stylesheet from the map rather than from its name", () => {
    expect(system.components?.stylesheet).toMatch(/@strict\/react\/dist\/index\.css$/);
  });
});
