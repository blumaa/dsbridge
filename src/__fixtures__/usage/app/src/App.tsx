import { Button, Card as Panel } from "@acme/react";
import { Chip } from "./Chip.js";

export const App = () => (
  <Panel>
    <Button tone="accent">Go</Button>
    <Button>Stop</Button>
    <Chip>local</Chip>
    <div style={{ padding: "12px", gap: "var(--acme-space-1)" }}>plain</div>
  </Panel>
);
