import { SEED_AGENTS, INTEGRATIONS } from "../data/fixtures";
import type { Agent, AgentConfig, AgentId } from "../domain/types";

export const STORAGE_KEY = "bew-harness:builder:v1";
export const STORAGE_VERSION = 7;

export interface Viewport { x: number; y: number; zoom: number }

/** Only non-secret demo state is persisted. */
export interface PersistedState {
  version: typeof STORAGE_VERSION;
  agents: Agent[];
  drafts: Record<AgentId, AgentConfig>;
  sidebarCollapsed: boolean;
  usageNoticeDismissed: boolean;
  runPanelHidden: boolean;
  viewports: Record<AgentId, Viewport>;
  connected: Record<string, boolean>;
}

export function seedState(): PersistedState {
  return {
    version: STORAGE_VERSION,
    agents: structuredClone(SEED_AGENTS),
    drafts: {},
    sidebarCollapsed: false,
    usageNoticeDismissed: false,
    runPanelHidden: false,
    viewports: {},
    connected: Object.fromEntries(INTEGRATIONS.map((i) => [i.id, i.connected])),
  };
}

function isValid(v: unknown): v is PersistedState {
  if (!v || typeof v !== "object") return false;
  const s = v as PersistedState;
  return (
    s.version === STORAGE_VERSION &&
    Array.isArray(s.agents) &&
    s.agents.every((a) => typeof a?.id === "string" && typeof a?.config?.name === "string") &&
    typeof s.drafts === "object" && s.drafts !== null &&
    typeof s.viewports === "object" && s.viewports !== null &&
    typeof s.connected === "object" && s.connected !== null
  );
}

function browserStorage(): Storage {
  if (typeof window === "undefined") {
    const data = new Map<string, string>();
    return {
      get length() {
        return data.size;
      },
      clear: () => data.clear(),
      getItem: (key) => data.get(key) ?? null,
      key: (index) => [...data.keys()][index] ?? null,
      removeItem: (key) => data.delete(key),
      setItem: (key, value) => data.set(key, value),
    };
  }
  return localStorage;
}

/** Returns stored state, or a fresh seed when missing, corrupted or outdated. */
export function loadState(storage: Storage = browserStorage()): { state: PersistedState; recovered: boolean } {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return { state: seedState(), recovered: false };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isValid(parsed)) return { state: parsed, recovered: false };
  } catch {
    /* fall through to recovery */
  }
  storage.removeItem(STORAGE_KEY);
  return { state: seedState(), recovered: true };
}

export function saveState(state: PersistedState, storage: Storage = browserStorage()) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode: state stays in memory */
  }
}
