import { Ascii } from "ascii.rest/react";
import { whale } from "ascii.rest/pieces";
import { ArrowDown, ArrowUp, Check, ChevronRight, Loader2, MessageCircle, Plus, RotateCcw, Settings, Square, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { NavLink, useSearchParams } from "react-router";

import { OpenSidebarButton, type ShellCtx } from "../App";
import { ReplyText } from "../components/ReplyText";
import { BuilderApiError } from "../services/api-client";
import { getAgentRevision } from "../services/builder-agents";
import { appendReply, appendUserMessage, createConversation, createProject, getConversation, listConversations, listProjects, updateConversation, type ConversationSummary, type Project, type StoredMessage } from "../services/conversations";
import {
  chatErrorMessage,
  factStatus,
  saveFacts,
  streamChat,
  suggestFacts,
  type AgentRef,
  type ChatTurn,
  type DoneEvent,
  type FactJob,
  type MemoryEvent,
  type MemoryScope,
  type RequestShape,
} from "../services/discovery-chat";
import { proxyBadge } from "../services/model-proxy";
import { memoryBadge } from "../services/wallet-recall";
import { useMemorySession, useModelProxyStatus, useProxyModels, useRefreshIntegrations } from "../state/integration-queries";
import "./pages.css";
import "./chat.css";

type Phase = "idle" | "recalling" | "generating";
type FactState = "suggested" | "saving" | "saved" | "failed" | "uncertain";

export interface Suggestion {
  id: string;
  text: string;
  category: string;
  selected: boolean;
  state: FactState;
  jobId: string | null;
  blobId: string | null;
  message: string | null;
}

/** Fact extraction for one reply. A failure is never shown as "no facts". */
export type Extraction = { state: "loading" } | { state: "done" } | { state: "failed"; code: string; message: string };

interface AssistantTurn {
  id: string;
  role: "assistant";
  content: string;
  status: "streaming" | "done" | "error" | "stopped";
  memory?: MemoryEvent;
  shape?: RequestShape;
  done?: DoneEvent;
  error?: { code: string; message: string };
  /** Memory scope the run used; absent when Memory was off or the chat is temporary. */
  scope?: MemoryScope;
  agent?: AgentRef;
  extraction?: Extraction;
  suggestions?: Suggestion[];
}

interface UserTurn {
  id: string;
  role: "user";
  content: string;
  requestId?: string;
}

type Turn = UserTurn | AssistantTurn;

/** Chat-history persistence, reported separately from generation and Memory writes. */
export type HistoryStatus =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved" }
  | { state: "failed"; message: string }
  | { state: "temporary" };

const NEAR_BOTTOM_PX = 48;
const POLL_MS = 3000;
const POLL_LIMIT = 80;
const STARTERS = [
  { label: "Help me validate a product idea", draft: "Help me validate a product idea. " },
  { label: "Prioritize my next release", draft: "Help me prioritize my next release. " },
  { label: "Continue from my saved project context", draft: "Continue from my saved project context. If nothing relevant is saved, ask me to describe the project before assuming anything." },
  { label: "Work on something else", draft: "I want help with something other than product discovery: " },
];

const newId = () => crypto.randomUUID();

/** Turns the visible transcript into the conversation sent to the model: completed turns only. */
export function conversationFor(turns: Turn[], next: string): ChatTurn[] {
  const history: ChatTurn[] = [];
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    if (turn.role === "user") {
      const reply = turns[index + 1];
      if (reply?.role === "assistant" && reply.status === "done" && reply.content.trim()) {
        history.push({ role: "user", content: turn.content }, { role: "assistant", content: reply.content });
      }
    }
  }
  return [...history.slice(-20), { role: "user", content: next }];
}

export function factStateFromJob(job: FactJob): FactState {
  if (job.state === "saved" && job.blob_id) return "saved";
  if (job.state === "failed") return "failed";
  if (job.state === "uncertain") return "uncertain";
  return "saving";
}

/**
 * True while an input method is composing text. Chrome and Firefox set
 * `isComposing` on the Enter that confirms a composition; Safari fires
 * `compositionend` first and reports that Enter with keyCode 229, so all
 * three signals are checked. That Enter belongs to the input method and must
 * never submit.
 */
export function isImeEnter(event: { nativeEvent: { isComposing?: boolean; keyCode?: number } }, composing: boolean): boolean {
  return composing || event.nativeEvent.isComposing === true || event.nativeEvent.keyCode === 229;
}

/** The agent revision allows Memory writes unless the run reported a tool list without it. */
function mayRemember(turn: AssistantTurn): boolean {
  const tools = turn.shape?.agent?.tools;
  return !tools || tools.includes("memwal_remember");
}

