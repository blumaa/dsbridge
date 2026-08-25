import { describe, expect, it } from "vitest";
import { componentsIn, typesEntry } from "./system.js";

describe("what a design system package says it exports", () => {
  it("reads a bundled export list, types and all", () => {
    const source = "export { Button, type ButtonProps, Card, type CardTone, Chip };";
    expect(componentsIn(source)).toEqual(["Button", "Card", "Chip"]);
  });

  it("leaves out a type-only block, which exports nothing to render", () => {
    expect(componentsIn(`export type { ButtonProps, CardTone };`)).toEqual([]);
  });

  it("leaves out a hook and a helper, which are not components", () => {
    expect(componentsIn(`export { Button, cx, useToast, usePresence };`)).toEqual(["Button"]);
  });

  it("takes the name a consumer would write, not the one inside", () => {
    expect(componentsIn(`export { InternalCard as Card };`)).toEqual(["Card"]);
  });

  it("reads a source package too, which declares one export at a time", () => {
    const source = [
      `export { Button } from "./components/Button/Button";`,
      `export type { ButtonProps } from "./components/Button/Button";`,
      `export declare const Card: (props: CardProps) => JSX.Element;`,
      `export declare function Chip(props: ChipProps): JSX.Element;`,
    ].join("\n");
    expect(componentsIn(source)).toEqual(["Button", "Card", "Chip"]);
  });

  it("says nothing twice", () => {
    expect(componentsIn(`export { Button };\nexport { Button };`)).toEqual(["Button"]);
  });
});

describe("where a package states its types", () => {
  const manifest = (json: object) => JSON.stringify(json);

  it("reads the exports map first, which is where a modern package says it", () => {
    expect(typesEntry(manifest({ exports: { ".": { types: "./dist/index.d.ts" } } }))).toBe(
      "./dist/index.d.ts",
    );
  });

  it("reads the older fields as well", () => {
    expect(typesEntry(manifest({ types: "types/index.d.ts" }))).toBe("types/index.d.ts");
    expect(typesEntry(manifest({ typings: "types/index.d.ts" }))).toBe("types/index.d.ts");
  });

  /* Nothing, rather than a guess at `index.d.ts`: a package that ships no types
     has no statement of what it exports, and inventing one would put components
     in the report that the app cannot import. */
  it("says nothing about a package that ships no types", () => {
    expect(typesEntry(manifest({ main: "index.js" }))).toBeUndefined();
    expect(typesEntry(manifest({ exports: { ".": "./index.js" } }))).toBeUndefined();
  });
});
