import { Dialog, Popover } from "radix-ui";
import { ArrowLeft, Check } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { OpenSidebarButton, useIsMobile, type ShellCtx } from "../App";
import type { AgentConfig, SectionId } from "../domain/types";
import type { RunService } from "../services/run-service";
import { memoryCapabilities } from "../domain/capabilities";
import { useAgentConfig, useStore } from "../state/store";
import { getAgentRevision, saveAgentRevision } from "../services/builder-agents";
import { listProjects } from "../services/conversations";
import { useRun } from "../state/useRun";

import { Canvas, DEFAULT_VIEWPORT } from "./Canvas";
import { SectionEditor } from "./Editors";
import { RunPanel } from "./RunPanel";
import "./agent.css";

const ALWAYS: SectionId[] = ["triggers", "memory", "agent", "instructions"];

type SaveState = "idle" | "saving" | "saved" | "error";

export function AgentPage({ ctx, service }: { ctx: ShellCtx; service: RunService }) {
  const params = useParams();
  const pathId = useLocation().pathname.split("/").filter(Boolean).at(-1) ?? "";
  const agentId = params.agentId || (pathId === "agents" ? "" : pathId);
  const { state, dispatch } = useStore();
  const { agent, config, dirty } = useAgentConfig(agentId);
  const isMobile = useIsMobile();
  const [mobileView, setMobileView] = useState<"run" | "canvas">("run");
  const nav = useNavigate();

  const [active] = useState(service);
  const { run, start, stop, busy } = useRun(active, agentId, false);
  const [editing, setEditing] = useState<SectionId | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const [editingAgent, setEditingAgent] = useState(agentId);
  if (editingAgent !== agentId) {
    setEditingAgent(agentId);
    setSave("idle");
    setEditing(null);
  }
  const saveTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    void getAgentRevision(agentId)
      .then((row) => {
        if (cancelled) return;
        dispatch({
          type: "updateAgent",
          agentId,
          name: row.name,
          revision: row.revision,
          instructions: row.instructions,
          projectId: row.project_id,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [agentId, dispatch]);

  const [projectId, setProjectId] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    void listProjects()
      .then((rows) => {
        if (!cancelled && rows.length > 0) {
          setProjectId(rows[0].id);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  type PendingIntent =
    | { type: "preview" }
    | { type: "chat" }
    | { type: "send"; text: string }
    | { type: "retry" };

  const [choiceOpen, setChoiceOpen] = useState(false);
  const [pendingIntent, setPendingIntent] = useState<PendingIntent | null>(null);
  const [choiceSaving, setChoiceSaving] = useState(false);
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [previewTrigger, setPreviewTrigger] = useState(0);

  const executeRun = (intent: PendingIntent, revision: number, usingSaved: boolean) => {
    if (usingSaved) {
      setSavedNotice(`Running saved revision ${revision}; your unsaved changes are not included`);
    } else {
      setSavedNotice(null);
    }
    if (intent.type === "chat") {
      const targetProject = agent?.projectId || projectId;
      const projParam = targetProject ? `&project=${encodeURIComponent(targetProject)}` : "";
      nav(`/builder/chat?agent=${encodeURIComponent(agentId)}&rev=${revision}${projParam}`);
    } else if (intent.type === "preview") {
      setPreviewTrigger((n) => n + 1);
    } else if (intent.type === "send") {
      start(intent.text, revision);
    } else if (intent.type === "retry") {
      start(agent?.example?.prompt ?? null, revision);
    }
  };

  const requestRun = (intent: PendingIntent) => {
    if (dirty) {
      setChoiceError(null);
      setPendingIntent(intent);
      setChoiceOpen(true);
    } else {
      executeRun(intent, agent?.revision ?? 1, false);
    }
  };

  /** Stores the draft as a new server revision and commits the server's answer. */
  const persist = async () => {
    if (!config) throw new Error("The agent could not be saved.");
    const res = await saveAgentRevision({
      agent_key: agentId,
      name: config.name.trim(),
      instructions: config.instructions.trim(),
      request_id: crypto.randomUUID(),
      project_id: agent?.projectId || projectId || undefined,
      tools: memoryCapabilities(config.tools),
    });
    dispatch({
      type: "commitDraft",
      agentId,
      name: res.name ?? config.name.trim(),
      revision: res.revision,
      instructions: res.instructions ?? config.instructions.trim(),
    });
    return res.revision;
  };

  const handleSaveAndStart = async () => {
    if (!config) return;
    setChoiceSaving(true);
    setChoiceError(null);
    try {
      const revision = await persist();
      setChoiceSaving(false);
      setChoiceOpen(false);
      if (pendingIntent) {
        executeRun(pendingIntent, revision, false);
        setPendingIntent(null);
      }
    } catch (err: unknown) {
      setChoiceSaving(false);
      setChoiceError(err instanceof Error ? err.message : "The agent could not be saved.");
    }
  };

  const handleUseSavedVersion = () => {
    const savedRev = agent?.revision ?? 1;
    setChoiceOpen(false);
    setChoiceError(null);
    if (pendingIntent) {
      executeRun(pendingIntent, savedRev, true);
      setPendingIntent(null);
    }
  };

  const handleCancel = () => {
    setChoiceOpen(false);
    setPendingIntent(null);
    setChoiceError(null);
  };

  const visible = useMemo(() => {
    const v = new Set<SectionId>(ALWAYS);
    if (!config) return v;
    if (config.schedule) v.add("schedule");
    if (config.files?.length) v.add("files");
    if (config.identity || config.channels.length) v.add("channels");
    if (config.tools.length) v.add("tools");
    if (config.subAgents.length) v.add("subAgents");
    if (config.skills.length) v.add("skills");
    return v;
  }, [config]);

  const viewport = state.viewports[agentId] ?? DEFAULT_VIEWPORT;
  const onViewport = useCallback((v: typeof viewport) => dispatch({ type: "setViewport", agentId, viewport: v }), [dispatch, agentId]);

  if (!agent || !config) {
    return (
      <div className="page-body" style={{ padding: 24 }}>
        <p>Agent not found.</p>
        <Link to="/builder/agents/product-discovery">Go to Product Discovery</Link>
      </div>
    );
  }

  const onSave = async () => {
    if (!dirty || !config || save === "saving") return;
    setSave("saving");
    window.clearTimeout(saveTimer.current);
    try {
      await persist();
      setSave("saved");
      setSavedNotice(null);
      saveTimer.current = window.setTimeout(() => setSave("idle"), 1800);
    } catch {
      setSave("error");
    }
  };

  const apply = (patch: Partial<AgentConfig>) => dispatch({ type: "editDraft", agentId, patch });
  const hidden = state.runPanelHidden && !isMobile;

  return (
    <>
      <header className="page-head">
        <OpenSidebarButton ctx={ctx} />
        <button className="icon-btn" aria-label="Back to agents" onClick={() => nav(-1)}><ArrowLeft size={14} /></button>
        <nav className="crumbs" aria-label="Breadcrumb">
          <span>Agents</span><span aria-hidden>/</span><h1>{agent.name}</h1>
          {dirty ? <span className="unsaved">Unsaved changes</span> : null}
        </nav>
        <div className="actions">
          {dirty ? <button className="btn" onClick={() => dispatch({ type: "discardDraft", agentId })}>Discard</button> : null}
          <SharePopover agentName={agent.name} />
          <button className={save === "saved" ? "btn" : dirty ? "btn btn-primary" : "btn"} onClick={onSave} disabled={!dirty || save === "saving"} aria-live="polite">
            {save === "saving" ? "Saving…" : save === "saved" ? <><Check size={12} /> Saved</> : save === "error" ? "Retry save" : "Save agent"}
          </button>
        </div>
      </header>

      {isMobile ? (
        <div className="seg mobile-switch" role="tablist" aria-label="View">
          <button role="tab" aria-selected={mobileView === "run"} onClick={() => setMobileView("run")}>Run</button>
          <button role="tab" aria-selected={mobileView === "canvas"} onClick={() => setMobileView("canvas")}>Configuration</button>
        </div>
      ) : null}

      <div className="agent-body" data-run-hidden={hidden}>
        {(!isMobile || mobileView === "run") && !hidden ? (
          <RunPanel
            agentName={agent.name}
            chatTo={`/builder/chat?agent=${encodeURIComponent(agentId)}&rev=${agent.revision ?? 1}${agent?.projectId || projectId ? `&project=${encodeURIComponent(agent?.projectId || projectId)}` : ""}`}
            run={run}
            busy={busy}
            example={agent.example}
            onStop={stop}
            onRetry={() => requestRun({ type: "retry" })}
            onSend={(t) => requestRun({ type: "send", text: t })}
            onPreviewExample={() => requestRun({ type: "preview" })}
            onOpenChat={() => requestRun({ type: "chat" })}
            previewTrigger={previewTrigger}
            savedNotice={savedNotice}
            discovery={agentId === "product-discovery"}
            onNotify={ctx.notify}
            demo={active.mode === "demo"}
          />
        ) : null}
        {!isMobile || mobileView === "canvas" ? (
          <Canvas
            config={config}
            visible={visible}
            viewport={viewport}
            onViewport={onViewport}
            runPanelHidden={hidden}
            onToggleRunPanel={() => dispatch({ type: "setRunPanelHidden", value: !state.runPanelHidden })}
            onEdit={setEditing}
          />
        ) : null}
      </div>
      <SectionEditor section={editing} config={config} onClose={() => setEditing(null)} onApply={apply} />
      <Dialog.Root open={choiceOpen} onOpenChange={(open) => { if (!open && !choiceSaving) handleCancel(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="dialog" aria-describedby="choice-desc" role="dialog" aria-modal="true">
            <Dialog.Title style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 600 }}>Unsaved changes</Dialog.Title>
            <Dialog.Description id="choice-desc" className="hint" style={{ margin: "0 0 16px" }}>
              You have unsaved changes to this agent. Would you like to save and start with the new revision, run the last saved version, or cancel?
            </Dialog.Description>
            {choiceError ? (
              <p className="error" role="alert" style={{ margin: "0 0 16px" }}>
                {choiceError}
              </p>
            ) : null}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn" onClick={handleCancel} disabled={choiceSaving}>
                Cancel
              </button>
              <button type="button" className="btn" onClick={handleUseSavedVersion} disabled={choiceSaving}>
                Use saved version
              </button>
              <button type="button" className="btn btn-primary" onClick={handleSaveAndStart} disabled={choiceSaving}>
                {choiceSaving ? "Saving…" : "Save and start"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function SharePopover({ agentName }: { agentName: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild><button className="btn">Share</button></Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="pop" align="end" sideOffset={6} style={{ width: 280, padding: 14 }}>
          <strong style={{ fontWeight: 500 }}>Share {agentName}</strong>
          <p className="hint" style={{ margin: "6px 0 0", lineHeight: "18px" }}>
            Sharing is not available in this demo — no link is created and nothing leaves your browser.
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
