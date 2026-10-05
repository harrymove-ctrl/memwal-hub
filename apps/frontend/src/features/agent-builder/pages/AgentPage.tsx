import { Popover } from "radix-ui";
import { ArrowLeft, Check } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { OpenSidebarButton, useIsMobile, type ShellCtx } from "../App";
import type { AgentConfig, SectionId } from "../domain/types";
import type { RunService } from "../services/run-service";
import { useAgentConfig, useStore } from "../state/store";
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
  const { run, start, stop, busy } = useRun(active, agentId, active.mode === "demo");
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

  const visible = useMemo(() => {
    const v = new Set<SectionId>(ALWAYS);
    if (!config) return v;
    if (config.schedule) v.add("schedule");
    if (config.files?.length) v.add("files");
    if (config.identity || config.channels.length) v.add("channels");
    const revealed = new Set(run.events.flatMap((event) => (event.t === "reveal" ? [event.section] : [])));
    const waiting = active.mode === "demo" && (run.status === "idle" || run.status === "starting" || run.status === "running");
    if (config.tools.length && (!waiting || revealed.has("tools"))) v.add("tools");
    if (agentId === "product-discovery" && (!waiting || revealed.has("review"))) v.add("review");
    if (agentId === "product-discovery" && (!waiting || revealed.has("save"))) v.add("save");
    if (!waiting || revealed.has("subAgents")) v.add("subAgents");
    if (config.skills.length) v.add("skills");
    return v;
  }, [active.mode, config, run.events, run.status]);

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

  const onSave = () => {
    if (!dirty) return;
    setSave("saving");
    window.clearTimeout(saveTimer.current);
    // Demo persistence is synchronous; the short delay mirrors a request round-trip.
    saveTimer.current = window.setTimeout(() => {
      try {
        dispatch({ type: "commitDraft", agentId });
        setSave("saved");
        saveTimer.current = window.setTimeout(() => setSave("idle"), 1800);
      } catch {
        setSave("error");
      }
    }, 450);
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
            run={run}
            busy={busy}
            example={agent.example}
            onStop={stop}
            onRetry={() => start(agent.example?.prompt ?? null)}
            onSend={(t) => start(t)}
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
