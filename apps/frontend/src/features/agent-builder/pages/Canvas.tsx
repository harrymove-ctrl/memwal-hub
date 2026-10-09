import { BookOpen, Bot, ChevronDown, Clock, Minus, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Puzzle } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AppIcon } from "../components/AppIcon";
import type { AgentConfig, SectionId } from "../domain/types";
import { describeCron } from "../domain/schedule";
import type { Viewport } from "../state/persist";
import "./canvas.css";

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.25;
export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

/** Zoom and pan that puts every node inside the viewport. Null when there is nothing to fit. */
export function fitViewport(
  boxes: Array<{ x: number; y: number; width: number; height: number }>,
  view: { width: number; height: number },
  limits: { min: number; max: number; pad: number } = { min: ZOOM_MIN, max: ZOOM_MAX, pad: 24 },
): Viewport | null {
  if (!boxes.length || view.width <= 0 || view.height <= 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width < 0 || box.height < 0) return null;
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const availableWidth = Math.max(1, view.width - limits.pad * 2);
  const availableHeight = Math.max(1, view.height - limits.pad * 2);
  const raw = Math.min(limits.max, availableWidth / width, availableHeight / height);
  const zoom = Math.round(Math.min(limits.max, Math.max(limits.min, raw)) * 20) / 20;
  if (!Number.isFinite(zoom) || zoom <= 0) return null;
  const x = limits.pad + (availableWidth - width * zoom) / 2 - minX * zoom;
  const y = limits.pad + (availableHeight - height * zoom) / 2 - minY * zoom;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y, zoom } : null;
}

/** World positions measured from the reference at 1440×900 (canvas origin = canvas top-left). */
const POS: Record<SectionId, { x: number; y: number }> = {
  schedule: { x: 24, y: 48 }, triggers: { x: 24, y: 48 }, channels: { x: 24, y: 200 }, memory: { x: 24, y: 210 },
  files: { x: 24, y: 390 },
  agent: { x: 268, y: 48 }, instructions: { x: 268, y: 48 },
  tools: { x: 512, y: 48 }, review: { x: 268, y: 460 }, save: { x: 512, y: 460 },
  subAgents: { x: 756, y: 48 }, skills: { x: 756, y: 220 },
};
const LEFT: SectionId[] = ["schedule", "triggers", "channels", "memory", "files"];
const RIGHT: SectionId[] = ["tools", "review", "save", "subAgents", "skills"];
const EDGE_COLOR: Partial<Record<SectionId, string>> = { triggers: "var(--blue)", memory: "var(--blue)", files: "#0f766e", channels: "rgb(240,170,60)" };

interface Props {
  config: AgentConfig;
  visible: Set<SectionId>;
  viewport: Viewport;
  onViewport: (v: Viewport) => void;
  runPanelHidden: boolean;
  onToggleRunPanel: () => void;
  onEdit: (s: SectionId) => void;
}

