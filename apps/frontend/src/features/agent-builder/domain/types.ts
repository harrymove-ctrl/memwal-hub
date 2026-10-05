export type AgentId = string;

export interface ScheduleConfig {
  /** Five-field cron, interpreted in `timezone` (never the browser's zone). */
  cron: string;
  timezone: string;
  label: string;
}
export interface TriggerConfig { id: string; app: string; name: string; filter: string }
export interface MemoryRef { id: string; name: string; detail?: string }
export interface ToolRef {
  id: string;
  name: string;
  app: string;
  detail?: string;
  technical?: string;
  group?: "read" | "save" | "advanced";
}
export interface SampleFile { name: string; note?: string }

export interface AgentConfig {
  name: string;
  description: string;
  instructions: string;
  schedule: ScheduleConfig | null;
  triggers: TriggerConfig[];
  /** Channels need an agent identity first (reference shows "Set identity"). */
  identity: string | null;
  channels: string[];
  memory: MemoryRef[];
  tools: ToolRef[];
  files?: SampleFile[];
  filesTitle?: string;
  subAgents: string[];
  skills: string[];
}

export interface AgentExample {
  prompt: string;
  intro: string;
  body: string;
  suggested?: string;
}

export interface Agent { id: AgentId; name: string; config: AgentConfig; example?: AgentExample }

export type SectionId =
  | "schedule" | "triggers" | "channels" | "memory" | "files" | "agent" | "instructions"
  | "tools" | "review" | "save" | "subAgents" | "skills";

/** Visible progress events only — never private model reasoning. */
export type RunEvent =
  | { t: "text"; id: string; text: string }
  | { t: "toolGroup"; id: string; label: string }
  | { t: "tool"; id: string; group: string; name: string; app: string; status: "running" | "done" | "error" }
  | { t: "toolStatus"; id: string; status: "done" | "error" }
  | { t: "collapsed"; id: string; label: string; count: string; items: string[] }
  | { t: "reveal"; section: SectionId }
  | { t: "user"; id: string; text: string };

export type RunStatus = "idle" | "starting" | "running" | "completed" | "stopped" | "failed";

export interface RunState {
  agentId: AgentId;
  status: RunStatus;
  events: RunEvent[];
  /** Simulated in demo mode; source is shown in the UI. */
  elapsedMs: number;
  tokens: number;
  error: string | null;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}
export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};
