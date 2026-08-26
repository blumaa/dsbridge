#!/usr/bin/env node
/* The MCP server.
 *
 * A thin adapter, deliberately: two tools over one reading, and both hand back
 * the report already laid out. Nothing here decides anything — a server that
 * formatted its own numbers would be a second place for them to be wrong.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { report } from "./console.js";
import { run, type Reading } from "./run.js";

/** Pages go here: outside every app, one file per app, overwritten each reading. */
const PAGES = join(tmpdir(), "dsbridge");

const today = () => new Date().toISOString().slice(0, 10);

const text = (body: string) => ({ content: [{ type: "text" as const, text: body }] });

const reading = (path: string | undefined): Reading => run(path ?? process.cwd(), today(), PAGES);

/* Said to the client, not to the person: what comes back is the answer, not
   material for one. An agent's instinct with a tool result is to read it and
   write its own version, and a re-worded table is a table nobody can trust
   against the page. */
const VERBATIM =
  "What comes back is a finished report, already laid out as tables. Print it to the person exactly as " +
  "it is, in a code block, before any comment of your own: no summarising, no re-ordering, no re-wording, " +
  "no dropping rows.";

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
      "what it wrote by hand, and what its brand does to colour contrast. Works out the design system from " +
      "what the app installed — nothing needs configuring. Leaves a page behind with every finding on it. " +
      VERBATIM,
    inputSchema: z.object({ path: where }),
  },
  async ({ path }) => text(reading(path).report),
);

server.registerTool(
  "design_system_drift",
  {
    title: "Design system drift",
    description:
      "The same reading as design_system_usage with the work list in full rather than its first ten rows: " +
      "every literal value a token already holds, every invented token duplicating a system value, every " +
      "token read that nothing declares, and every colour pair failing WCAG under this app's brand. " +
      VERBATIM,
    inputSchema: z.object({
      path: where,
      limit: z.number().int().positive().max(500).default(100).describe("Rows per table."),
    }),
  },
  async ({ path, limit }) => {
    const found = reading(path);
    return text(report(found.usage, found.contrast, today(), found.path, limit));
  },
);

serveStdio(() => server);
