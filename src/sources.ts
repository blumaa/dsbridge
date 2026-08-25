/* Finding what an app owns.
 *
 * Everything under here is the app's own source: the stylesheets it wrote and
 * the components it wrote. What it installed is `discover.ts`, and the line
 * between the two is the whole point — a report that counted a dependency's CSS
 * as the app's would grade the app on somebody else's file.
 *
 * The brand file is the one place the two meet: an app stylesheet that
 * *declares* design system tokens rather than reading them is the app
 * re-pointing the contract, and that is a bridge whatever it is called.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { declarationsIn } from "./css/parse.js";

/** Build output and dependencies are not the app's to change or to be judged on.
    Every dot-directory goes with them: caches are where a *copy* of the app's
    CSS lives, and a copy would be reported as a second brand file. */
const SKIP = new Set(["node_modules", "dist", "build", "out", "coverage", "storybook-static"]);
const skipped = (entry: string) => SKIP.has(entry) || entry.startsWith(".");

/** Every file under a directory the repo owns, by extension. */
export function findFiles(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at)) {
      if (skipped(entry)) continue;
      const path = join(at, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (extensions.some((extension) => entry.endsWith(extension))) out.push(path);
    }
  };
  walk(resolve(dir));
  return out.sort();
}

/** Every stylesheet the app owns. */
export const findStylesheets = (dir: string): string[] => findFiles(dir, [".css"]);

/** Every TypeScript component, story and test the app owns. */
export const findSources = (dir: string): string[] => findFiles(dir, [".tsx"]);

/**
 * A selector that sets a value for the whole document rather than for one thing
 * in it. `:root`, `html`, `[data-theme="dark"]` and their combinations qualify;
 * `.card` does not.
 */
export const rootScoped = (selector: string): boolean =>
  selector
    .split(",")
    .some((part) => part.replace(/:root\b|\bhtml\b|\bbody\b|\*|\[data-theme[^\]]*\]|::?[a-z-]+|[\s>+~]+/g, "") === "");

/**
 * The design system tokens a stylesheet declares document-wide.
 *
 * This is what separates a brand file from a component's: a component may
 * declare tokens of its own — `.button { --ds-icon-slot: … }` sets the slot
 * for its own glyph — but it sets them *on itself*. A file that sets them on
 * the document is re-pointing the contract for everything, which is the one
 * thing a brand does.
 */
export const brandDeclarations = (source: string, file: string, prefix: string) =>
  rootDeclarations(source, file).filter((d) => d.name.startsWith(prefix));

/** Every custom property a stylesheet declares for the whole document. */
const rootDeclarations = (source: string, file: string) =>
  declarationsIn(source, file).filter((d) => rootScoped(d.selector));

const declaring = (dir: string, has: (source: string, file: string) => boolean): string[] =>
  findStylesheets(dir).filter((file) => has(readFileSync(file, "utf8"), file));

/**
 * The app stylesheets that declare tokens of any name.
 *
 * Wider than the brand files, and deliberately: a browser resolves every custom
 * property in the document, so a colour the app named itself resolves exactly
 * like one the system named. Reading only the namespace leaves real colours on
 * the screen reported as unknown.
 */
export const findTokenFiles = (dir: string): string[] =>
  declaring(dir, (source, file) => rootDeclarations(source, file).length > 0);

/**
 * The app's brand files: the ones that re-point design system tokens.
 *
 * Declaring is the test, not naming. A file called `brand.css` that only reads
 * tokens is a component stylesheet; a file that declares an accent token at the
 * document root is the bridge whatever it is called.
 */
export const findBrandFiles = (dir: string, prefix: string): string[] =>
  declaring(dir, (source, file) => brandDeclarations(source, file, prefix).length > 0);
