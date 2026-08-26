#!/usr/bin/env node
/* The MCP server.
 *
 * A thin adapter, deliberately: two tools over one reading, and both hand back
 * the report already laid out. Nothing here decides anything — a server that
 * formatted its own numbers would be a second place for them to be wrong.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { run } from "./run.js";
import { toolResult } from "./result.js";

const today = () => new Date().toISOString().slice(0, 10);

const reading = (path: string | undefined, limit?: number) =>
  run(path ?? process.cwd(), today(), limit);

/* Enough that an agent knows what it is calling. What comes back says the rest
   of it, where saying it works: `result.ts`. */
const VERBATIM = "What comes back is a finished report to be printed as it is, not summarised.";

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
      "Read an app and report whether the design system it installed is actually being used. Every value the " +
      "app writes and every component it renders, sorted by where it came from: the design system, a name the " +
      "app gave itself, or nothing at all — with the values written by hand broken down by kind, the app's own " +
      "components that could move into the system, and every colour pair against WCAG under this app's brand. " +
      "Works out the design system from what the app installed — nothing needs configuring, and nothing is " +
      "written anywhere. " +
      VERBATIM,
    inputSchema: z.object({ path: where }),
  },
  async ({ path }) => toolResult(reading(path).report),
);

server.registerTool(
  "design_system_drift",
  {
    title: "Design system drift",
    description:
      "The same reading as design_system_usage with every list in full rather than its first ten rows: " +
      "every literal value a token already holds, every component the app built itself, every token it " +
      "declared, every token read that nothing declares, and every colour pair failing WCAG under this " +
      "app's brand. " +
      VERBATIM,
    inputSchema: z.object({
      path: where,
      limit: z.number().int().positive().max(500).default(100).describe("Rows per table."),
    }),
  },
  async ({ path, limit }) => toolResult(reading(path, limit).report),
);

serveStdio(() => server);
