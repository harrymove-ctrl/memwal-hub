import { requestJson } from "./api-client";

export interface Project {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationSummary {
  id: string;
  project_id: string;
  title: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoredMessage {
  id: string;
  request_id: string;
  role: "user" | "assistant";
  content: string;
  status: "complete" | "interrupted" | "error";
  sequence: number;
  created_at: string;
}

export function listProjects(): Promise<Project[]> {
  return requestJson("/projects");
}

export function createProject(name: string, requestId: string): Promise<Project> {
  return requestJson("/projects", { method: "POST", body: JSON.stringify({ name, request_id: requestId }) });
}

export function listConversations(projectId: string, cursor?: string | null): Promise<{ conversations: ConversationSummary[]; next_cursor: string | null }> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return requestJson(`/projects/${projectId}/conversations${query}`);
}

export function createConversation(projectId: string, requestId: string): Promise<ConversationSummary> {
  return requestJson(`/projects/${projectId}/conversations`, { method: "POST", body: JSON.stringify({ request_id: requestId }) });
}

export function getConversation(conversationId: string): Promise<{ conversation: ConversationSummary; messages: StoredMessage[]; history: string }> {
  return requestJson(`/conversations/${conversationId}`);
}

export function updateConversation(conversationId: string, body: { title?: string; archived?: boolean }): Promise<{ conversation: ConversationSummary; memory_retained: boolean; note: string }> {
  return requestJson(`/conversations/${conversationId}`, { method: "POST", body: JSON.stringify(body) });
}

export function appendUserMessage(conversationId: string, requestId: string, content: string): Promise<{ history: string }> {
  return requestJson(`/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ request_id: requestId, content }) });
}

export function appendReply(conversationId: string, requestId: string, content: string, status: StoredMessage["status"]): Promise<{ history: string }> {
  return requestJson(`/conversations/${conversationId}/replies`, { method: "POST", body: JSON.stringify({ request_id: requestId, content, status }) });
}