/** Workspace chat. Product discovery is one use; the same thread can cover other work. */
export function ChatPage({ ctx }: { ctx: ShellCtx }) {
  const [params, setParams] = useSearchParams();
  const projectId = params.get("project") ?? "";
  const conversationId = params.get("conversation") ?? "";
  const agentKey = params.get("agent") ?? "";
  const agentRevision = Number(params.get("rev")) || undefined;
  const proxy = useModelProxyStatus();
  const memory = useMemorySession();
  const refresh = useRefreshIntegrations();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [useMemory, setUseMemory] = useState(true);
  const [autoSave, setAutoSave] = useState(false);
  // Model for this conversation; empty means the saved ZRouter model.
  const [model, setModel] = useState("");
  const proxyModels = useProxyModels(proxy.data?.status === "ready", proxy.data?.base_url);
  const [pinned, setPinned] = useState(true);
  const controller = useRef<AbortController | null>(null);
  const runId = useRef(0);
  const pollTimers = useRef<number[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const activeChat = useRef(conversationId);
  const urlChat = useRef(conversationId);
  const skipLoad = useRef("");
  const inflight = useRef<{ id: string; requestId: string; reply: string } | null>(null);
  const drafts = useRef(new Map<string, string>());
  const createRequest = useRef<string | null>(null);
  // Changes whenever the visible chat changes; late results from an older chat are dropped.
  const chatEpoch = useRef(0);
  const extractions = useRef(new Map<string, AbortController>());
  const composing = useRef(false);
  const sending = useRef(false);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [chats, setChats] = useState<ConversationSummary[]>([]);
  const [moreCursor, setMoreCursor] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryStatus>({ state: "idle" });
  const [writes, setWrites] = useState<Record<string, FactState>>({});
  const [temporary, setTemporary] = useState(false);
  const [creating, setCreating] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [draftChoice, setDraftChoice] = useState(false);
  const [loadedAgent, setAgentInfo] = useState<{ key: string; name: string; revision: number } | null>(null);
  // Only the agent named in the URL counts; a stale row from a previous agent is ignored.
  const agentInfo = loadedAgent && loadedAgent.key === agentKey ? loadedAgent : null;
  const historyReady = projects !== null && historyError === null;
  const canPersist = historyReady && Boolean(projectId);
  // The visible chat follows the URL only when the URL's conversation really changes. Router
  // updates are applied in a transition, so a render that still carries the previous (or empty)
  // value must not overwrite a chat this component has just created or selected itself; doing so
  // made every stream event of a brand-new chat look "late" and drop the reply.
  useEffect(() => {
    if (urlChat.current === conversationId) return;
    urlChat.current = conversationId;
    activeChat.current = conversationId;
  }, [conversationId]);

  const proxyReady = proxy.data?.status === "ready";
  const memoryReady = memory.data?.walrus.status === "verified";
  // Memory is used only inside a saved project chat; never account-wide.
  const memoryUsable = memoryReady && !temporary && Boolean(projectId);
  const memoryState = memoryBadge(memory.data, memory.error, memory.isLoading);
  const proxyState = proxyBadge(proxy.data, false);
  const busy = phase === "recalling" || phase === "generating";

  useEffect(() => () => {
    controller.current?.abort();
    pollTimers.current.forEach((timer) => window.clearTimeout(timer));
    extractions.current.forEach((abort) => abort.abort());
  }, []);

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((rows) => { if (!cancelled) setProjects(rows); })
      .catch((error: unknown) => { if (!cancelled) setHistoryError(error instanceof Error ? error.message : "Chat history is unavailable."); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!agentKey) return;
    let cancelled = false;
    getAgentRevision(agentKey)
      .then((row) => { if (!cancelled) setAgentInfo({ key: agentKey, name: row.name, revision: row.revision }); })
      .catch(() => { if (!cancelled) setAgentInfo(null); });
    return () => { cancelled = true; };
  }, [agentKey]);

  useEffect(() => {
    if (!historyReady || projectId || temporary || !projects || projects.length !== 1) return;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("project", projects[0].id);
      return next;
    }, { replace: true });
  }, [historyReady, projectId, projects, setParams, temporary]);

  useEffect(() => {
    if (!historyReady || !projectId) return;
    let cancelled = false;
    listConversations(projectId)
      .then((page) => { if (!cancelled) { setChats(page.conversations); setMoreCursor(page.next_cursor); } })
      .catch((error: unknown) => { if (!cancelled) setHistoryError(error instanceof Error ? error.message : "That project was not found."); });
    return () => { cancelled = true; };
  }, [historyReady, projectId]);

  useEffect(() => {
    if (!conversationId || skipLoad.current === conversationId) {
      skipLoad.current = "";
      return;
    }
    let cancelled = false;
    setTurns([]);
    getConversation(conversationId)
      .then((detail) => {
        if (cancelled || activeChat.current !== conversationId) return;
        setTurns(detail.messages.map(storedTurn));
        setHistory({ state: "saved" });
      })
      .catch((error: unknown) => { if (!cancelled) setHistoryError(error instanceof Error ? error.message : "That chat was not found."); });
    return () => { cancelled = true; };
  }, [conversationId]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && pinned) element.scrollTop = element.scrollHeight;
  }, [turns, phase, pinned]);

  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    setPinned(element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX);
  };

  const updateAssistant = useCallback((id: string, change: (turn: AssistantTurn) => AssistantTurn) => {
    setTurns((current) => current.map((turn) => (turn.id === id && turn.role === "assistant" ? change(turn) : turn)));
  }, []);

  const updateSuggestion = useCallback((turnId: string, factId: string, change: Partial<Suggestion>) => {
    updateAssistant(turnId, (turn) => ({
      ...turn,
      suggestions: turn.suggestions?.map((item) => (item.id === factId ? { ...item, ...change } : item)),
    }));
    if (change.state) {
      const state = change.state;
      setWrites((current) => (factId in current || state !== "suggested" ? { ...current, [factId]: state } : current));
    }
  }, [updateAssistant]);

  const pollAgain = useRef<(turnId: string, ids: string[], scope: MemoryScope, attempt: number) => void>(() => undefined);
  const pollJobs = useCallback((turnId: string, ids: string[], scope: MemoryScope, attempt: number) => {
    if (!ids.length) return;
    const timer = window.setTimeout(async () => {
      try {
        const { jobs } = await factStatus(ids, scope);
        const open: string[] = [];
        for (const job of jobs) {
          const state = factStateFromJob(job);
          updateSuggestion(turnId, job.client_id, { state, jobId: job.job_id, blobId: job.blob_id, message: job.message });
          if (state === "saving") open.push(job.client_id);
        }
        if (open.length && attempt + 1 < POLL_LIMIT) pollAgain.current(turnId, open, scope, attempt + 1);
        else {
          for (const id of open) updateSuggestion(turnId, id, { state: "uncertain", message: "Storage was not confirmed yet. Check again later; nothing will be written twice." });
        }
      } catch (error) {
        for (const id of ids) updateSuggestion(turnId, id, { state: "uncertain", message: error instanceof Error ? error.message : "Status could not be checked." });
      }
    }, POLL_MS);
    pollTimers.current.push(timer);
  }, [updateSuggestion]);
  useEffect(() => { pollAgain.current = pollJobs; }, [pollJobs]);

  const saveSelected = useCallback(async (turnId: string, items: Suggestion[], scope: MemoryScope, agent?: AgentRef) => {
    const chosen = items.filter((item) => item.selected && item.text.trim() && (item.state === "suggested" || item.state === "failed" || item.state === "uncertain"));
    if (!chosen.length) return;
    // Sending means accepted at most; Saved waits for a blob ID from storage.
    for (const item of chosen) updateSuggestion(turnId, item.id, { state: "saving", jobId: null, message: null });
    try {
      const { jobs } = await saveFacts(chosen.map((item) => ({ client_id: item.id, text: item.text.trim() })), scope, agent);
      const open: string[] = [];
      for (const job of jobs) {
        const state = factStateFromJob(job);
        updateSuggestion(turnId, job.client_id, { state, jobId: job.job_id, blobId: job.blob_id, message: job.message });
        if (state === "saving") open.push(job.client_id);
      }
      pollJobs(turnId, open, scope, 0);
    } catch (error) {
      const failed = error instanceof BuilderApiError && error.status >= 400 && error.status < 500;
      const message = error instanceof BuilderApiError ? error.message : "The save request did not reach the backend.";
      for (const item of chosen) {
        updateSuggestion(turnId, item.id, failed
          ? { state: "failed", message: `${chatErrorMessage(error.code, message)} Nothing was written.` }
          : { state: "uncertain", message: `${message} Retrying reuses the same idempotency key.` });
      }
    }
  }, [pollJobs, updateSuggestion]);

  /** Asks for fact suggestions for one finished reply. It never regenerates the reply and never saves on its own. */
  const extract = useCallback(async (turnId: string, userText: string, reply: string, scope: MemoryScope, agent: AgentRef | undefined, saveAfter: boolean) => {
    extractions.current.get(turnId)?.abort();
    const abort = new AbortController();
    extractions.current.set(turnId, abort);
    const epoch = chatEpoch.current;
    const current = () => !abort.signal.aborted && chatEpoch.current === epoch;
    updateAssistant(turnId, (turn) => ({ ...turn, extraction: { state: "loading" }, suggestions: undefined }));
    try {
      const result = await suggestFacts(userText, reply, scope, agent, abort.signal);
      if (!current()) return;
      const items: Suggestion[] = result.facts.map((fact) => ({ ...fact, selected: true, state: "suggested", jobId: null, blobId: null, message: null }));
      updateAssistant(turnId, (turn) => ({ ...turn, extraction: { state: "done" }, suggestions: items }));
      if (saveAfter && items.length) void saveSelected(turnId, items, scope, agent);
    } catch (error) {
      if (!current()) return;
      const code = error instanceof BuilderApiError ? error.code : "backend_unavailable";
      const message = error instanceof Error ? error.message : "Suggestions could not be loaded.";
      updateAssistant(turnId, (turn) => ({ ...turn, extraction: { state: "failed", code, message } }));
    } finally {
      if (extractions.current.get(turnId) === abort) extractions.current.delete(turnId);
    }
  }, [saveSelected, updateAssistant]);

  const run = useCallback(async (text: string, previous: Turn[], withMemory: boolean, saved?: { id: string; requestId: string }) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const myRun = ++runId.current;
    const userTurn: UserTurn = { id: newId(), role: "user", content: text, requestId: saved?.requestId };
    const assistantId = newId();
    const conversation = conversationFor(previous, text);
    // Memory needs a project; a temporary or project-less chat never sends one.
    const scope: MemoryScope | undefined = withMemory && projectId ? { projectId, conversationId: saved?.id } : undefined;
    const agent: AgentRef | undefined = agentKey ? { key: agentKey, revision: agentRevision } : undefined;
    if (saved) inflight.current = { id: saved.id, requestId: saved.requestId, reply: "" };
    setTurns([...previous, userTurn, { id: assistantId, role: "assistant", content: "", status: "streaming", scope, agent }]);
    setPinned(true);
    setPhase(scope ? "recalling" : "generating");
    let reply = "";
    let finished = false;
    let failed = false;
    let shape: RequestShape | undefined;
    const stillHere = () => runId.current === myRun && (!saved || activeChat.current === saved.id);
    try {
      await streamChat({
        messages: conversation,
        useMemory: Boolean(scope),
        model: model || undefined,
        projectId: scope?.projectId,
        conversationId: saved?.id,
        requestId: saved?.requestId,
        agentKey: agent?.key,
        agentRevision: agent?.revision,
        signal: abort.signal,
        onEvent: (event) => {
          if (!stillHere()) return;
          switch (event.type) {
            case "memory":
              updateAssistant(assistantId, (turn) => ({ ...turn, memory: event.data }));
              if (event.data.state !== "recalling") setPhase("generating");
              break;
            case "request":
              shape = event.data;
              updateAssistant(assistantId, (turn) => ({ ...turn, shape: event.data, agent: event.data.agent ? { key: event.data.agent.key, revision: event.data.agent.revision } : turn.agent }));
              setPhase("generating");
              break;
            case "delta":
              reply += event.data.text;
              if (saved && inflight.current?.requestId === saved.requestId) inflight.current.reply = reply;
              updateAssistant(assistantId, (turn) => ({ ...turn, content: turn.content + event.data.text }));
              break;
            case "done":
              finished = true;
              updateAssistant(assistantId, (turn) => ({ ...turn, status: "done", done: event.data }));
              break;
            case "error":
              failed = true;
              updateAssistant(assistantId, (turn) => ({ ...turn, status: "error", error: event.data }));
              break;
          }
        },
      });
    } catch (error) {
      if (abort.signal.aborted || !stillHere()) return;
      failed = true;
      const code = error instanceof BuilderApiError ? error.code : "backend_unavailable";
      const message = error instanceof Error ? error.message : "The chat request failed.";
      updateAssistant(assistantId, (turn) => ({ ...turn, status: "error", error: { code, message } }));
    }
    if (abort.signal.aborted || !stillHere()) return;
    controller.current = null;
    if (saved && inflight.current?.requestId === saved.requestId) inflight.current = null;
    if (saved) {
      // The server also stores the reply; this write confirms it and cannot shorten it.
      setHistory({ state: "saving" });
      void appendReply(saved.id, saved.requestId, reply, finished ? "complete" : "error")
        .then(() => setHistory({ state: "saved" }))
        .catch((error: unknown) => setHistory({ state: "failed", message: error instanceof Error ? `The reply was not saved to history: ${error.message}` : "The reply was not saved to history." }));
    }
    setPhase("idle");
    if (finished && reply.trim()) {
      const remember = !shape?.agent?.tools || shape.agent.tools.includes("memwal_remember");
      if (scope && remember) void extract(assistantId, text, reply, scope, shape?.agent ? { key: shape.agent.key, revision: shape.agent.revision } : agent, autoSave);
      refresh();
      return;
    }
    if (!finished && !failed) {
      updateAssistant(assistantId, (turn) => ({ ...turn, status: "error", error: { code: "proxy_unavailable", message: "The reply ended before it finished." } }));
    }
    setDraft((current) => current || text);
    refresh();
  }, [agentKey, agentRevision, autoSave, extract, model, projectId, refresh, updateAssistant]);

  const send = () => {
    const text = draft.trim();
    if (!text || busy || !proxyReady || creating || sending.current) return;
    if (temporary) {
      setDraft("");
      setHistory({ state: "temporary" });
      void run(text, turns, false);
      return;
    }
    // A message that cannot be saved is not sent: no silent unsaved chat.
    if (!canPersist) return;
    sending.current = true;
    const requestId = crypto.randomUUID();
    setCreating(true);
    setHistory({ state: "saving" });
    void (async () => {
      try {
        let id = conversationId;
        if (!id) {
          const creationId = createRequest.current ?? crypto.randomUUID();
          createRequest.current = creationId;
          const chat = await createConversation(projectId, creationId);
          createRequest.current = null;
          skipLoad.current = chat.id;
          setChats((current) => [chat, ...current.filter((item) => item.id !== chat.id)]);
          setParams((current) => {
            const next = new URLSearchParams(current);
            next.set("project", projectId);
            next.set("conversation", chat.id);
            return next;
          });
          activeChat.current = chat.id;
          id = chat.id;
        }
        await appendUserMessage(id, requestId, text);
        setHistory({ state: "saved" });
        setDraft("");
        void run(text, turns, useMemory && memoryUsable, { id, requestId });
      } catch (error) {
        setHistory({ state: "failed", message: error instanceof Error ? `${error.message} Nothing was sent.` : "This message was not saved, so it was not sent." });
      } finally {
        sending.current = false;
        setCreating(false);
      }
    })();
  };

  const stop = () => {
    const flight = inflight.current;
    inflight.current = null;
    runId.current += 1;
    controller.current?.abort();
    controller.current = null;
    setTurns((current) => current.map((turn) => (turn.role === "assistant" && turn.status === "streaming" ? { ...turn, status: "stopped" } : turn)));
    setPhase("idle");
    if (flight) {
      // The partial reply stays with the chat it was generated in, as interrupted.
      void appendReply(flight.id, flight.requestId, flight.reply, "interrupted")
        .then(() => { if (activeChat.current === flight.id) setHistory({ state: "saved" }); })
        .catch(() => { if (activeChat.current === flight.id) setHistory({ state: "failed", message: "The interrupted reply was not saved to history." }); });
    }
    input.current?.focus();
  };

  /** Leaves the visible chat: cancels its reply (kept as interrupted) and any running extraction. */
  const leaveChat = () => {
    stop();
    chatEpoch.current += 1;
    extractions.current.forEach((abort) => abort.abort());
    extractions.current.clear();
  };

  /** Re-sends the user message before a failed or stopped reply, reusing its saved request id. */
  const retry = (assistantId: string, withMemory = useMemory && memoryUsable) => {
    const index = turns.findIndex((turn) => turn.id === assistantId);
    const userTurn = turns[index - 1];
    if (index < 1 || userTurn?.role !== "user") return;
    if (draft.trim() === userTurn.content) setDraft("");
    const saved = userTurn.requestId && conversationId ? { id: conversationId, requestId: userTurn.requestId } : undefined;
    void run(userTurn.content, turns.slice(0, index - 1), withMemory, saved);
  };

  /** Runs (or re-runs) fact extraction for a finished reply without regenerating it. */
  const suggestFor = (assistantId: string) => {
    const index = turns.findIndex((turn) => turn.id === assistantId);
    const turn = turns[index];
    const userTurn = turns[index - 1];
    if (turn?.role !== "assistant" || userTurn?.role !== "user" || !projectId) return;
    const scope = turn.scope ?? { projectId, conversationId: conversationId || undefined };
    void extract(assistantId, userTurn.content, turn.content, scope, turn.agent, false);
  };

  const newChat = (force = false) => {
    if (creating) return;
    if (!force && draft.trim()) {
      setDraftChoice(true);
      return;
    }
    setDraftChoice(false);
    leaveChat();
    if (temporary || !canPersist) {
      setTurns([]);
      setDraft("");
      setPhase("idle");
      input.current?.focus();
      return;
    }
    const requestId = createRequest.current ?? crypto.randomUUID();
    createRequest.current = requestId;
    setCreating(true);
    void createConversation(projectId, requestId)
      .then((chat) => {
        createRequest.current = null;
        skipLoad.current = chat.id;
        setChats((current) => [chat, ...current.filter((item) => item.id !== chat.id)]);
        setTurns([]);
        setDraft("");
        setPhase("idle");
        setHistory({ state: "idle" });
        setParams((current) => {
          const next = new URLSearchParams(current);
          next.set("project", chat.project_id);
          next.set("conversation", chat.id);
          return next;
        });
        input.current?.focus();
      })
      .catch((error: unknown) => setHistoryError(error instanceof Error ? error.message : "The chat could not be created."))
      .finally(() => setCreating(false));
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      // The Enter that confirms an input-method composition is left to the IME.
      if (isImeEnter(event, composing.current)) return;
      event.preventDefault();
      send();
    }
    if (event.key === "Escape" && busy) stop();
  };

  const jumpToLatest = () => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setPinned(true);
  };

  const selectProject = (id: string) => {
    if (id === projectId) return;
    leaveChat();
    drafts.current.set(conversationId, draft);
    setDraft("");
    setTurns([]);
    setChats([]);
    setTemporary(false);
    setHistory({ state: "idle" });
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("project", id);
      next.delete("conversation");
      return next;
    });
  };

  const selectChat = (id: string) => {
    if (id === conversationId) return;
    leaveChat();
    drafts.current.set(conversationId, draft);
    setDraft(drafts.current.get(id) ?? "");
    setTemporary(false);
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("project", projectId);
      next.set("conversation", id);
      return next;
    });
  };

  const startTemporary = () => {
    leaveChat();
    setTemporary(true);
    setTurns([]);
    setHistory({ state: "temporary" });
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("conversation");
      return next;
    });
    input.current?.focus();
  };

  const archiveChat = (id: string) => {
    void updateConversation(id, { archived: true })
      .then(() => {
        setChats((current) => current.filter((chat) => chat.id !== id));
        setHistoryNote("Chat archived. Walrus memories were not deleted.");
        if (id === conversationId) {
          leaveChat();
          setTurns([]);
          setParams((current) => {
            const next = new URLSearchParams(current);
            next.delete("conversation");
            return next;
          });
        }
      })
      .catch((error: unknown) => setHistoryError(error instanceof Error ? error.message : "The chat could not be archived."));
  };

  const renameChat = (id: string, title: string) => {
    const next = title.trim();
    if (!next) return;
    void updateConversation(id, { title: next })
      .then((result) => {
        setChats((current) => current.map((chat) => (chat.id === id ? result.conversation : chat)));
        setHistoryNote("Title saved.");
      })
      .catch((error: unknown) => setHistoryError(error instanceof Error ? error.message : "The title could not be saved."));
  };

  const loadMoreChats = () => {
    if (!moreCursor || !projectId) return;
    void listConversations(projectId, moreCursor)
      .then((page) => {
        setChats((current) => [...current, ...page.conversations.filter((chat) => !current.some((item) => item.id === chat.id))]);
        setMoreCursor(page.next_cursor);
      })
      .catch((error: unknown) => setHistoryError(error instanceof Error ? error.message : "More chats could not be loaded."));
  };

  const addProject = () => {
    const name = projectName.trim();
    if (!name || creating) return;
    const requestId = crypto.randomUUID();
    setCreating(true);
    void createProject(name, requestId)
      .then((project) => {
        setProjects((current) => [project, ...(current ?? [])]);
        setProjectName("");
        selectProject(project.id);
      })
      .catch((error: unknown) => setHistoryError(error instanceof Error ? error.message : "The project could not be created."))
      .finally(() => setCreating(false));
  };

  const retryHistory = () => {
    setHistoryError(null);
    setProjects(null);
    void listProjects().then(setProjects).catch((error: unknown) => setHistoryError(error instanceof Error ? error.message : "Chat history is unavailable."));
  };

  const pendingWrites = Object.values(writes).filter((state) => state === "saving").length;
  const blocked = !temporary && !canPersist;
  const blockedReason = historyError
    ? `Chat history is unavailable (${historyError}), so messages cannot be saved and are not sent. Use Retry in the project list, or start a temporary chat.`
    : projects === null
      ? "Loading projects…"
      : "Choose or create a project to start a saved chat. Memory is scoped to a project.";

  return (
    <>
      <header className="page-head">
        <OpenSidebarButton ctx={ctx} />
        <div className="crumbs">
          <MessageCircle size={14} /> <h1>Chat</h1>
          {agentKey ? (
            <span className="dc-muted" data-testid="chat-agent">
              {agentInfo ? `${agentInfo.name} · revision ${agentRevision ?? agentInfo.revision}` : `Agent ${agentKey}${agentRevision ? ` · revision ${agentRevision}` : ""}`}
            </span>
          ) : null}
        </div>
        <div className="actions">
          <button type="button" className="btn" disabled={creating || (turns.length === 0 && !draft && !projectId)} onClick={() => newChat()} title={pendingWrites ? "Saves already sent keep running on Walrus" : undefined}><Plus size={12} /> New chat</button>
          {draftChoice ? (
            <span className="dc-row">
              <button type="button" className="btn" onClick={() => { drafts.current.set(conversationId, draft); setDraft(""); newChat(true); }}>Keep draft</button>
              <button type="button" className="btn" onClick={() => { setDraft(""); newChat(true); }}>Discard</button>
              <button type="button" className="btn" onClick={() => setDraftChoice(false)}>Cancel</button>
            </span>
          ) : null}
        </div>
      </header>
      <div className="dc">
        <div className="dc-status" aria-label="Connection status">
          <span className="dc-pill" data-tone={proxyState.tone}>
            <span className="dc-dot" aria-hidden /> ZRouter: {proxy.error ? "Unavailable" : proxyState.label}
          </span>
          {proxyReady ? (
            <label className="dc-toggle dc-model">
              Model
              <select className="input" aria-label="Model for this conversation" value={model || proxy.data?.model_id || ""} disabled={busy} onChange={(event) => setModel(event.target.value === proxy.data?.model_id ? "" : event.target.value)}>
                {[...new Set([proxy.data?.model_id ?? "", ...(proxyModels.data?.models ?? [])].filter(Boolean))].map((id) => (
                  <option key={id} value={id}>{id}{id === proxy.data?.model_id ? " (default)" : ""}</option>
                ))}
              </select>
            </label>
          ) : null}
          <span className="dc-pill" data-tone={memoryState.tone}>
            <span className="dc-dot" aria-hidden /> Walrus Memory: {memoryState.label}
          </span>
          <label className="dc-toggle">
            <input type="checkbox" checked={useMemory && memoryUsable} disabled={!memoryUsable || busy} onChange={(event) => setUseMemory(event.target.checked)} /> Use Memory
          </label>
          <ChatSettings autoSave={autoSave} onAutoSave={setAutoSave} />
          {!proxyReady || !memoryReady ? <NavLink className="link" to="/builder/integrations">Open Integrations</NavLink> : null}
        </div>
        <div className="dc-body">
          <HistoryRail
            projects={projects}
            projectId={projectId}
            chats={chats}
            conversationId={conversationId}
            error={historyError}
            note={historyNote}
            creating={creating}
            projectName={projectName}
            onProjectName={setProjectName}
            onCreateProject={addProject}
            onSelectProject={selectProject}
            onSelectChat={selectChat}
            onArchive={archiveChat}
            onRename={renameChat}
            hasMore={moreCursor !== null}
            onMore={loadMoreChats}
            onRetry={retryHistory}
          />
          <div className="dc-main">
        <div className="dc-scroll" ref={scroller} onScroll={onScroll}>
          <div className="dc-col">
            {temporary ? (
              <p className="dc-callout" role="note">Temporary chat: nothing is saved to history and Memory is off. <button type="button" className="link" onClick={() => { setTemporary(false); setHistory({ state: "idle" }); setTurns([]); }}>Back to project chats</button></p>
            ) : null}
            {turns.length === 0 ? (
              <div className="dc-intro">
                <EmptyWhale />
                <h2 className="chat-title">What should we work on?</h2>
                <p>Product discovery, a release plan, or something else. Saved project facts are added only when they are relevant to this message.</p>
                {!proxyReady ? <p className="dc-callout" role="status">Configure ZRouter and test it until it shows Ready to start chatting. <NavLink to="/builder/integrations?connect=model">Connect model</NavLink></p> : null}
                {proxyReady && !memoryReady ? <p className="dc-callout">Walrus Memory is not connected, so this chat will not recall or save anything. <NavLink to="/builder/integrations?connect=memory">Set up project memory</NavLink></p> : null}
                {proxyReady && memoryUsable && !useMemory ? <p className="dc-callout">Memory is connected and turned off for this chat.</p> : null}
                <div className="dc-starters">
                  {STARTERS.map((starter) => (
                    <button type="button" key={starter.label} onClick={() => { setDraft(starter.draft); input.current?.focus(); }}>{starter.label}</button>
                  ))}
                </div>
              </div>
            ) : (
              <ol className="dc-turns" aria-live="polite" aria-busy={busy}>
                {turns.map((turn, index) =>
                  turn.role === "user" ? (
                    <li key={turn.id} className="dc-user">{turn.content}</li>
                  ) : (
                    <AssistantView
                      key={turn.id}
                      turn={turn}
                      canSuggest={memoryUsable && Boolean(projectId) && turns[index - 1]?.role === "user" && mayRemember(turn)}
                      onRetry={() => retry(turn.id)}
                      onContinueWithoutMemory={() => retry(turn.id, false)}
                      onSuggest={() => suggestFor(turn.id)}
                      onToggle={(factId, selected) => updateSuggestion(turn.id, factId, { selected })}
                      onEdit={(factId, text) => updateSuggestion(turn.id, factId, { text })}
                      onSave={() => {
                        const scope = turn.scope ?? (projectId ? { projectId, conversationId: conversationId || undefined } : undefined);
                        if (scope) void saveSelected(turn.id, turn.suggestions ?? [], scope, turn.agent);
                      }}
                    />
                  ),
                )}
              </ol>
            )}
          </div>
        </div>
        {!pinned ? <button type="button" className="btn dc-latest" onClick={jumpToLatest}><ArrowDown size={12} /> Jump to latest</button> : null}
        <div className="dc-foot">
          <PhaseLine phase={phase} />
          <StatusStrip history={history} writes={writes} />
          {blocked ? (
            <div className="dc-callout dc-blocked" role="alert">
              <p className="dc-muted">{blockedReason}</p>
              <div className="dc-row">
                {projects !== null || historyError ? <button type="button" className="btn" onClick={startTemporary}>Start a temporary chat (not saved, Memory off)</button> : null}
              </div>
            </div>
          ) : null}
          <form className="composer dc-composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
            <label htmlFor="dc-input" className="sr-only">Message</label>
            <textarea
              id="dc-input"
              ref={input}
              rows={2}
              placeholder={!proxyReady ? "Configure ZRouter to start" : blocked ? "Choose a project first" : temporary ? "Message (temporary, not saved)" : "Message"}
              value={draft}
              onChange={(event) => { setDraft(event.target.value); growComposer(event.target); }}
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={() => { composing.current = false; }}
              onKeyDown={onKey}
            />
            <div className="composer-row">
              <span className="hint">{busy ? "Esc or Stop to cancel" : "Enter to send · Shift+Enter for a new line"}</span>
              <span style={{ flex: 1 }} />
              {busy ? (
                <button type="button" className="btn dc-stop" onClick={stop}><Square size={10} /> Stop</button>
              ) : (
                <button type="submit" className="send" aria-label="Send" disabled={!draft.trim() || !proxyReady || blocked || creating}><ArrowUp size={13} /></button>
              )}
            </div>
          </form>
        </div>
          </div>
        </div>
      </div>
    </>
  );
}

