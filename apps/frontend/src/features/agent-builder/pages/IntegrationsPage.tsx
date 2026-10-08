import { Blocks, CircleCheck, LayoutGrid, MessageSquarePlus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import agentConnectionsService, { AgentConnectionServiceError, type AgentConnection } from "@/services/agent-connections";

import { OpenSidebarButton, type ShellCtx } from "../App";
import { AppIcon } from "../components/AppIcon";
import { CATEGORIES, INTEGRATIONS, RECOMMENDED } from "../data/fixtures";
import { ModelProxyDialog } from "../components/ModelProxyDialog";
import { MemoryConnectDialog, memoryDetail } from "../components/SettingsDialog";
import { proxyBadge, type ModelProxyStatus } from "../services/model-proxy";
import { memoryBadge } from "../services/wallet-recall";
import { useDisconnectMemory, useDisconnectModelProxy, useMemorySession, useModelProxyStatus } from "../state/integration-queries";
import "./pages.css";

type Filter = { kind: "all" } | { kind: "connected" } | { kind: "category"; value: string };
type RowState = "ready" | "pending" | "attention" | "off" | "unavailable";
type Badge = { label: string; tone: "ok" | "warn" | "muted" };

const PROVIDER: Record<string, "claude" | "chatgpt"> = { claude: "claude", gpt: "chatgpt" };

export function IntegrationsPage({ ctx }: { ctx: ShellCtx }) {
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [q, setQ] = useState("");
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [proxyOpen, setProxyOpen] = useState(false);
  const [callback, setCallback] = useState("");
  const [pending, setPending] = useState<AgentConnection | null>(null);
  const memory = useMemorySession();
  const proxy = useModelProxyStatus();
  const disconnectMemory = useDisconnectMemory();
  const disconnectProxy = useDisconnectModelProxy();
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const poll = useRef(0);

  useEffect(() => {
    let live = true;
    void agentConnectionsService.list().then((next) => { if (live) setConnections(next); }).catch(() => { if (live) setConnections([]); });
    return () => { live = false; poll.current += 1; };
  }, []);

  const statusOf = (id: string): RowState => {
    if (id === "console" || id === "github") return "unavailable";
    if (id === "memory") {
      const badge = memoryBadge(memory.data, memory.error, memory.isLoading);
      if (badge.label === "Ready") return "ready";
      if (badge.label === "Verifying") return "pending";
      if (badge.label === "Needs reconnect") return "attention";
      if (badge.label === "Unavailable") return "unavailable";
      return "off";
    }
    if (id === "zroute") {
      const status = proxy.data?.status;
      if (proxy.error || status === "unavailable") return "unavailable";
      if (status === "ready") return "ready";
      if (status === "untested" || status === "needs_attention") return "attention";
      if (proxy.isLoading) return "pending";
      return "off";
    }
    const provider = PROVIDER[id];
    const match = connections.find((item) => item.provider === provider);
    if (!match) return "off";
    if (match.status === "connected") return "ready";
    if (match.status === "pending") return "pending";
    if (match.status === "failed") return "attention";
    return "off";
  };

  const badgeOf = (id: string, state: RowState): Badge => {
    if (id === "console" || id === "github") return { label: "Unavailable", tone: "warn" };
    if (id === "memory") return memoryBadge(memory.data, memory.error, memory.isLoading);
    if (id === "zroute") return proxy.error ? { label: "Unavailable", tone: "warn" } : proxyBadge(proxy.data, false);
    return {
      ready: { label: "Ready", tone: "ok" },
      pending: { label: "Waiting", tone: "muted" },
      attention: { label: "Needs attention", tone: "warn" },
      off: { label: "Not connected", tone: "muted" },
      unavailable: { label: "Unavailable", tone: "warn" },
    }[state] as Badge;
  };

  const sections = useMemo(() => {
    const match = (id: string) => {
      const item = INTEGRATIONS.find((entry) => entry.id === id)!;
      if (q && !`${item.name} ${item.description}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (filter.kind === "connected") return statusOf(id) === "ready";
      if (filter.kind === "category") return item.category === filter.value;
      return true;
    };
    const byId = (ids: string[]) => ids.filter(match).map((id) => INTEGRATIONS.find((entry) => entry.id === id)!);
    const groups: [string, ReturnType<typeof byId>][] = [];
    const showRecommended = filter.kind === "all" && !q;
    if (showRecommended) groups.push(["Recommended", byId(RECOMMENDED)]);
    for (const category of CATEGORIES) {
      const ids = INTEGRATIONS.filter((item) => item.category === category && !(showRecommended && RECOMMENDED.includes(item.id))).map((item) => item.id);
      groups.push([category, byId(ids)]);
    }
    return groups.filter(([, list]) => list.length);
  }, [filter, q, memory.data, memory.error, proxy.data, proxy.error, connections]); // eslint-disable-line react-hooks/exhaustive-deps

  async function connect(id: string) {
    setError("");
    if (id === "memory") {
      if (memory.data && !memory.data.signedIn) {
        window.dispatchEvent(new Event("bew:open-settings"));
        return;
      }
      setMemoryOpen(true);
      return;
    }
    if (id === "zroute") {
      setProxyOpen(true);
      return;
    }
    if (id === "console" || id === "github") {
      ctx.notify(id === "console"
        ? "Walrus Console upload is not available. Signing in does not connect it."
        : "GitHub is not connected in this workspace.");
      return;
    }
    const provider = PROVIDER[id];
    if (!provider) return;
    const generation = ++poll.current;
    setBusyId(id);
    const popup = window.open("about:blank", "bew-connect", "popup,width=720,height=820");
    try {
      const started = await agentConnectionsService.start(provider);
      if (!started.authorization?.authorizationUrl) {
        popup?.close();
        throw new AgentConnectionServiceError("The provider did not return an authorization page.");
      }
      if (popup) popup.location.replace(started.authorization.authorizationUrl);
      else window.open(started.authorization.authorizationUrl, "_blank", "noopener");
      setConnections((current) => upsert(current, started));
      setPending(started);
      if (started.authorization?.requiresCallbackUrl) return;
      for (let attempt = 0; attempt < 30 && poll.current === generation; attempt += 1) {
        await wait(started.authorization.pollAfterSeconds * 1000 || 2000);
        if (poll.current !== generation) return;
        const next = await agentConnectionsService.get(started.id);
        setConnections((current) => upsert(current, next));
        setPending(next.status === "pending" ? next : null);
        if (next.status === "connected" || next.status === "failed") break;
      }
    } catch (caught) {
      popup?.close();
      const message = caught instanceof Error ? caught.message : "The provider connection could not be started.";
      setError(message);
      if (/unauthorized|sign in|session/i.test(message)) window.dispatchEvent(new Event("bew:open-settings"));
    } finally {
      if (poll.current === generation) setBusyId(null);
    }
  }

  async function finishAuthorization() {
    if (!pending) return;
    const value = callback.trim();
    if (!value) {
      setError("Paste the callback URL or authorization code.");
      return;
    }
    setBusyId(pending.provider);
    setError("");
    try {
      const next = await agentConnectionsService.complete(pending.id, value);
      setConnections((current) => upsert(current, next));
      setPending(next.status === "pending" ? next : null);
      setCallback("");
      if (next.status === "failed") setError(next.failureMessage ?? "The provider did not confirm the connection.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The authorization code could not be exchanged.");
    } finally {
      setBusyId(null);
    }
  }
  async function disconnect(id: string) {
    setError("");
    setBusyId(id);
    try {
      if (id === "memory") {
        await disconnectMemory.mutateAsync();
        return;
      }
      if (id === "zroute") {
        await disconnectProxy.mutateAsync();
        return;
      }
      const provider = PROVIDER[id];
      const match = connections.find((item) => item.provider === provider && item.status !== "disconnected");
      if (!match) return;
      await agentConnectionsService.disconnect(match.id);
      setConnections((current) => current.filter((item) => item.id !== match.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Disconnect failed.");
    } finally {
      setBusyId(null);
    }
  }

  const sel = (next: Filter) => JSON.stringify(next) === JSON.stringify(filter);
  return (
    <>
      <header className="page-head">
        <OpenSidebarButton ctx={ctx} />
        <div className="crumbs"><Blocks size={14} /> <h1>Integrations</h1></div>
        <div className="actions">
          <label className="search-field"><Search size={13} /><input placeholder="Search by name, etc..." value={q} onChange={(event) => setQ(event.target.value)} aria-label="Search integrations" /></label>
          <button className="btn" onClick={() => ctx.notify("Requesting apps is not available.")}><MessageSquarePlus size={12} /> Request app</button>
        </div>
      </header>
      <div className="split">
        <nav className="subnav" aria-label="Integration filters">
          <button aria-current={sel({ kind: "all" }) || undefined} onClick={() => setFilter({ kind: "all" })}><LayoutGrid size={13} /> All</button>
          <button aria-current={sel({ kind: "connected" }) || undefined} onClick={() => setFilter({ kind: "connected" })}><CircleCheck size={13} /> Connected</button>
          <div className="sb-rule" />
          <h2>Categories</h2>
          {CATEGORIES.map((category) => (
            <button key={category} aria-current={sel({ kind: "category", value: category }) || undefined} onClick={() => setFilter({ kind: "category", value: category })}>{category}</button>
          ))}
        </nav>
        <div className="page-body">
          <div className="hero" aria-hidden />
          {error ? <p className="demo-note" role="alert">{error}</p> : null}
          {pending?.authorization?.requiresCallbackUrl ? (
            <form className="int-section" onSubmit={(event) => { event.preventDefault(); void finishAuthorization(); }}>
              <h2>Finish {pending.provider} authorization</h2>
              <p className="hint">{pending.authorization.userCode ? `Code ${pending.authorization.userCode}. ` : ""}Paste the callback URL or authorization code from the provider page.</p>
              <label className="field">Callback URL<input className="input" value={callback} onChange={(event) => setCallback(event.target.value)} autoComplete="off" /></label>
              <button type="submit" className="btn btn-primary" disabled={busyId !== null}>Complete authorization</button>
            </form>
          ) : null}
          {sections.map(([title, items]) => (
            <section key={title} className="int-section" aria-labelledby={`int-${title}`}>
              <h2 id={`int-${title}`}>{title}</h2>
              <ul>
                {items.map((item) => {
                  const state = statusOf(item.id);
                  const badge = badgeOf(item.id, state);
                  const configured = isConfigured(item.id, state, memory.data?.walrus.configured, proxy.data);
                  const actionable = item.id !== "console" && item.id !== "github";
                  return (
                    <li key={item.id} data-integration={item.id}>
                      <span className="int-icon"><AppIcon app={item.id} size={18} /></span>
                      <span className="int-text"><strong>{item.name}</strong><span>{detailFor(item.id, item.description, memoryDetail(memory.data, memory.error), proxy.data, connections)}</span></span>
                      <span className="int-actions">
                        <span className={badge.tone === "ok" ? "badge" : "badge amber"} role="status" aria-label={`${item.name} status: ${badge.label}`}>{badge.label}</span>
                        {actionable ? (
                          <button type="button" className="btn" disabled={busyId === item.id} onClick={() => void connect(item.id)}>
                            {busyId === item.id ? "Working" : labelFor(item.id, configured, memory.data?.signedIn)}
                          </button>
                        ) : null}
                        {actionable && configured ? (
                          <button type="button" className="btn" disabled={busyId === item.id} onClick={() => void disconnect(item.id)}>Disconnect</button>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {sections.length === 0 ? <p className="empty">No integrations match.</p> : null}
        </div>
      </div>
      <MemoryConnectDialog open={memoryOpen} onClose={() => setMemoryOpen(false)} />
      <ModelProxyDialog open={proxyOpen} onClose={() => setProxyOpen(false)} />
    </>
  );
}

function isConfigured(id: string, state: RowState, memoryConfigured: boolean | undefined, proxy: ModelProxyStatus | undefined) {
  if (id === "memory") return Boolean(memoryConfigured);
  if (id === "zroute") return Boolean(proxy?.configured);
  return state === "ready" || state === "attention";
}

function labelFor(id: string, configured: boolean, signedIn: boolean | undefined) {
  if (id === "zroute") return configured ? "Manage" : "Configure";
  if (id === "memory" && signedIn === false) return "Sign in";
  if (configured) return id === "memory" ? "Manage" : "Reconnect";
  return "Connect";
}

function detailFor(id: string, fallback: string, memoryText: string, proxy: ModelProxyStatus | undefined, connections: AgentConnection[]) {
  if (id === "memory") return memoryText;
  if (id === "zroute") {
    if (!proxy?.configured) return fallback;
    if (proxy.status === "ready") return `${proxy.connection_name} · ${proxy.model_id}${proxy.last_model_reported ? ` · replies from ${proxy.last_model_reported}` : ""}`;
    if (proxy.status === "untested") return `${proxy.connection_name} · saved, not tested yet`;
    return proxy.last_error ?? "The last test failed.";
  }
  if (id === "console") return "Optional. Upload is not available, and nothing else depends on it.";
  if (id === "github") return "No GitHub connection is available in this workspace.";
  const provider = PROVIDER[id];
  const match = connections.find((item) => item.provider === provider);
  if (match?.accountLabel) return match.accountLabel;
  if (match?.failureMessage) return match.failureMessage;
  return fallback;
}

function upsert(items: AgentConnection[], next: AgentConnection) {
  return [...items.filter((item) => item.id !== next.id), next];
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
