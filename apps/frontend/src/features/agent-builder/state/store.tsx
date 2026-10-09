import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import type { Agent, AgentConfig, AgentId } from "../domain/types";
import { loadState, saveState, type PersistedState, type Viewport } from "./persist";

export type Action =
  | { type: "editDraft"; agentId: AgentId; patch: Partial<AgentConfig> }
  | { type: "discardDraft"; agentId: AgentId }
  | { type: "commitDraft"; agentId: AgentId; name?: string; revision?: number; instructions?: string }
  | { type: "updateAgent"; agentId: AgentId; name: string; revision: number; instructions?: string; projectId?: string }
  | { type: "setSidebarCollapsed"; value: boolean }
  | { type: "dismissUsageNotice" }
  | { type: "setRunPanelHidden"; value: boolean }
  | { type: "setViewport"; agentId: AgentId; viewport: Viewport }
  | { type: "setConnected"; appId: string; value: boolean }
  | { type: "addAgent"; agent: Agent };

function omitDraft(drafts: PersistedState["drafts"], agentId: string) {
  const next = { ...drafts };
  delete next[agentId];
  return next;
}

export function reducer(s: PersistedState, a: Action): PersistedState {
  switch (a.type) {
    case "editDraft": {
      const base = s.drafts[a.agentId] ?? s.agents.find((x) => x.id === a.agentId)?.config;
      if (!base) return s;
      return { ...s, drafts: { ...s.drafts, [a.agentId]: { ...base, ...a.patch } } };
    }
    case "discardDraft":
      return { ...s, drafts: omitDraft(s.drafts, a.agentId) };
    case "commitDraft": {
      const draft = s.drafts[a.agentId];
      if (!draft && !a.name && !a.instructions) return s;
      const finalName = a.name ?? draft?.name;
      const finalInstructions = a.instructions ?? draft?.instructions;
      const finalRevision = a.revision;
      return {
        ...s,
        drafts: omitDraft(s.drafts, a.agentId),
        agents: s.agents.map((x) => {
          if (x.id !== a.agentId) return x;
          const baseConfig = draft ?? x.config;
          return {
            ...x,
            name: finalName ?? x.name,
            revision: finalRevision ?? x.revision,
            config: {
              ...baseConfig,
              ...(finalName ? { name: finalName } : {}),
              ...(finalInstructions ? { instructions: finalInstructions } : {}),
            },
          };
        }),
      };
    }
    case "updateAgent": {
      const exists = s.agents.some((x) => x.id === a.agentId);
      if (exists) {
        return {
          ...s,
          agents: s.agents.map((x) => {
            if (x.id !== a.agentId) return x;
            const draft = s.drafts[a.agentId];
            return {
              ...x,
              name: a.name,
              revision: a.revision,
              projectId: a.projectId ?? x.projectId,
              config: {
                ...x.config,
                name: a.name,
                instructions: draft ? x.config.instructions : (a.instructions ?? x.config.instructions),
              },
            };
          }),
        };
      }
      const template = s.agents.find((x) => x.id === "product-discovery") ?? s.agents[0];
      const newAgent: Agent = {
        ...(template ?? {
          id: a.agentId,
          name: a.name,
          config: {
            name: a.name,
            description: "",
            instructions: a.instructions ?? "",
            schedule: null,
            triggers: [],
            identity: null,
            channels: [],
            memory: [],
            tools: [],
            subAgents: [],
            skills: [],
          },
        }),
        id: a.agentId,
        name: a.name,
        revision: a.revision,
        projectId: a.projectId,
        config: {
          ...(template?.config ?? {
            name: a.name,
            description: "",
            instructions: a.instructions ?? "",
            schedule: null,
            triggers: [],
            identity: null,
            channels: [],
            memory: [],
            tools: [],
            subAgents: [],
            skills: [],
          }),
          name: a.name,
          instructions: a.instructions ?? template?.config.instructions ?? "",
        },
      };
      return {
        ...s,
        agents: [...s.agents, newAgent],
      };
    }
    case "setSidebarCollapsed": return { ...s, sidebarCollapsed: a.value };
    case "dismissUsageNotice": return { ...s, usageNoticeDismissed: true };
    case "setRunPanelHidden": return { ...s, runPanelHidden: a.value };
    case "setViewport": return { ...s, viewports: { ...s.viewports, [a.agentId]: a.viewport } };
    case "setConnected": return { ...s, connected: { ...s.connected, [a.appId]: a.value } };
    case "addAgent": {
      const exists = s.agents.some((agent) => agent.id === a.agent.id);
      if (exists) {
        return {
          ...s,
          agents: s.agents.map((agent) => (agent.id === a.agent.id ? { ...agent, ...a.agent } : agent)),
        };
      }
      return { ...s, agents: [...s.agents, a.agent] };
    }
  }
}

interface Ctx { state: PersistedState; dispatch: (a: Action) => void; recovered: boolean }
const StoreCtx = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(() => loadState(), []);
  const [state, dispatch] = useReducer(reducer, initial.state);
  useEffect(() => saveState(state), [state]);
  return <StoreCtx.Provider value={{ state, dispatch, recovered: initial.recovered }}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error("useStore outside StoreProvider");
  return ctx;
}

/** Saved config, current draft (if any) and the effective config to render. */
export function useAgentConfig(agentId: AgentId) {
  const { state } = useStore();
  const agent = state.agents.find((a) => a.id === agentId) ?? null;
  const draft = state.drafts[agentId] ?? null;
  return { agent, draft, config: draft ?? agent?.config ?? null, dirty: draft !== null && JSON.stringify(draft) !== JSON.stringify(agent?.config) };
}