const PHASE_LABEL: Record<Phase, string> = {
  idle: "",
  recalling: "Checking relevant saved context",
  generating: "Generating",
};

function PhaseLine({ phase }: { phase: Phase }) {
  return (
    <p className="dc-phase" role="status" data-phase={phase}>
      {phase === "idle" ? null : <><span className="dc-wave" aria-hidden><i /><i /><i /></span>{PHASE_LABEL[phase]}</>}
    </p>
  );
}

const HISTORY_LABEL: Record<HistoryStatus["state"], string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  failed: "Not saved",
  temporary: "Temporary chat, not saved",
};

/** Chat history and Memory writes are separate states; neither borrows the other's "Saved". */
export function StatusStrip({ history, writes }: { history: HistoryStatus; writes: Record<string, FactState> }) {
  const values = Object.values(writes);
  const pending = values.filter((state) => state === "saving").length;
  const stored = values.filter((state) => state === "saved").length;
  const failed = values.filter((state) => state === "failed" || state === "uncertain").length;
  const memoryParts = [pending ? `${pending} pending` : "", stored ? `${stored} stored on Walrus` : "", failed ? `${failed} not stored` : ""].filter(Boolean);
  if (history.state === "idle" && !memoryParts.length) return null;
  return (
    <p className="dc-muted dc-states" aria-live="polite">
      {history.state !== "idle" ? (
        <span data-testid="history-status" data-state={history.state}>
          Chat history: {HISTORY_LABEL[history.state]}{history.state === "failed" ? ` (${history.message})` : ""}
        </span>
      ) : null}
      {history.state !== "idle" && memoryParts.length ? " · " : null}
      {memoryParts.length ? <span data-testid="memory-writes">Memory writes: {memoryParts.join(", ")}</span> : null}
    </p>
  );
}

