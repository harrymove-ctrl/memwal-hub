import { requestJson } from "./api-client";

export interface SaveAgentRevisionBody {
  agent_key: string;
  name: string;
  instructions: string;
  request_id: string;
  project_id?: string;
  tools?: string[];
}

export interface AgentRevisionResponse {
  agent_key: string;
  name?: string;
  revision: number;
  instructions: string;
  replayed?: boolean;
}

export function saveAgentRevision(body: SaveAgentRevisionBody) {
  return requestJson<AgentRevisionResponse>("/builder-agents", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getAgentRevision(agentKey: string) {
  return requestJson<{ agent_key: string; name: string; instructions: string; revision: number; project_id?: string }>(`/builder-agents/${agentKey}`);
}
