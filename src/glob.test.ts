import { describe, expect, it } from "vitest";
import { anyGlob, globToRegExp } from "./glob.js";

const matches = (pattern: string, path: string) => globToRegExp(pattern).test(path);

describe("glob", () => {
  it("a star stops at a separator", () => {
    expect(matches("src/*.tsx", "src/Card.tsx")).toBe(true);
    expect(matches("src/*.tsx", "src/ui/Card.tsx")).toBe(false);
  });

  it("a double star crosses them", () => {
    expect(matches("**/*.test.tsx", "src/ui/Card.test.tsx")).toBe(true);
    expect(matches("**/*.test.tsx", "Card.test.tsx")).toBe(true);
    expect(matches("src/**/*.css", "src/a/b/c.css")).toBe(true);
  });

  it("a question mark is one character", () => {
    expect(matches("src/?.css", "src/a.css")).toBe(true);
    expect(matches("src/?.css", "src/ab.css")).toBe(false);
  });

  it("a dot is a dot, not any character", () => {
    expect(matches("a.css", "axcss")).toBe(false);
  });

  it("a pattern that names a directory matches everything under it", () => {
    expect(matches("src/legacy", "src/legacy/Card.tsx")).toBe(true);
    expect(matches("src/legacy", "src/legacy")).toBe(true);
    expect(matches("src/legacy", "src/legacy-ui/Card.tsx")).toBe(false);
  });

  it("names a whole path, not a fragment of one", () => {
    expect(matches("Card.tsx", "src/Card.tsx")).toBe(false);
    expect(matches("**/Card.tsx", "src/Card.tsx")).toBe(true);
  });

  it("holds no pattern, so it matches nothing", () => {
    expect(anyGlob([])("src/Card.tsx")).toBe(false);
  });

  it("matches when any one pattern does", () => {
    const suppressed = anyGlob(["**/*.test.*", "**/__fixtures__"]);
    expect(suppressed("src/Card.test.tsx")).toBe(true);
    expect(suppressed("src/__fixtures__/app/x.css")).toBe(true);
    expect(suppressed("src/Card.tsx")).toBe(false);
  });
});
