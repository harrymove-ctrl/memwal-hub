import { Blocks, Check, CircleCheck, LayoutGrid, MessageSquarePlus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { OpenSidebarButton, type ShellCtx } from "../App";
import { AppIcon } from "../components/AppIcon";
import { CATEGORIES, INTEGRATIONS, RECOMMENDED } from "../data/fixtures";
import { useStore } from "../state/store";
import "./pages.css";

type Filter = { kind: "all" } | { kind: "connected" } | { kind: "category"; value: string };

export function IntegrationsPage({ ctx }: { ctx: ShellCtx }) {
  const { state, dispatch } = useStore();
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [q, setQ] = useState("");

  const sections = useMemo(() => {
    const match = (id: string) => {
      const i = INTEGRATIONS.find((x) => x.id === id)!;
      if (q && !`${i.name} ${i.description}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (filter.kind === "connected") return state.connected[id];
      if (filter.kind === "category") return i.category === filter.value;
      return true;
    };
    const byId = (ids: string[]) => ids.filter(match).map((id) => INTEGRATIONS.find((x) => x.id === id)!);
    const groups: [string, ReturnType<typeof byId>][] = [];
    // Default view lists Recommended first and does not repeat those apps under their category (reference).
    const showRecommended = filter.kind === "all" && !q;
    if (showRecommended) groups.push(["Recommended", byId(RECOMMENDED)]);
    for (const c of CATEGORIES) {
      const ids = INTEGRATIONS.filter((i) => i.category === c && !(showRecommended && RECOMMENDED.includes(i.id))).map((i) => i.id);
      groups.push([c, byId(ids)]);
    }
    return groups.filter(([, l]) => l.length);
  }, [filter, q, state.connected]);

  const sel = (f: Filter) => JSON.stringify(f) === JSON.stringify(filter);
  return (
    <>
      <header className="page-head">
        <OpenSidebarButton ctx={ctx} />
        <div className="crumbs"><Blocks size={14} /> <h1>Integrations</h1></div>
        <div className="actions">
          <label className="search-field"><Search size={13} /><input placeholder="Search by name, etc..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search integrations" /></label>
          <button className="btn" onClick={() => ctx.notify("Requesting apps is not available in this demo.")}><MessageSquarePlus size={12} /> Request app</button>
        </div>
      </header>
      <div className="split">
        <nav className="subnav" aria-label="Integration filters">
          <button aria-current={sel({ kind: "all" }) || undefined} onClick={() => setFilter({ kind: "all" })}><LayoutGrid size={13} /> All</button>
          <button aria-current={sel({ kind: "connected" }) || undefined} onClick={() => setFilter({ kind: "connected" })}><CircleCheck size={13} /> Connected</button>
          <div className="sb-rule" />
          <h2>Categories</h2>
          {CATEGORIES.map((c) => (
            <button key={c} aria-current={sel({ kind: "category", value: c }) || undefined} onClick={() => setFilter({ kind: "category", value: c })}>{c}</button>
          ))}
        </nav>
        <div className="page-body">
          <div className="hero" aria-hidden>
            <span style={{ left: "28%", top: "24px" }}>Updated 23 tasks after the last run</span>
            <span style={{ left: "52%", top: "88px" }}>Posted 8 summaries to #design-review</span>
            <span style={{ left: "21%", top: "140px" }}>Reviewed 14 pull requests before merge</span>
          </div>
          <p className="demo-note">Demo mode: Connect toggles a local flag only — no account is linked.</p>
          {sections.map(([title, items]) => (
            <section key={title} className="int-section" aria-labelledby={`int-${title}`}>
              <h2 id={`int-${title}`}>{title}</h2>
              <ul>
                {items.map((i) => {
                  const on = state.connected[i.id];
                  return (
                    <li key={i.id}>
                      <span className="int-icon"><AppIcon app={i.id} size={18} /></span>
                      <span className="int-text"><strong>{i.name}</strong><span>{i.description}</span></span>
                      <button className={on ? "btn connected" : "btn"} aria-pressed={on} onClick={() => dispatch({ type: "setConnected", appId: i.id, value: !on })}>
                        {on ? <><Check size={12} /> Connected (demo)</> : "Connect"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {sections.length === 0 ? <p className="empty">No integrations match.</p> : null}
        </div>
      </div>
    </>
  );
}
