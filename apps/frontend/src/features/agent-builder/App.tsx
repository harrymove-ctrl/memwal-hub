import { PanelLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router";
import { Sidebar } from "./components/Sidebar";
import { realClock } from "./domain/types";
import { AgentPage } from "./pages/AgentPage";
import { ChatPage } from "./pages/ChatPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { SkillsPage } from "./pages/SkillsPage";
import { createDemoRunService, type RunService } from "./services/run-service";
import { StoreProvider, useStore } from "./state/store";
import "./styles.css";
import "./app.css";

function useMedia(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}
/** Phones: run panel and canvas become tabs. */
export const useIsMobile = () => useMedia("(max-width: 767px)");
/** Phones and tablets: the sidebar becomes an overlay drawer. */
export const useIsDrawerNav = () => useMedia("(max-width: 1023px)");

function Shell({ service }: { service: RunService }) {
  const { state, dispatch, recovered } = useStore();
  const [notice, setNotice] = useState<string | null>(recovered ? "Saved demo data was unreadable and has been reset." : null);
  const timer = useRef<number | undefined>(undefined);
  const isMobile = useIsDrawerNav();
  const loc = useLocation();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const mobileOpen = openPath === loc.pathname;
  const closeMobile = useCallback(() => setOpenPath(null), []);

  const showNotice = useCallback((m: string) => {
    setNotice(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), 3200);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const openSidebar = () => (isMobile ? setOpenPath(loc.pathname) : dispatch({ type: "setSidebarCollapsed", value: false }));
  const sidebarHidden = isMobile ? !mobileOpen : state.sidebarCollapsed;

  // On drawer layouts the opener stays mounted so focus can return to it when the drawer closes.
  const ctx = useMemo<ShellCtx>(
    () => ({ notify: showNotice, openSidebar, showOpener: isMobile || state.sidebarCollapsed, sidebarOpen: !sidebarHidden }),
    [showNotice, sidebarHidden, isMobile, state.sidebarCollapsed], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div className="shell bew-builder">
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to main content</a>
      <Sidebar onNotice={showNotice} mobileOpen={mobileOpen} onCloseMobile={closeMobile} hidden={sidebarHidden} />
      <div className="content" id="main" tabIndex={-1}>
        <BuilderPage ctx={ctx} service={service} />
      </div>
      {notice ? <div className="toast" role="status">{notice}</div> : null}
    </div>
  );
}

function BuilderPage({ ctx, service }: { ctx: ShellCtx; service: RunService }) {
  const path = useLocation().pathname.replace(/\/$/, "");
  if (path === "/builder") return <Navigate to="/builder/agents/product-discovery" replace />;
  if (path === "/builder/chat") return <ChatPage ctx={ctx} />;
  if (path === "/builder/integrations") return <IntegrationsPage ctx={ctx} />;
  if (path === "/builder/skills") return <SkillsPage ctx={ctx} />;
  if (path.startsWith("/builder/agents/")) return <AgentPage ctx={ctx} service={service} />;
  return <NotFound />;
}

export interface ShellCtx { notify: (m: string) => void; openSidebar: () => void; showOpener: boolean; sidebarOpen: boolean }

/** Shown in page headers when the sidebar is collapsed or rendered as a drawer. */
export function OpenSidebarButton({ ctx }: { ctx: ShellCtx }) {
  if (!ctx.showOpener) return null;
  return (
    <button className="icon-btn" aria-label="Open sidebar" aria-expanded={ctx.sidebarOpen} onClick={ctx.openSidebar}>
      <PanelLeft size={14} />
    </button>
  );
}

function NotFound() {
  return <div style={{ padding: 24 }}>Page not found.</div>;
}

/** `?demoFail=N` makes the demo run fail after N events (QA for the failure/retry path). */
function demoFailFromUrl(): number | undefined {
  if (typeof window === "undefined") return undefined;
  const v = new URLSearchParams(window.location.search).get("demoFail");
  return v !== null && /^\d+$/.test(v) ? Number(v) : undefined;
}
const defaultService = createDemoRunService({ clock: realClock, failAfter: demoFailFromUrl() });

export default function App({ service = defaultService }: { service?: RunService }) {
  return (
    <div style={{ height: "100vh" }}>
      <StoreProvider>
        <Shell service={service} />
      </StoreProvider>
    </div>
  );
}
