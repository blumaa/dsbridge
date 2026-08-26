import { rows } from "./data.js";

export const Feed = () => (
  <ul>
    {rows.map((row) => (
      <li key={row}>{row}</li>
    ))}
  </ul>
);
