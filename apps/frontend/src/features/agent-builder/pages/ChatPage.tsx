import { Ascii } from "ascii.rest/react";
import { whale } from "ascii.rest/pieces";
import { ArrowDown, ArrowUp, Check, ChevronRight, Loader2, MessageCircle, Plus, RotateCcw, Settings, Square, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { NavLink, useSearchParams } from "react-router";

import { OpenSidebarButton, type ShellCtx } from "../App";
import { ReplyText } from "../components/ReplyText";
import { BuilderApiError } from "../services/api-client";
import { appendReply, appendUserMessage, createConversation, createProject, getConversation, listConversations, listProjects, updateConversation, type ConversationSummary, type Project, type StoredMessage } from "../services/conversations";
import {
  chatErrorMessage,
  factStatus,
  saveFacts,
  streamChat,
  suggestFacts,
  type ChatTurn,
  type DoneEvent,
  type FactJob,
  type MemoryEvent,
  type RequestShape,
} from "../services/discovery-chat";
import { proxyBadge } from "../services/model-proxy";
import { memoryBadge } from "../services/wallet-recall";
import { useMemorySession, useModelProxyStatus, useProxyModels, useRefreshIntegrations } from "../state/integration-queries";
import "./pages.css";
import "./chat.css";

type Phase = "idle" | "recalling" | "generating" | "reviewing" | "saving";
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

interface AssistantTurn {
  id: string;
  role: "assistant";
  content: string;
  status: "streaming" | "done" | "error" | "stopped";
  memory?: MemoryEvent;
  shape?: RequestShape;
  done?: DoneEvent;
  error?: { code: string; message: string };
  suggestions?: Suggestion[];
  suggestionNote?: string;
}

interface UserTurn {
  id: string;
  role: "user";
  content: string;
  requestId?: string;
}

type Turn = UserTurn | AssistantTurn;

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

/** Workspace chat. Product discovery is one use; the same thread can cover other work. */
export function ChatPage({ ctx }: { ctx: ShellCtx }) {
  const [params, setParams] = useSearchParams();
  const projectId = params.get("project") ?? "";
  const conversationId = params.get("conversation") ?? "";
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
  const proxyModels = useProxyModels(proxy.data?.status === "ready");
  const [pinned, setPinned] = useState(true);
  const controller = useRef<AbortController | null>(null);
  const runId = useRef(0);
  const pollTimers = useRef<number[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const activeChat = useRef(conversationId);
  const skipLoad = useRef("");
  const inflight = useRef<{ id: string; requestId: string; reply: string } | null>(null);
  const drafts = useRef(new Map<string, string>());
  const createRequest = useRef<string | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [chats, setChats] = useState<ConversationSummary[]>([]);
  const [moreCursor, setMoreCursor] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [draftChoice, setDraftChoice] = useState(false);
  const historyReady = projects !== null && historyError === null;
  activeChat.current = conversationId;

  const proxyReady = proxy.data?.status === "ready";
  const memoryReady = memory.data?.walrus.status === "verified";
  const memoryState = memoryBadge(memory.data, memory.error, memory.isLoading);
  const proxyState = proxyBadge(proxy.data, false);
  const busy = phase === "recalling" || phase === "generating";

  useEffect(() => () => {
    controller.current?.abort();
    pollTimers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((rows) => { if (!cancelled) setProjects(rows); })
      .catch((error: unknown) => { if (!cancelled) setHistoryError(error instanceof Error ? error.message : "Chat history is unavailable."); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!historyReady || projectId || !projects || projects.length !== 1) return;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("project", projects[0].id);
      return next;
    }, { replace: true });
  }, [historyReady, projectId, projects, setParams]);

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
  }, [updateAssistant]);

  const pollJobs = useCallback((turnId: string, ids: string[], attempt: number) => {
    if (!ids.length) {
      setPhase((current) => (current === "saving" ? "idle" : current));
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const { jobs } = await factStatus(ids);
        const open: string[] = [];
        for (const job of jobs) {
          const state = factStateFromJob(job);
          updateSuggestion(turnId, job.client_id, { state, jobId: job.job_id, blobId: job.blob_id, message: job.message });
          if (state === "saving") open.push(job.client_id);
        }
        if (open.length && attempt + 1 < POLL_LIMIT) pollJobs(turnId, open, attempt + 1);
        else {
          for (const id of open) updateSuggestion(turnId, id, { state: "uncertain", message: "Storage was not confirmed yet. Check again later; nothing will be written twice." });
          setPhase((current) => (current === "saving" ? "idle" : current));
        }
      } catch (error) {
        for (const id of ids) updateSuggestion(turnId, id, { state: "uncertain", message: error instanceof Error ? error.message : "Status could not be checked." });
        setPhase((current) => (current === "saving" ? "idle" : current));
      }
    }, POLL_MS);
    pollTimers.current.push(timer);
  }, [updateSuggestion]);

  const saveSelected = useCallback(async (turnId: string, items: Suggestion[]) => {
    const chosen = items.filter((item) => item.selected && (item.state === "suggested" || item.state === "failed" || item.state === "uncertain"));
    if (!chosen.length) return;
    setPhase("saving");
    for (const item of chosen) updateSuggestion(turnId, item.id, { state: "saving", message: null });
    try {
      const { jobs } = await saveFacts(chosen.map((item) => ({ client_id: item.id, text: item.text })), projectId || undefined);
      const open: string[] = [];
      for (const job of jobs) {
        const state = factStateFromJob(job);
        updateSuggestion(turnId, job.client_id, { state, jobId: job.job_id, blobId: job.blob_id, message: job.message });
        if (state === "saving") open.push(job.client_id);
      }
      pollJobs(turnId, open, 0);
    } catch (error) {
      const message = error instanceof BuilderApiError ? error.message : "The save request did not reach the backend.";
      for (const item of chosen) updateSuggestion(turnId, item.id, { state: "uncertain", message: `${message} Retrying reuses the same idempotency key.` });
      setPhase("idle");
    }
  }, [pollJobs, updateSuggestion, projectId]);

  const loadSuggestions = useCallback(async (turnId: string, userText: string, reply: string, myRun: number) => {
    setPhase("reviewing");
    try {
      const result = await suggestFacts(userText, reply);
      if (runId.current !== myRun) return;
      const items: Suggestion[] = result.facts.map((fact) => ({ ...fact, selected: true, state: "suggested", jobId: null, blobId: null, message: null }));
      updateAssistant(turnId, (turn) => ({
        ...turn,
        suggestions: items,
        suggestionNote: items.length ? undefined : "No durable facts were found in this message.",
      }));
      setPhase("idle");
      if (autoSave && items.length) void saveSelected(turnId, items);
    } catch (error) {
      if (runId.current !== myRun) return;
      updateAssistant(turnId, (turn) => ({ ...turn, suggestionNote: `Suggestions are unavailable: ${error instanceof Error ? error.message : "request failed"}. Nothing was saved.` }));
      setPhase("idle");
    }
  }, [autoSave, saveSelected, updateAssistant]);

  const run = useCallback(async (text: string, history: Turn[], withMemory: boolean, saved?: { id: string; requestId: string }) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const myRun = ++runId.current;
    const userTurn: UserTurn = { id: newId(), role: "user", content: text, requestId: saved?.requestId };
    const assistantId = newId();
    const conversation = conversationFor(history, text);
    if (saved) inflight.current = { id: saved.id, requestId: saved.requestId, reply: "" };
    setTurns([...history, userTurn, { id: assistantId, role: "assistant", content: "", status: "streaming" }]);
    setPinned(true);
    setPhase(withMemory ? "recalling" : "generating");
    let reply = "";
    let finished = false;
    let failed = false;
    const stillHere = () => runId.current === myRun && (!saved || activeChat.current === saved.id);
    try {
      await streamChat({
        messages: conversation,
        useMemory: withMemory,
        model: model || undefined,
        projectId: projectId || undefined,
        signal: abort.signal,
        onEvent: (event) => {
          if (!stillHere()) return;
          switch (event.type) {
            case "memory":
              updateAssistant(assistantId, (turn) => ({ ...turn, memory: event.data }));
              if (event.data.state !== "recalling") setPhase("generating");
              break;
            case "request":
              updateAssistant(assistantId, (turn) => ({ ...turn, shape: event.data }));
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
      void appendReply(saved.id, saved.requestId, reply, finished ? "complete" : "error")
        .then(() => setHistoryNote("History saved"))
        .catch((error: unknown) => setHistoryNote(error instanceof Error ? error.message : "The reply was not saved to history."));
    }
    if (finished && reply.trim()) {
      void loadSuggestions(assistantId, text, reply, myRun);
      return;
    }
    if (!finished && !failed) {
      updateAssistant(assistantId, (turn) => ({ ...turn, status: "error", error: { code: "proxy_unavailable", message: "The reply ended before it finished." } }));
    }
    setDraft((current) => current || text);
    setPhase("idle");
    refresh();
  }, [loadSuggestions, refresh, updateAssistant, model, projectId]);

  const send = () => {
    const text = draft.trim();
    if (!text || busy || !proxyReady || creating) return;
    if (!historyReady || !projectId) {
      setDraft("");
      void run(text, turns, useMemory && memoryReady);
      return;
    }
    const requestId = crypto.randomUUID();
    setCreating(true);
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
          id = chat.id;
        }
        await appendUserMessage(id, requestId, text);
        setHistoryNote("History saved");
        setDraft("");
        void run(text, turns, useMemory && memoryReady, { id, requestId });
      } catch (error) {
        setHistoryNote(error instanceof Error ? `${error.message} Nothing was sent.` : "This message was not saved, so it was not sent.");
      } finally {
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
    if (flight && activeChat.current === flight.id) {
      void appendReply(flight.id, flight.requestId, flight.reply, "interrupted")
        .then(() => setHistoryNote("History saved"))
        .catch(() => setHistoryNote("The interrupted reply was not saved to history."));
    }
    input.current?.focus();
  };

  /** Re-sends the user message before a failed or stopped reply. */
  const retry = (assistantId: string, withMemory = useMemory && memoryReady) => {
    const index = turns.findIndex((turn) => turn.id === assistantId);
    const userTurn = turns[index - 1];
    if (index < 1 || userTurn?.role !== "user") return;
    if (draft.trim() === userTurn.content) setDraft("");
    const saved = userTurn.requestId && conversationId ? { id: conversationId, requestId: userTurn.requestId } : undefined;
    void run(userTurn.content, turns.slice(0, index - 1), withMemory, saved);
  };

  const newChat = (force = false) => {
    if (creating) return;
    if (!force && draft.trim()) {
      setDraftChoice(true);
      return;
    }
    setDraftChoice(false);
    stop();
    pollTimers.current.forEach((timer) => window.clearTimeout(timer));
    pollTimers.current = [];
    if (!historyReady || !projectId) {
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
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
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
    stop();
    drafts.current.set(conversationId, draft);
    setDraft("");
    setTurns([]);
    setChats([]);
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("project", id);
      next.delete("conversation");
      return next;
    });
  };

  const selectChat = (id: string) => {
    if (id === conversationId) return;
    stop();
    drafts.current.set(conversationId, draft);
    setDraft(drafts.current.get(id) ?? "");
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("project", projectId);
      next.set("conversation", id);
      return next;
    });
  };

  const archiveChat = (id: string) => {
    void updateConversation(id, { archived: true })
      .then(() => {
        setChats((current) => current.filter((chat) => chat.id !== id));
        setHistoryNote("Chat archived. Walrus memories were not deleted.");
        if (id === conversationId) {
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

  const hasPendingSaves = turns.some((turn) => turn.role === "assistant" && turn.suggestions?.some((item) => item.state === "saving"));

  return (
    <>
      <header className="page-head">
        <OpenSidebarButton ctx={ctx} />
        <div className="crumbs"><MessageCircle size={14} /> <h1>Chat</h1></div>
        <div className="actions">
          <button type="button" className="btn" disabled={creating || (turns.length === 0 && !draft && !projectId)} onClick={() => newChat()} title={hasPendingSaves ? "Saves already sent keep running on Walrus" : undefined}><Plus size={12} /> New chat</button>
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
            <input type="checkbox" checked={useMemory && memoryReady} disabled={!memoryReady || busy} onChange={(event) => setUseMemory(event.target.checked)} /> Use Memory
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
            onRetry={() => { setHistoryError(null); setProjects(null); void listProjects().then(setProjects).catch((error: unknown) => setHistoryError(error instanceof Error ? error.message : "Chat history is unavailable.")); }}
          />
          <div className="dc-main">
        <div className="dc-scroll" ref={scroller} onScroll={onScroll}>
          <div className="dc-col">
            {turns.length === 0 ? (
              <div className="dc-intro">
                <EmptyWhale />
                <h2 className="chat-title">What should we work on?</h2>
                <p>Product discovery, a release plan, or something else. Relevant context from past conversations is included only when it matches this message.</p>
                {!proxyReady ? <p className="dc-callout" role="status">Configure ZRouter and test it until it shows Ready to start chatting. <NavLink to="/builder/integrations">Open Integrations</NavLink></p> : null}
                {proxyReady && !memoryReady ? <p className="dc-callout" role="status">Walrus Memory is not connected, so this chat will not recall or save anything. <NavLink to="/builder/integrations">Open Integrations</NavLink></p> : null}
                {proxyReady && memoryReady && !useMemory ? <p className="dc-callout" role="status">Memory is connected and turned off for this chat.</p> : null}
                <div className="dc-starters">
                  {STARTERS.map((starter) => (
                    <button type="button" key={starter.label} onClick={() => { setDraft(starter.draft); input.current?.focus(); }}>{starter.label}</button>
                  ))}
                </div>
              </div>
            ) : (
              <ol className="dc-turns" aria-live="polite" aria-busy={busy}>
                {turns.map((turn) =>
                  turn.role === "user" ? (
                    <li key={turn.id} className="dc-user">{turn.content}</li>
                  ) : (
                    <AssistantView
                      key={turn.id}
                      turn={turn}
                      phase={phase}
                      memoryReady={memoryReady}
                      onRetry={() => retry(turn.id)}
                      onContinueWithoutMemory={() => retry(turn.id, false)}
                      onToggle={(factId, selected) => updateSuggestion(turn.id, factId, { selected })}
                      onEdit={(factId, text) => updateSuggestion(turn.id, factId, { text })}
                      onSave={() => void saveSelected(turn.id, turn.suggestions ?? [])}
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
          {historyNote ? <p className="dc-muted" role="status">{historyNote}</p> : null}
          <form className="composer dc-composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
            <label htmlFor="dc-input" className="sr-only">Message</label>
            <textarea id="dc-input" ref={input} rows={2} placeholder={proxyReady ? "Message" : "Configure ZRouter to start"} value={draft} onChange={(event) => { setDraft(event.target.value); growComposer(event.target); }} onKeyDown={onKey} />
            <div className="composer-row">
              <span className="hint">{busy ? "Esc or Stop to cancel" : "Enter to send · Shift+Enter for a new line"}</span>
              <span style={{ flex: 1 }} />
              {busy ? (
                <button type="button" className="btn dc-stop" onClick={stop}><Square size={10} /> Stop</button>
              ) : (
                <button type="submit" className="send" aria-label="Send" disabled={!draft.trim() || !proxyReady}><ArrowUp size={13} /></button>
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
  reviewing: "Reviewing suggested facts",
  saving: "Saving to Walrus Memory",
};

function PhaseLine({ phase }: { phase: Phase }) {
  return (
    <p className="dc-phase" role="status" data-phase={phase}>
      {phase === "idle" ? null : <><span className="dc-wave" aria-hidden><i /><i /><i /></span>{PHASE_LABEL[phase]}</>}
    </p>
  );
}

interface AssistantViewProps {
  turn: AssistantTurn;
  phase: Phase;
  memoryReady: boolean;
  onRetry: () => void;
  onContinueWithoutMemory: () => void;
  onToggle: (factId: string, selected: boolean) => void;
  onEdit: (factId: string, text: string) => void;
  onSave: () => void;
}

function AssistantView({ turn, phase, onRetry, onContinueWithoutMemory, onToggle, onEdit, onSave }: AssistantViewProps) {
  const memoryFailed = turn.error?.code === "memory_unavailable";
  return (
    <li className="dc-assistant" data-status={turn.status}>
      <MemoryUsed memory={turn.memory} />
      {turn.content ? <div className="dc-reply"><ReplyText text={turn.content} />{turn.status === "streaming" ? <span className="dc-caret" aria-hidden /> : null}</div> : null}
      {turn.status === "streaming" && !turn.content ? <p className="dc-muted">{turn.memory?.state === "recalling" ? "Recalling Memory…" : "Waiting for the first words…"}</p> : null}
      {turn.status === "stopped" ? (
        <p className="dc-muted">Stopped. The model request was cancelled; facts already saved to Walrus stay saved. <button type="button" className="link" onClick={onRetry}>Retry</button></p>
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
      {turn.suggestions?.length ? <Suggestions items={turn.suggestions} saving={phase === "saving"} onToggle={onToggle} onEdit={onEdit} onSave={onSave} /> : null}
      {turn.suggestionNote ? <p className="dc-muted">{turn.suggestionNote}</p> : null}
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
  saving: boolean;
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

function Suggestions({ items, saving, onToggle, onEdit, onSave }: SuggestionsProps) {
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
        <button type="button" className="btn btn-primary" disabled={!savable.length || saving} onClick={onSave}>{retrying ? "Retry selected" : "Save selected"}</button>
        <span className="hint">Saved only after Walrus confirms storage. Keys, passwords and temporary instructions are never saved.</span>
      </div>
    </section>
  );
}
