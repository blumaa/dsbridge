/* One reading of one app.
 *
 * Discover what it installed, measure how it is used, measure what that does to
 * contrast, write the page. Everything above this — the MCP server, a smoke
 * script — is an adapter over this one call, so what the tool says in chat and
 * what the page says can never drift apart.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { discover } from "./discover.js";
import { measure, type Usage } from "./usage.js";
import { measureContrast, type Contrast } from "./contrast.js";
import { page } from "./report.js";
import { report } from "./console.js";

export type Reading = {
  usage: Usage;
  contrast: Contrast;
  /** Where the page was written. Outside the app, always. */
  path: string;
  /** The same numbers as the page, laid out for the terminal it is printed in. */
  report: string;
};

/** A file name that is the app's, and stays the app's across readings. */
const fileFor = (root: string): string =>
  `${basename(root).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "app"}.html`;

/**
 * Read an app and leave a page behind.
 *
 * `at` is passed in rather than read from the clock, so the same reading of the
 * same app writes the same bytes.
 */
export function run(root: string, at: string, into: string): Reading {
  const app = resolve(root);
  const usage = measure(discover(app));
  const contrast = measureContrast(usage);
  mkdirSync(into, { recursive: true });
  const path = join(into, fileFor(app));
  writeFileSync(path, page(usage, contrast, at));
  return { usage, contrast, path, report: report(usage, contrast, at, path) };
}
