import { Popover } from "radix-ui";
import {
  BarChart3, Blocks, Building2, ChevronRight, ChevronsUpDown, Filter, GraduationCap, Inbox, Layers, LogOut, Megaphone,
  MessageCircle, Monitor, Moon, PanelLeft, Plus, Search, Settings2, Sparkles, Sun, LifeBuoy, User, Contrast,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router";
import { CATEGORIES, INTEGRATIONS } from "../data/fixtures";
import authService from "@/services/auth";
import { getAgentRevision, saveAgentRevision } from "../services/builder-agents";
import { listProjects } from "../services/conversations";
import { useStore } from "../state/store";
import { useMemorySession, useModelProxyStatus } from "../state/integration-queries";
import { AppIcon } from "./AppIcon";
import { SettingsDialog } from "./SettingsDialog";
import "./sidebar.css";

export function Sidebar({ onNotice, mobileOpen, onCloseMobile, hidden }: { onNotice: (m: string) => void; mobileOpen: boolean; onCloseMobile: () => void; hidden: boolean }) {
  const { state, dispatch } = useStore();
  const collapsed = state.sidebarCollapsed;
  const [settings, setSettings] = useState(false);
  const memory = useMemorySession();
  const proxy = useModelProxyStatus();
  const memoryReady = memory.data?.walrus.status === "verified";
  const proxyReady = proxy.data?.status === "ready";
  const asideRef = useRef<HTMLElement>(null);

  // One id list, joined so the effect re-runs only when agents are added or removed, never when a
  // hydrated name or revision changes (that would loop through the dispatch below).
  const serverAgentIds = state.agents
    .filter((a) => a.id === "product-discovery" || /^[0-9a-f-]{36}$/i.test(a.id))
    .map((a) => a.id)
    .join(",");
  useEffect(() => {
    for (const agentId of serverAgentIds ? serverAgentIds.split(",") : []) {
      void getAgentRevision(agentId)
        .then((row) => {
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
    }
  }, [dispatch, serverAgentIds]);
  useEffect(() => {
    const open = () => setSettings(true);
    window.addEventListener("bew:open-settings", open);
    return () => window.removeEventListener("bew:open-settings", open);
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    asideRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseMobile(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); opener?.focus?.(); };
  }, [mobileOpen, onCloseMobile]);

  return (
    <>
      {mobileOpen ? <div className="sb-scrim" onClick={onCloseMobile} aria-hidden /> : null}
      <aside
        ref={asideRef}
        className="sidebar"
        data-collapsed={collapsed}
        data-mobile-open={mobileOpen}
        aria-label="Sidebar"
        // A hidden sidebar (collapsed, or closed mobile drawer) leaves no focusable controls behind.
        inert={hidden ? true : undefined}
      >
        <div className="sb-head">
          <WorkspaceMenu onNotice={onNotice} onOpenSettings={() => setSettings(true)} />
          <button className="icon-btn" aria-label={mobileOpen ? "Close sidebar" : "Collapse sidebar"} aria-expanded={mobileOpen || !collapsed} onClick={() => (mobileOpen ? onCloseMobile() : dispatch({ type: "setSidebarCollapsed", value: true }))}>
            <PanelLeft size={14} />
          </button>
        </div>
        <button className="sb-search" onClick={() => onNotice("Search is a demo entry point in the reference.")} aria-label="Search">
          <Search size={14} /> <span>Search...</span>
          <kbd>⌘</kbd><kbd>K</kbd>
        </button>
        <nav className="sb-nav" aria-label="Primary">
          <NavLink to="/builder/chat" className="sb-item"><MessageCircle size={14} /> Chat</NavLink>
          <button className="sb-item" onClick={() => onNotice("Inbox is not available in this demo.")}><Inbox size={14} /> Inbox</button>
          <div className="sb-rule" />
          <button className="sb-item" onClick={() => onNotice("Templates are not available in this demo.")}><Layers size={14} /> Templates</button>
          <NavLink to="/builder/integrations" className="sb-item"><Blocks size={14} /> Integrations</NavLink>
          <NavLink to="/builder/skills" className="sb-item"><GraduationCap size={14} /> Skills</NavLink>
          <div className="sb-rule" />
          <div className="sb-group">
            <h2>Agents</h2>
            <NewAgentButton onNotice={onNotice} />
          </div>
          {state.agents.filter((a) => ["product-discovery", "research-companion", "meeting-follow-up", "knowledge-curator", "session-handoff"].includes(a.id) || /^[0-9a-f-]{36}$/i.test(a.id)).map((a) => (
            <NavLink key={a.id} to={`/builder/agents/${a.id}`} className="sb-item sb-agent">
              <span className="dot" aria-hidden /> {a.name}
              {state.drafts[a.id] ? <span className="sb-dirty" title="Unsaved changes" aria-label="unsaved changes">•</span> : null}
            </NavLink>
          ))}
          <button className="sb-item" onClick={() => onNotice("More agents is not available in this demo.")}><Plus size={14} /> More agents</button>
        </nav>
        <div className="sb-foot">
          <button className="sb-item" onClick={() => onNotice("Usage details are not available in this demo.")}><BarChart3 size={14} /> Usage</button>
          <button type="button" className="sb-item" onClick={() => setSettings(true)}><Settings2 size={14} /> Settings</button>
        </div>
        <section className="sb-connect" aria-labelledby="connect-h">
          <div className="sb-connect-head">
            <h2 id="connect-h">Connect your context</h2>
            <ConnectAppPopover />
          </div>
          <p>Bring memories and project files into your next session.</p>
          <div className="sb-apps">
            <span title={proxyReady ? "ZRouter · Ready" : "ZRouter · Not ready"}><AppIcon app="zroute" size={18} /></span>
            <span title={memoryReady ? "Walrus Memory · Ready" : "Walrus Memory · Not connected"}><AppIcon app="memory" size={18} /></span>
            <span title="Walrus Console · Unavailable"><AppIcon app="console" size={18} /></span>
          </div>
          <p className="hint">{memory.error ? "Memory status could not be loaded." : `ZRouter ${proxyReady ? "ready" : "not ready"} · Memory ${memoryReady ? "ready" : "not connected"} · Console unavailable`}</p>
        </section>
      </aside>
      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
    </>
  );
}

function WorkspaceMenu({ onNotice, onOpenSettings }: { onNotice: (m: string) => void; onOpenSettings: () => void }) {
  const [tab, setTab] = useState<"agents" | "workbench">("agents");
  const [appearance, setAppearance] = useState<"light" | "dark" | "system">("system");
  return (
    <>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button className="sb-ws" aria-label="Workspace menu">
            <Sparkles size={16} /> <span>MemWal</span> <ChevronsUpDown size={12} className="muted" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="pop ws-menu" align="start" sideOffset={6} aria-label="Workspace">
            <div className="seg" role="tablist" aria-label="Mode">
              {(["agents", "workbench"] as const).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === "agents" ? "Agents" : "Workbench"}</button>
              ))}
            </div>
            <a className="menu-item" href="/">MemWal home</a>
            <a className="menu-item" href="/skills">Skills catalogue</a>
            <a className="menu-item" href="/agents">Agent pools</a>
            <a className="menu-item" href="/organization">Organization</a>
            <div className="menu-sep" />
            <button className="menu-item" onClick={() => onNotice("Organization settings inside the builder are demo only. Open Organization for the real page.")}><Building2 size={14} /> Organization settings <ChevronRight size={14} className="end" /></button>
            <div className="menu-sep" />
            <button className="menu-item" onClick={() => onNotice("Profile settings: demo only.")}><User size={14} /> Profile settings <ChevronRight size={14} className="end" /></button>
            <div className="menu-item appearance">
              <Contrast size={14} /> Appearance
              <span className="end tri" role="radiogroup" aria-label="Appearance">
                {([["light", Sun], ["dark", Moon], ["system", Monitor]] as const).map(([v, Icon]) => (
                  <button key={v} role="radio" aria-checked={appearance === v} aria-label={v} onClick={() => setAppearance(v)}><Icon size={13} /></button>
                ))}
              </span>
            </div>
            <div className="menu-sep" />
            <button className="menu-item" onClick={() => onNotice("Support: demo only.")}><LifeBuoy size={14} /> Support</button>
            <button className="menu-item" onClick={() => onNotice("What's new: demo only.")}><Megaphone size={14} /> What's new</button>
            <button className="menu-item" onClick={onOpenSettings}><Settings2 size={14} /> Settings</button>
            <div className="menu-sep" />
            <button className="menu-item" onClick={() => { void authService.logout().finally(() => window.location.assign("/")); }}><LogOut size={14} /> Log out</button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

    </>
  );
}

