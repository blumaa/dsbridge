#!/usr/bin/env node
/* The MCP server.
 *
 * A thin adapter, deliberately: two tools, both of which call `run` and format
 * what comes back. The point of the tool surface being this small is that the
 * question is small — is my design system being used by this app, and where is
 * it not — and every answer worth reading is on the page it leaves behind.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { run, type Reading } from "./run.js";

/** Pages go here: outside every app, one file per app, overwritten each reading. */
const PAGES = join(tmpdir(), "dsbridge");

const today = () => new Date().toISOString().slice(0, 10);

const text = (body: string) => ({ content: [{ type: "text" as const, text: body }] });

const reading = (path: string | undefined): Reading => run(path ?? process.cwd(), today(), PAGES);

const at = (root: string, file: string, line: number) => `${relative(root, file)}:${line}`;

const where = z
  .string()
  .optional()
  .describe("The app's directory. Defaults to the directory the server was started in.");

const server = new McpServer({ name: "dsbridge", version: "0.1.0" });

server.registerTool(
  "design_system_usage",
  {
    title: "Design system usage",
    description:
      "Read an app and report whether the design system it installed is actually being used: how many of " +
      "its components are rendered, how much of its token contract is read, what the app invented instead, " +
      "and what the app's brand does to colour contrast. Works out the design system from what the app " +
      "installed — nothing needs configuring. Leaves a page behind with every finding on it.",
    inputSchema: z.object({ path: where }),
  },
  async ({ path }) => {
    const found = reading(path);
    return text(`${found.headline}\n\npage: ${pathToFileURL(found.path).href}`);
  },
);

server.registerTool(
  "design_system_drift",
  {
    title: "Design system drift",
    description:
      "The work list: values the app wrote by hand that a token already holds, tokens it invented that " +
      "duplicate a system value, tokens it reads that nothing declares, and colour pairs that fail WCAG " +
      "under this app's brand. Use after design_system_usage to act on what it found.",
    inputSchema: z.object({
      path: where,
      limit: z.number().int().positive().max(500).default(25).describe("Rows per list."),
    }),
  },
  async ({ path, limit }) => {
    const { usage, contrast } = reading(path);
    const root = usage.system.root;
    const cut = <T>(items: T[], show: (item: T) => string) =>
      [
        ...items.slice(0, limit).map((item) => `  ${show(item)}`),
        ...(items.length > limit ? [`  … and ${items.length - limit} more`] : []),
        ...(items.length === 0 ? ["  none"] : []),
      ].join("\n");

    /* Only the ones a token can replace: a literal nothing in the system holds
       is a conversation about the system, not a line to change this afternoon.
       The total is named so the shorter list does not read as the whole story. */
    const replaceable = usage.drift.filter((d) => d.tokens.length > 0);

    return text(
      [
        `literal values a token already holds (${replaceable.length} of ${usage.drift.length} written by hand):`,
        cut(
          replaceable,
          (d) =>
            `${at(root, d.file, d.line)}  ${d.property}: ${d.value}  →  ${d.tokens.slice(0, 3).join(" ")}` +
            `${d.tokens.length > 3 ? ` (+${d.tokens.length - 3} holding the same value)` : ""}`,
        ),
        ``,
        `invented tokens duplicating a system value (${usage.tokens.invented.filter((t) => t.duplicates).length}):`,
        cut(
          usage.tokens.invented.filter((t) => t.duplicates !== undefined),
          (t) => `${at(root, t.file, t.line)}  ${t.name}: ${t.value}  →  ${t.duplicates}`,
        ),
        ``,
        `tokens read but never declared (${usage.tokens.missing.length}):`,
        cut(usage.tokens.missing, (t) => `${at(root, t.file, t.line)}  ${t.name}`),
        ``,
        `contrast failures under this app's brand (${contrast.failing.length}):`,
        cut(
          contrast.failing,
          (p) =>
            `${at(root, p.file, p.line)}  ${p.selector}  ${p.fg} on ${p.bg}  ` +
            `${p.fails.map((theme) => `${theme} ${p.ratio[theme]?.toFixed(2)}`).join(" ")} needs ${p.needs}` +
            `${p.repointed.length ? `  [app re-points ${p.repointed.join(" ")}]` : ""}` +
            `${p.inherited ? "  [measured against the page surface]" : ""}`,
        ),
      ].join("\n"),
    );
  },
);

serveStdio(() => server);
