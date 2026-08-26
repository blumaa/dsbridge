import { describe, expect, it } from "vitest";
import { table } from "./table.js";

describe("columns that line up", () => {
  const out = table(
    ["component", "uses"],
    [
      ["Button", "3"],
      ["DateTimePicker", "12"],
    ],
    ["left", "right"],
  );
  const lines = out.split("\n");

  it("holds every column to the width of its widest cell", () => {
    expect(lines[0]).toBe("component".padEnd(14) + "  " + "uses");
    expect(new Set(lines.map((line) => line.length)).size).toBe(1);
  });

  /* Reading a column of numbers means comparing their length; a ragged right
     edge makes that a character-by-character job. */
  it("stacks numbers on one right edge and names on one left edge", () => {
    expect(lines[2]!.lastIndexOf("3")).toBe(lines[3]!.lastIndexOf("2"));
    expect(lines[2]!.indexOf("Button")).toBe(lines[3]!.indexOf("DateTimePicker"));
  });

  it("rules the headers off so the header is not read as a row", () => {
    expect(lines[1]).toBe("-".repeat(14) + "  " + "-".repeat(4));
  });

  /* The report is pasted into a chat, and a trailing space is a diff nobody
     asked for. */
  it("leaves no whitespace hanging off the end of a line", () => {
    for (const line of lines) expect(line).toBe(line.trimEnd());
  });

  it("cuts a cell longer than anything worth reading in a terminal", () => {
    const cut = table(["value"], [["a".repeat(200)]], ["left"]);
    expect(cut).toContain("…");
    for (const line of cut.split("\n")) expect(line.length).toBeLessThan(80);
  });

  it("has nothing to draw when there are no rows", () => {
    expect(table(["component"], [], ["left"])).toBe("");
  });
});