interface AssistantViewProps {
  turn: AssistantTurn;
  canSuggest: boolean;
  onRetry: () => void;
  onContinueWithoutMemory: () => void;
  onSuggest: () => void;
  onToggle: (factId: string, selected: boolean) => void;
  onEdit: (factId: string, text: string) => void;
  onSave: () => void;
}

function AssistantView({ turn, canSuggest, onRetry, onContinueWithoutMemory, onSuggest, onToggle, onEdit, onSave }: AssistantViewProps) {
  const memoryFailed = turn.error?.code === "memory_unavailable";
  const extraction = turn.extraction;
  return (
    <li className="dc-assistant" data-status={turn.status}>
      <MemoryUsed memory={turn.memory} />
      {turn.content ? <div className="dc-reply"><ReplyText text={turn.content} />{turn.status === "streaming" ? <span className="dc-caret" aria-hidden /> : null}</div> : null}
      {turn.status === "streaming" && !turn.content ? <p className="dc-muted">{turn.memory?.state === "recalling" ? "Recalling Memory…" : "Waiting for the first words…"}</p> : null}
      {turn.status === "stopped" ? (
        <p className="dc-muted">{turn.content ? "Interrupted. The partial reply above is kept in this chat" : "Stopped before any text arrived"}; facts already saved to Walrus stay saved. <button type="button" className="link" onClick={onRetry}>Retry</button></p>
      ) : null}
      {turn.status === "error" && turn.error ? (
        <div className="dc-error" role="alert">
          <p>{chatErrorMessage(turn.error.code, turn.error.message)}</p>
          {memoryFailed ? <p className="dc-muted">Memory was not used for this message.</p> : <p className="dc-muted">No reply was generated. Your message is kept.</p>}
          <div className="dc-row">
            <button type="button" className="btn" onClick={onRetry}><RotateCcw size={12} /> Retry</button>
            {memoryFailed ? <button type="button" className="btn" onClick={onContinueWithoutMemory}>Continue without Memory</button> : null}
          </div>
        </div>
      ) : null}
      {turn.status === "done" && turn.done?.finish_reason === "length" ? (
        <p className="dc-muted" role="note">The reply reached the maximum output token limit, so it may be cut off. Thinking models spend part of this limit on reasoning; raise it under ZRouter → Advanced.</p>
      ) : null}
      {turn.status === "done" ? <Diagnostics turn={turn} /> : null}
      {extraction?.state === "loading" ? <p className="dc-muted" data-testid="extraction-loading"><Loader2 size={11} className="spin" /> Looking for durable facts in your message…</p> : null}
      {extraction?.state === "failed" ? (
        <div className="dc-error" role="alert" data-testid="extraction-failed">
          <p>Fact suggestions failed: {extraction.message}</p>
          <p className="dc-muted">This is not the same as “no facts found”. Nothing was saved, and the reply above is unchanged.</p>
          <div className="dc-row"><button type="button" className="btn" onClick={onSuggest}><RotateCcw size={12} /> Retry suggestions</button></div>
        </div>
      ) : null}
      {turn.suggestions?.length ? <Suggestions items={turn.suggestions} onToggle={onToggle} onEdit={onEdit} onSave={onSave} /> : null}
      {extraction?.state === "done" && !turn.suggestions?.length ? <p className="dc-muted">No durable facts were found in this message. Nothing was saved.</p> : null}
      {turn.status === "done" && !extraction && canSuggest && turn.content.trim() ? (
        <p className="dc-muted"><button type="button" className="link" onClick={onSuggest}>Suggest memories from this turn</button></p>
      ) : null}
    </li>
  );
}