function ConnectAppPopover() {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const items = INTEGRATIONS.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
    return ["Models", ...CATEGORIES].map((c) => [c, items.filter((i) => i.category === c)] as const).filter(([, l]) => l.length);
  }, [q]);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="icon-btn boxed" aria-label="Connect an app"><Plus size={14} /></button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="pop app-picker" side="top" align="start" sideOffset={8}>
          <div className="ap-search">
            <Search size={14} />
            <input autoFocus placeholder="Search apps" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search apps" />
            <Filter size={14} className="muted" aria-hidden />
          </div>
          <div role="listbox" aria-label="Apps" className="ap-list">
            {groups.map(([cat, list]) => (
              <div key={cat} role="group" aria-label={cat}>
                <div className="ap-cat">{cat}</div>
                {list.map((i) => (
                  <NavLink key={i.id} to="/builder/integrations" role="option" aria-selected={false} className="menu-item">
                    <AppIcon app={i.id} /> {i.name}
                  </NavLink>
                ))}
              </div>
            ))}
            {groups.length === 0 ? <div className="ap-cat">No apps match “{q}”.</div> : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function NewAgentButton({ onNotice }: { onNotice: (message: string) => void }) {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [pending, setPending] = useState(false);
  const requestId = useRef<string | null>(null);
  useEffect(() => {
    if (!open) return;
    void listProjects().then((rows) => setProjects(rows)).catch(() => setProjects([]));
  }, [open]);
  const create = () => {
    const template = state.agents.find((agent) => agent.id === "product-discovery");
    const nextName = name.trim();
    if (!template || !nextName || pending || (projects.length > 0 && !projectId)) return;
    const id = crypto.randomUUID();
    const request = requestId.current ?? crypto.randomUUID();
    requestId.current = request;
    setPending(true);
    void saveAgentRevision({
      agent_key: id,
      name: nextName,
      instructions: template.config.instructions,
      request_id: request,
      project_id: projectId || undefined,
      tools: (template.config.tools ?? [])
        .map((t) => t.technical || t.id)
        .filter((t): t is "memwal_recall" | "memwal_remember" => t === "memwal_recall" || t === "memwal_remember"),
    })
      .then((res) => {
        requestId.current = null;
        const savedName = res.name ?? nextName;
        const savedRevision = res.revision ?? 1;
        dispatch({
          type: "addAgent",
          agent: {
            ...template,
            id,
            name: savedName,
            revision: savedRevision,
            projectId: projectId || undefined,
            config: {
              ...template.config,
              name: savedName,
              instructions: res.instructions ?? template.config.instructions,
            },
          },
        });
        setOpen(false);
        setName("");
        navigate(`/builder/agents/${id}`);
      })
      .catch((error: unknown) => onNotice(error instanceof Error ? error.message : "The agent could not be created."))
      .finally(() => setPending(false));
  };
  return open ? (
    <form className="sb-item" onSubmit={(event) => { event.preventDefault(); create(); }}>
      <input aria-label="Agent name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Agent name" disabled={pending} />
      <select aria-label="Project" value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={pending}>
        <option value="">{projects.length ? "Select a project" : "No project yet"}</option>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
      <button type="submit" disabled={pending || !name.trim() || (projects.length > 0 && !projectId)}>{pending ? "Creating…" : "Create"}</button>
    </form>
  ) : (
    <button className="icon-btn" aria-label="New agent" type="button" onClick={() => setOpen(true)}><Plus size={14} /></button>
  );
}
