import AgentBuilder from "@/features/agent-builder/App";

/**
 * The Outglow-style agent canvas, hosted inside Bew Harness.
 *
 * Runs, shares, and schedules stay local demo state. Skills on the canvas are
 * the ones this repository publishes. Agent pools, the catalogue, and
 * organization stay on their own routes.
 */
export default function BuilderRoute() {
  return <AgentBuilder />;
}