function MemoryUsed({ memory }: { memory?: MemoryEvent }) {
  const [open, setOpen] = useState(false);
  if (!memory || memory.state === "recalling") return null;
  if (memory.state === "off") return <p className="dc-memory" data-state="off">Memory off for this message</p>;
  if ("code" in memory) return <p className="dc-memory" data-state="failed">Memory not used · {memory.message}</p>;
  if (memory.state === "none") return <p className="dc-memory" data-state="none">No relevant memory found</p>;
  return (
    <div className="dc-memory" data-state="included">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ChevronRight size={12} className="chev" /> {memory.facts.length} saved {memory.facts.length === 1 ? "memory" : "memories"} provided as context
      </button>
      {open ? (
        <ul>
          {memory.facts.map((fact, index) => (
            <li key={`${fact.blob_id ?? "fact"}-${index}`}>
              <span>{fact.text}</span>
              <small>{fact.created_at ? `Saved ${new Date(fact.created_at).toLocaleString()}` : "Saved time not reported"}</small>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Diagnostics({ turn }: { turn: AssistantTurn }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="dc-diag">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}><ChevronRight size={12} className="chev" /> Details</button>
      {open ? (
        <dl>
          <dt>Model reported</dt><dd>{turn.done?.model_reported ?? "not reported"}</dd>
          <dt>Model requested</dt><dd>{turn.shape?.model ?? "unknown"}</dd>
          <dt>Request shape</dt><dd>{turn.shape ? turn.shape.message_roles.join(" → ") : "unknown"}</dd>
          <dt>Memory facts in request</dt><dd>{turn.shape?.memory_facts_included ?? 0}</dd>
          {turn.memory && "facts" in turn.memory ? turn.memory.facts.map((fact, index) => (
            <span key={`diag-${index}`} style={{ display: "contents" }}>
              <dt>Retrieved fact {index + 1}</dt>
              <dd>{fact.blob_id ?? "blob not reported"}{fact.distance !== null ? ` · distance ${fact.distance.toFixed(3)}` : ""}{turn.memory && "policy" in turn.memory ? ` · ${turn.memory.policy}` : ""}</dd>
            </span>
          )) : null}
          <dt>Finish reason</dt><dd>{turn.done?.finish_reason ?? "not reported"}</dd>
          {turn.done?.usage ? <><dt>Tokens</dt><dd>{turn.done.usage.prompt_tokens ?? "?"} in · {turn.done.usage.completion_tokens ?? "?"} out</dd></> : null}
        </dl>
      ) : null}
    </div>
  );
}

function growComposer(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
}

function ChatSettings({ autoSave, onAutoSave }: { autoSave: boolean; onAutoSave: (value: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="dc-settings">
      <button type="button" className="btn" aria-expanded={open} aria-controls="dc-settings-panel" onClick={() => setOpen((value) => !value)}><Settings size={12} /> Chat settings</button>
      {open ? (
        <div id="dc-settings-panel" className="dc-settings-panel" role="group" aria-label="Chat settings">
          <label className="dc-toggle">
            <input type="checkbox" checked={autoSave} onChange={(event) => onAutoSave(event.target.checked)} /> Auto-save suggestions
          </label>
          <p>{autoSave ? "Suggestions are sent to Walrus as soon as they arrive. A save stays pending until storage reports a blob." : "Suggestions stay in the chat until you choose them. Nothing is written until you save."}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Decorative whale from ascii.rest (MIT). It is not a connection or memory indicator. */
function EmptyWhale() {
  const box = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  useEffect(() => {
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    if (!media || media.matches || typeof IntersectionObserver === "undefined") return;
    const node = box.current;
    if (!node) return;
    let timer = 0;
    let started = false;
    const settle = () => {
      window.clearTimeout(timer);
      setLive(false);
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting || document.visibilityState !== "visible" || started) return;
      started = true;
      setLive(true);
      timer = window.setTimeout(settle, 5000);
    });
    observer.observe(node);
    const onHide = () => {
      if (document.visibilityState === "hidden") settle();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onHide);
      window.clearTimeout(timer);
    };
  }, []);
  const still = whale.default()(0);
  return (
    <div className="dc-whale" ref={box} aria-hidden>
      {live ? <Ascii piece={whale} mono options={{ fps: 8 }} /> : <pre className="dc-whale-still">{still}</pre>}
    </div>
  );
}

function storedTurn(message: StoredMessage): Turn {
  if (message.role === "user") return { id: message.id, role: "user", content: message.content, requestId: message.request_id };
  const status = message.status === "complete" ? "done" : message.status === "interrupted" ? "stopped" : "error";
  return {
    id: message.id,
    role: "assistant",
    content: message.content,
    status,
    error: status === "error" ? { code: "stored_error", message: "This reply failed before it finished." } : undefined,
  };
}

function HistoryRail({ projects, projectId, chats, conversationId, error, note, creating, projectName, onProjectName, onCreateProject, onSelectProject, onSelectChat, onArchive, onRename, hasMore, onMore, onRetry }: {
  projects: Project[] | null;
  projectId: string;
  chats: ConversationSummary[];
  conversationId: string;
  error: string | null;
  note: string | null;
  creating: boolean;
  projectName: string;
  onProjectName: (value: string) => void;
  onCreateProject: () => void;
  onSelectProject: (id: string) => void;
  onSelectChat: (id: string) => void;
  onArchive: (id: string) => void;
  onRename: (id: string, title: string) => void;
  hasMore: boolean;
  onMore: () => void;
  onRetry: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  return (
    <aside className="dc-history" aria-label="Projects and chats">
      {error ? <p className="dc-muted" role="alert">{error} <button type="button" className="btn" onClick={onRetry}>Retry</button></p> : null}
      {projects === null && !error ? <p className="dc-muted">Loading projects…</p> : null}
      {projects?.length === 0 ? (
        <form onSubmit={(event) => { event.preventDefault(); onCreateProject(); }}>
          <label className="dc-muted" htmlFor="dc-project-name">Create your first project</label>
          <input id="dc-project-name" className="input" value={projectName} onChange={(event) => onProjectName(event.target.value)} placeholder="Project name" />
          <button type="submit" className="btn" disabled={creating || !projectName.trim()}>Create project</button>
        </form>
      ) : null}
      {projects && projects.length > 0 ? (
        <label className="dc-muted">
          Project
          <select className="input" aria-label="Project" value={projectId} onChange={(event) => onSelectProject(event.target.value)}>
            <option value="">Select a project</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
      ) : null}
      {projectId ? (
        <ul className="dc-chat-list">
          {chats.map((chat) => (
            <li key={chat.id}>
              {editing === chat.id ? (
                <form onSubmit={(event) => { event.preventDefault(); onRename(chat.id, title); setEditing(null); }}>
                  <input className="input" aria-label={`Title for ${chat.title}`} value={title} onChange={(event) => setTitle(event.target.value)} />
                </form>
              ) : (
                <button type="button" aria-current={chat.id === conversationId} onClick={() => onSelectChat(chat.id)}>{chat.title}</button>
              )}
              <button type="button" aria-label={`Rename ${chat.title}`} onClick={() => { setEditing(chat.id); setTitle(chat.title); }}>Rename</button>
              <button type="button" aria-label={`Archive ${chat.title}`} title="Archiving hides this chat. It does not delete Walrus memories." onClick={() => onArchive(chat.id)}>Archive</button>
            </li>
          ))}
          {chats.length === 0 ? <li className="dc-muted">No chats yet. New chat starts one.</li> : null}
          {hasMore ? <li><button type="button" onClick={onMore}>More chats</button></li> : null}
        </ul>
      ) : null}
      {note ? <p className="dc-muted">{note}</p> : null}
    </aside>
  );
}

interface SuggestionsProps {
  items: Suggestion[];
  onToggle: (factId: string, selected: boolean) => void;
  onEdit: (factId: string, text: string) => void;
  onSave: () => void;
}

const STATE_LABEL: Record<FactState, string> = {
  suggested: "",
  saving: "Saving",
  saved: "Saved",
  failed: "Failed",
  uncertain: "Not confirmed",
};

function Suggestions({ items, onToggle, onEdit, onSave }: SuggestionsProps) {
  const savable = items.filter((item) => item.selected && (item.state === "suggested" || item.state === "failed" || item.state === "uncertain"));
  const retrying = savable.some((item) => item.state !== "suggested");
  return (
    <section className="dc-suggest" aria-label="Suggested memories">
      <h3>Suggested memories</h3>
      <ul>
        {items.map((item) => (
          <li key={item.id} data-state={item.state}>
            <input
              type="checkbox"
              aria-label={`Select: ${item.text}`}
              checked={item.selected}
              disabled={item.state === "saving" || item.state === "saved"}
              onChange={(event) => onToggle(item.id, event.target.checked)}
            />
            <div className="dc-fact">
              {item.state === "suggested" ? (
                <input className="dc-fact-input" value={item.text} aria-label="Edit suggested fact" onChange={(event) => onEdit(item.id, event.target.value)} />
              ) : (
                <span>{item.text}</span>
              )}
              <small>
                {item.category}
                {item.state === "saved" && item.blobId ? ` · stored on Walrus as blob ${item.blobId}` : ""}
                {item.state === "saving" && item.jobId ? ` · job ${item.jobId}` : ""}
                {item.message && item.state !== "saved" ? ` · ${item.message}` : ""}
              </small>
            </div>
            {item.state !== "suggested" ? (
              <span className="dc-fact-state" data-state={item.state}>
                {item.state === "saving" ? <Loader2 size={11} className="spin" /> : item.state === "saved" ? <Check size={11} /> : <X size={11} />}
                {STATE_LABEL[item.state]}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="dc-row">
        <button type="button" className="btn btn-primary" disabled={!savable.length} onClick={onSave}>{retrying ? "Retry selected" : "Save selected"}</button>
        <span className="hint">Saved only after Walrus confirms storage. Keys, passwords and temporary instructions are never saved.</span>
      </div>
    </section>
  );
}
