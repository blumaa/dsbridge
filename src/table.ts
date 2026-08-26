/* Columns that line up in a terminal.
 *
 * The report is read where it is printed — a chat, a terminal — so the layout
 * is fixed-width text and nothing else. No markup to render, no widths to
 * guess: every column is as wide as its widest cell, and the numbers stack on
 * one right edge so a column can be read down rather than across.
 */

export type Align = "left" | "right";

/** Longer than this and a cell is no longer being read, only scrolled past. */
const WIDEST = 72;

/** Two spaces: enough to separate columns, little enough to fit a terminal. */
const GUTTER = "  ";

const clip = (cell: string) => (cell.length > WIDEST ? `${cell.slice(0, WIDEST - 1)}…` : cell);

/** Headers, a rule, and the rows — or nothing at all, when there are no rows. */
export function table(headers: string[], rows: string[][], align: Align[]): string {
  if (rows.length === 0) return "";
  const cells = rows.map((row) => row.map(clip));
  const width = headers.map((header, column) =>
    Math.max(header.length, ...cells.map((row) => (row[column] ?? "").length)),
  );
  const lay = (row: string[]) =>
    row
      .map((cell, column) =>
        align[column] === "right" ? cell.padStart(width[column]!) : cell.padEnd(width[column]!),
      )
      .join(GUTTER)
      .trimEnd();
  return [
    lay(headers),
    width.map((w) => "-".repeat(w)).join(GUTTER),
    ...cells.map(lay),
  ].join("\n");
}
