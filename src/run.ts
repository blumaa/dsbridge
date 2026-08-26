/* One reading of one app.
 *
 * Discover what it installed, measure how it is used, measure what that does to
 * contrast, lay it out. Everything above this — the MCP server, a smoke script
 * — is an adapter over this one call, so no caller can arrive at a number of
 * its own.
 */
import { resolve } from "node:path";
import { discover } from "./discover.js";
import { measure, type Usage } from "./usage.js";
import { measureContrast, type Contrast } from "./contrast.js";
import { report } from "./console.js";

export type Reading = {
  usage: Usage;
  contrast: Contrast;
  /** The findings, laid out for the terminal they are printed in. */
  report: string;
};

/**
 * Read an app and report on it.
 *
 * `at` is passed in rather than read from the clock, so the same reading of the
 * same app prints the same characters. Nothing is written anywhere: the answer
 * goes back to whoever asked, and the app is left exactly as it was found.
 */
export function run(root: string, at: string, limit?: number): Reading {
  const usage = measure(discover(resolve(root)));
  const contrast = measureContrast(usage);
  return { usage, contrast, report: report(usage, contrast, at, limit) };
}
