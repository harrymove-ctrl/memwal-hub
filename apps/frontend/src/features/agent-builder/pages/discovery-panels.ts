import type { MemoryEvent } from "../services/discovery-chat";

export type StageState = "not-started" | "running" | "completed" | "waiting" | "skipped" | "failed" | "uncertain";

export interface RunStage {
  id: string;
  label: string;
  state: StageState;
  detail: string;
}

export interface TimelineInput {
  projectId: string;
  replyStatus?: "streaming" | "done" | "error" | "stopped";
  memory?: MemoryEvent;
  extraction?: "loading" | "done" | "failed";
  suggestionStates?: Array<"suggested" | "saving" | "saved" | "failed" | "uncertain">;
}

/** Stages follow the latest reply. A stage is completed only when that work finished. */
export function runStages(input: TimelineInput): RunStage[] {
  const project: RunStage = input.projectId
    ? { id: "project", label: "Project", state: "completed", detail: "This run is scoped to the selected project." }
    : { id: "project", label: "Project", state: "not-started", detail: "Choose a project. Memory is not used without one." };

  const memory = input.memory;
  let recall: RunStage = { id: "recall", label: "Recall", state: "not-started", detail: "Recall runs when a message is sent." };
  if (memory?.state === "recalling") recall = { id: "recall", label: "Recall", state: "running", detail: "Reading this project's Memory." };
  else if (memory?.state === "included") recall = { id: "recall", label: "Recall", state: "completed", detail: `${memory.facts.length} saved ${memory.facts.length === 1 ? "fact" : "facts"} supplied as context.` };
  else if (memory?.state === "none") recall = { id: "recall", label: "Recall", state: "skipped", detail: "No relevant project facts. Nothing was injected." };
  else if (memory?.state === "off") recall = { id: "recall", label: "Recall", state: "skipped", detail: "Memory was off for this message." };
  else if (memory && (memory.state === "failed" || memory.state === "unavailable")) recall = { id: "recall", label: "Recall", state: "failed", detail: memory.message };

  const status = input.replyStatus;
  let model: RunStage = { id: "model", label: "Model", state: "not-started", detail: "No reply yet." };
  if (status === "streaming") model = { id: "model", label: "Model", state: "running", detail: "The model is writing." };
  else if (status === "done") model = { id: "model", label: "Model", state: "completed", detail: "The reply finished. That is not a Memory save." };
  else if (status === "error") model = { id: "model", label: "Model", state: "failed", detail: "The model request failed." };
  else if (status === "stopped") model = { id: "model", label: "Model", state: "skipped", detail: "The reply was stopped." };

  let extract: RunStage = { id: "extract", label: "Suggestions", state: "not-started", detail: "Suggestions start after a finished reply." };
  if (input.extraction === "loading") extract = { id: "extract", label: "Suggestions", state: "running", detail: "Looking for durable facts. Nothing is written yet." };
  else if (input.extraction === "failed") extract = { id: "extract", label: "Suggestions", state: "failed", detail: "Suggestion extraction failed. This is not an empty result." };
  else if (input.extraction === "done" && (input.suggestionStates?.length ?? 0) === 0) extract = { id: "extract", label: "Suggestions", state: "skipped", detail: "Nothing durable was proposed." };
  else if ((input.suggestionStates?.length ?? 0) > 0) extract = { id: "extract", label: "Suggestions", state: "waiting", detail: "Review the proposed facts before saving." };

  const states = input.suggestionStates ?? [];
  let save: RunStage = { id: "save", label: "Save", state: "skipped", detail: "No facts were proposed." };
  if (states.length === 0 && input.extraction !== "done") save = { id: "save", label: "Save", state: "not-started", detail: "Save waits for a reviewed suggestion." };
  else if (states.some((state) => state === "saving")) save = { id: "save", label: "Save", state: "running", detail: "Submitted. Waiting for Walrus to confirm." };
  else if (states.some((state) => state === "uncertain")) save = { id: "save", label: "Save", state: "uncertain", detail: "Storage was not confirmed. Do not send the fact again until you check the job." };
  else if (states.some((state) => state === "failed")) save = { id: "save", label: "Save", state: "failed", detail: "A selected fact was not stored." };
  else if (states.length > 0 && states.every((state) => state === "saved")) save = { id: "save", label: "Save", state: "completed", detail: "Walrus confirmed every selected fact." };
  else if (states.length > 0) save = { id: "save", label: "Save", state: "waiting", detail: "Not submitted. Approval is the Save button." };

  return [project, recall, model, extract, save];
}
