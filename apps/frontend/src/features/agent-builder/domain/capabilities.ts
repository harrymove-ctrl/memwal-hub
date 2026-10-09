import type { ToolRef } from "./types";

/** Memory capabilities the server enforces on agent runs. */
export type MemoryCapability = "memwal_recall" | "memwal_remember";

/**
 * Maps an agent's tool list to the capabilities a revision stores. Every
 * recall tool grants `memwal_recall`; `memwal_remember` and
 * `memwal_remember_bulk` both grant `memwal_remember`. Console and other
 * tools grant nothing, so they can never enable a memory operation.
 */
export function memoryCapabilities(tools: ToolRef[]): MemoryCapability[] {
  const found = new Set<MemoryCapability>();
  for (const tool of tools) {
    const technical = tool.technical || tool.id;
    if (technical === "memwal_recall") found.add("memwal_recall");
    if (technical === "memwal_remember" || technical === "memwal_remember_bulk") found.add("memwal_remember");
  }
  return (["memwal_recall", "memwal_remember"] as const).filter((capability) => found.has(capability));
}

const CAPABILITY_TOOLS: Record<MemoryCapability, ToolRef> = {
  memwal_recall: { id: "memwal_recall", name: "Recall project memory", app: "memory", technical: "memwal_recall", group: "read" },
  memwal_remember: { id: "memwal_remember", name: "Save project memory", app: "memory", technical: "memwal_remember", group: "save" },
};

/** Tools a reload should show for the capabilities stored on a revision. */
export function toolsForCapabilities(capabilities: readonly string[]): ToolRef[] {
  return (["memwal_recall", "memwal_remember"] as const)
    .filter((id) => capabilities.includes(id))
    .map((id) => CAPABILITY_TOOLS[id]);
}