export function Canvas({ config, visible, viewport, onViewport, runPanelHidden, onToggleRunPanel, onEdit }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<SectionId, HTMLElement>());
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [stack, setStack] = useState<Partial<Record<SectionId, number>>>({});
  const [edges, setEdges] = useState<{ id: string; d: string; color: string; a: [number, number] }[]>([]);
  const [animating, setAnimating] = useState(false);
  const vp = useRef(viewport);
  useLayoutEffect(() => { vp.current = viewport; }, [viewport]);

  const isOpen = (s: SectionId) => expanded[s] ?? s !== "instructions";
  const toggle = (s: SectionId) => setExpanded((e) => ({ ...e, [s]: !(e[s] ?? s !== "instructions") }));

  // Connectors use layout offsets inside the untransformed world, so they stay
  // attached at any zoom/pan and re-measure when sections resize.
  const measure = useCallback(() => {
    const get = (s: SectionId) => nodes.current.get(s);
    const agentEl = get("agent");
    if (!agentEl) return;
    const target: [number, number] = [agentEl.offsetLeft - 8, agentEl.offsetTop + (get("instructions")?.offsetTop ?? 120) + 10];
    const source: [number, number] = [agentEl.offsetLeft + agentEl.offsetWidth + 8, target[1]];
    const curve = (from: [number, number], to: [number, number]) => {
      const mx = (from[0] + to[0]) / 2;
      return `M${from[0]},${from[1]} C${mx},${from[1]} ${mx},${to[1]} ${to[0]},${to[1]}`;
    };
    const out: typeof edges = [];
    for (const s of LEFT) {
      const el = get(s);
      if (!el || !visible.has(s)) continue;
      const a: [number, number] = [el.offsetLeft + el.offsetWidth + 8, el.offsetTop + el.offsetHeight / 2];
      out.push({ id: s, d: curve(a, target), color: EDGE_COLOR[s] ?? "var(--text-3)", a });
    }
    for (const s of RIGHT) {
      const el = get(s);
      if (!el || !visible.has(s)) continue;
      const b: [number, number] = [el.offsetLeft - 8, el.offsetTop + el.offsetHeight / 2];
      out.push({ id: s, d: curve(source, b), color: "var(--text-3)", a: b });
    }
    setEdges(out);
  }, [visible]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    nodes.current.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [measure, config, expanded]);
  useLayoutEffect(() => {
    let y = 48;
    const next: Partial<Record<SectionId, number>> = {};
    for (const id of ["triggers", "memory", "files"] as const) {
      const el = nodes.current.get(id);
      if (!el) continue;
      next[id] = y;
      y += el.offsetHeight + 20;
    }
    setStack((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [config, expanded, visible]);
  // Pan like the reference: drag the canvas or a card. A click without movement still toggles.
  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("a, input, textarea, .cv-edit, .cv-more")) return;
    drag.current = { px: e.clientX, py: e.clientY, x: viewport.x, y: viewport.y, moved: false };
    setAnimating(false);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    onViewport({ ...viewport, x: d.x + dx, y: d.y + dy });
  };
  const endDrag = (e: React.PointerEvent) => {
    if (drag.current?.moved) e.preventDefault();
    drag.current = null;
  };

  // Keyboard alternative to drag: arrows pan (Shift = larger steps), +/- zoom, 0 resets.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const step = e.shiftKey ? 160 : 40;
    const pan: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (pan[e.key]) {
      e.preventDefault();
      setAnimating(true);
      onViewport({ ...viewport, x: viewport.x + pan[e.key][0], y: viewport.y + pan[e.key][1] });
    } else if (e.key === "+" || e.key === "=") zoomTo(viewport.zoom + ZOOM_STEP);
    else if (e.key === "-") zoomTo(viewport.zoom - ZOOM_STEP);
    else if (e.key === "0") { setAnimating(true); onViewport(DEFAULT_VIEWPORT); }
  };

  const zoomTo = (z: number) => {
    const zoom = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100;
    const el = wrap.current;
    if (!el) return onViewport({ ...viewport, zoom });
    // Keep the canvas centre fixed while zooming.
    const cx = el.clientWidth / 2, cy = el.clientHeight / 2;
    const wx = (cx - viewport.x) / viewport.zoom, wy = (cy - viewport.y) / viewport.zoom;
    setAnimating(true);
    onViewport({ zoom, x: cx - wx * zoom, y: cy - wy * zoom });
  };
  const fitWorkflow = () => {
    const el = wrap.current;
    if (!el) return;
    const boxes = [...nodes.current.values()].map((node) => ({ x: node.offsetLeft, y: node.offsetTop, width: node.offsetWidth, height: node.offsetHeight }));
    const next = fitViewport(boxes, { width: el.clientWidth, height: el.clientHeight });
    if (!next) return;
    setAnimating(true);
    onViewport(next);
  };
  const pct = Math.round(viewport.zoom * 100);

  const register = (s: SectionId) => (el: HTMLElement | null) => { if (el) nodes.current.set(s, el); else nodes.current.delete(s); };

  const section = (s: SectionId, title: ReactNode, body: ReactNode, opts: { tone?: "new" | "plain"; badge?: ReactNode } = {}) =>
    visible.has(s) ? (
      <section
        key={s}
        ref={register(s)}
        className="cv-section"
        data-tone={opts.tone ?? "plain"}
        data-reveal
        style={{ left: POS[s].x, top: stack[s] ?? POS[s].y }}
        aria-labelledby={`cv-${s}`}
      >
        <div className="cv-head">
          <button id={`cv-${s}`} className="cv-toggle" aria-expanded={isOpen(s)} onClick={() => toggle(s)}>
            <ChevronDown size={12} className="cv-chev" /> {title} {opts.badge}
          </button>
          <button className="cv-edit" aria-label={`Edit ${typeof title === "string" ? title : s}`} onClick={() => onEdit(s)}><Pencil size={12} /></button>
        </div>
        <div className="cv-collapse" data-open={isOpen(s)}><div>{body}</div></div>
      </section>
    ) : null;

  const sched = config.schedule;
  return (
    <div className="canvas-wrap" ref={wrap}>
      <button className="icon-btn boxed cv-runtoggle" aria-label={runPanelHidden ? "Show run panel" : "Hide run panel"} onClick={onToggleRunPanel}>
        {runPanelHidden ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
      </button>
      <div
        className="canvas"
        role="region"
        aria-label="Agent configuration canvas"
        aria-describedby="cv-keys"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ backgroundPosition: `${viewport.x}px ${viewport.y}px`, backgroundSize: `${16 * viewport.zoom}px ${16 * viewport.zoom}px` }}
      >
        <div
          ref={world}
          className="cv-world"
          data-animating={animating}
          onTransitionEnd={() => setAnimating(false)}
          style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}
        >
          <svg className="cv-edges" aria-hidden width="1200" height="1000">
            {edges.map((e) => (
              <g key={e.id}>
                <path d={e.d} stroke={e.color} />
                <circle cx={e.a[0]} cy={e.a[1]} r={2.5} fill={e.color} />
              </g>
            ))}
          </svg>

          {section("schedule", "Start",
            sched ? (
              <ul className="cv-rows">
                <li><Clock size={13} /><span className="cv-t">{describeCron(sched.cron)} <span className="sep">·</span> {sched.label}</span></li>
                <li><span className="cv-t">Template setting. Scheduling is not running.</span></li>
              </ul>
            ) : <p className="cv-empty">When you send a message. Scheduling is not connected.</p>)}
          {section("triggers", "Start",
            config.triggers.length ? (
              <ul className="cv-rows">
                {config.triggers.map((t) => <li key={t.id} title={t.filter}><AppIcon app={t.app} size={14} /><span className="cv-t">{t.name}</span></li>)}
              </ul>
            ) : <p className="cv-empty">When you send a message</p>)}
          {section("channels", "Channels",
            config.identity ? (
              <ul className="cv-rows">{config.channels.length ? config.channels.map((c) => <li key={c}>{c}</li>) : <li className="cv-empty">No channels yet</li>}</ul>
            ) : <p className="cv-note">No channel is connected.</p>)}
          {section("memory", "Memory",
            config.memory.length ? (
              <ul className="cv-rows">{config.memory.map((m) => (
                <li key={m.id} title={m.detail}><BookOpen size={13} /><span className="cv-copy"><span className="cv-t">{m.name}</span>{m.detail ? <span className="cv-sub">{m.detail}</span> : null}</span></li>
              ))}</ul>
            ) : <p className="cv-empty">No memory scope connected.</p>)}
          {section("files", "Research files",
            config.files?.length ? (
              <>
                <p className="cv-kicker">MemWal / Product Discovery</p>
                <ul className="cv-rows">{config.files.slice(0, 3).map((file) => <li key={file.name}><AppIcon app="console" size={14} /><span className="cv-t">{file.name}</span></li>)}</ul>
              </>
            ) : <p className="cv-empty">No project folder connected.</p>)}

          {visible.has("agent") ? (
            <section ref={register("agent")} className="cv-section cv-agent" style={{ left: POS.agent.x, top: POS.agent.y }} aria-labelledby="cv-agent">
              <div className="cv-head">
                <button id="cv-agent" className="cv-toggle" aria-expanded={isOpen("agent")} onClick={() => toggle("agent")}><ChevronDown size={12} className="cv-chev" /> Agent</button>
                <button className="cv-edit" aria-label="Edit Agent" onClick={() => onEdit("agent")}><Pencil size={12} /></button>
              </div>
              <div className="cv-collapse" data-open={isOpen("agent")}><div>
                <div className="cv-card"><strong>{config.name}</strong><p>{config.description}</p></div>
              </div></div>
              <div className="cv-head" ref={register("instructions")}>
                <button className="cv-toggle" aria-expanded={isOpen("instructions")} onClick={() => toggle("instructions")}><ChevronDown size={12} className="cv-chev" /> Instructions</button>
              </div>
              <div className="cv-collapse" data-open={isOpen("instructions")}><div>
                <div className="cv-card cv-instr">
                  <button className="btn cv-instr-edit" onClick={() => onEdit("instructions")}>Edit</button>
                  <p>{config.instructions}</p>
                </div>
              </div></div>
            </section>
          ) : null}

          {section("tools", "Tools", <ToolRows tools={config.tools} />)}
          {section("subAgents", "Sub-agents", config.subAgents.length ? <ul className="cv-rows">{config.subAgents.map((s) => <li key={s}><Bot size={13} /> {s}</li>)}</ul> : <p className="cv-empty">No sub-agents configured</p>)}
          {section("skills", "Skills", config.skills.length ? <ul className="cv-rows">{config.skills.map((s) => <li key={s}><Puzzle size={13} /> {s}</li>)}</ul> : <p className="cv-empty">No skills configured</p>)}
        </div>
      </div>

      <p id="cv-keys" hidden>Use arrow keys to pan, plus and minus to zoom, 0 to reset.</p>
      <div className="cv-zoom" role="group" aria-label="Zoom">
        <button className="icon-btn" aria-label="Zoom in" onClick={() => zoomTo(viewport.zoom + ZOOM_STEP)} disabled={viewport.zoom >= ZOOM_MAX}><Plus size={13} /></button>
        <button className="cv-pct" aria-label="Reset to 100 percent" onClick={() => { setAnimating(true); onViewport(DEFAULT_VIEWPORT); }}>{pct}%</button>
        <button className="icon-btn" aria-label="Fit workflow" onClick={() => fitWorkflow()}>Fit</button>
        <button className="icon-btn" aria-label="Zoom out" onClick={() => zoomTo(viewport.zoom - ZOOM_STEP)} disabled={viewport.zoom <= ZOOM_MIN}><Minus size={13} /></button>
      </div>
    </div>
  );
}

function ToolRows({ tools }: { tools: AgentConfig["tools"] }) {
  const [advanced, setAdvanced] = useState(false);
  const groups = [
    ["read", "Read"],
    ["save", "Save"],
    ["advanced", "Advanced"],
  ] as const;
  if (!tools.length) {
    return <p className="cv-empty">No memory tools configured</p>;
  }
  return (
    <div className="cv-tool-groups">
      {groups.map(([group, label]) => {
        const rows = tools.filter((tool) => (tool.group ?? "read") === group);
        if (!rows.length) return null;
        if (group === "advanced" && !advanced) {
          return <button key={group} className="cv-more" type="button" onClick={() => setAdvanced(true)}>Show advanced</button>;
        }
        return (
          <div key={group}>
            <p className="cv-kicker">{label}</p>
            <ul className="cv-rows">
              {rows.map((tool) => (
                <li key={tool.id} title={tool.detail}><AppIcon app={tool.app} size={14} /><span className="cv-copy"><span className="cv-t">{tool.name}</span>{tool.technical ? <span className="cv-sub">{tool.technical}</span> : null}</span></li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}


