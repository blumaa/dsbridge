import { describe, expect, it } from "vitest";
import { toolResult } from "./result.js";

const REPORT = "app · 2026-08-26\n\nvalues written  count\n--------------  -----\nthrough it          4";

describe("what a tool call hands back", () => {
  const { content } = toolResult(REPORT);
  const report = content.at(-1)!;

  /* The report is the last block because the instruction before it says "the
     block below": an instruction pointing at the wrong thing is worse than
     none. */
  it("hands the report back last, fenced, and not a character changed", () => {
    expect(report.text).toBe(`\`\`\`\n${REPORT}\n\`\`\``);
  });

  /* The client decides what a person sees. Marking the block as theirs is the
     one say the protocol gives a server in that decision. */
  it("marks the report as the person's to see", () => {
    expect(report.annotations?.audience).toContain("user");
    expect(report.annotations?.audience).toContain("assistant");
  });

  /* An agent's instinct with a tool result is to read it and write its own
     version. Said in the description it is advice read before the call; said
     here it is the last thing read before the reply. */
  it("tells the assistant to print it rather than write about it", () => {
    const directive = content[0]!;
    expect(directive.annotations?.audience).toEqual(["assistant"]);
    expect(directive.text).toMatch(/print it/i);
    expect(directive.text).toMatch(/no summary|do not summarise/i);
  });
});
