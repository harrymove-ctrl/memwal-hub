import {
  useContext,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { GraphCanvasScaleContext } from "./graph-canvas-scale";


interface GraphNodeProps {
  id: string;
  label: string;
  icon?: LucideIcon;
  badge?: string;
  children: ReactNode;
  /** Canvas-space position; the node is absolutely placed inside the transformed layer. */
  x: number;
  y: number;
  width?: number;
  defaultCollapsed?: boolean;
  /** Called with the next canvas-space origin while the card is dragged. */
  onMove?: (x: number, y: number) => void;
}

const DRAG_THRESHOLD_PX = 4;

/**
 * One collapsible node card. The header toggles the body on a click, and a
 * real drag repositions the card. `data-graph-node` keeps that drag off the
 * canvas pan handler.
 */
export default function GraphNode({
  id,
  label,
  icon: Icon,
  badge,
  children,
  x,
  y,
  width = 300,
  defaultCollapsed = false,
  onMove,
}: GraphNodeProps) {
  const scale = useContext(GraphCanvasScaleContext);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !onMove) return;
    const target = event.target as HTMLElement;
    if (target.closest("a, input, textarea, select")) return;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: x,
      originY: y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId || !onMove) return;
    const dx = (event.clientX - current.startX) / scale;
    const dy = (event.clientY - current.startY) / scale;
    if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= DRAG_THRESHOLD_PX) {
      current.moved = true;
      setDragging(true);
    }
    if (!current.moved) return;
    onMove(current.originX + dx, current.originY + dy);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    suppressClick.current = current.moved;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      id={id}
      data-graph-node
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={`absolute rounded-xl border border-border bg-card shadow-md ${dragging ? "z-10 cursor-grabbing" : "cursor-grab"}`}
      style={{ left: x, top: y, width }}
    >
      <button
        type="button"
        onClick={(event) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            event.preventDefault();
            return;
          }
          setCollapsed((value) => !value);
        }}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 border-b border-border/70 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
      >
        <ChevronDown
          aria-hidden="true"
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ${collapsed ? "-rotate-90" : ""}`}
        />
        {Icon ? (
          <Icon
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        ) : null}
        <span className="flex-1 text-sm font-medium text-foreground">
          {label}
        </span>
        {badge ? (
          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary">
            {badge}
          </span>
        ) : null}
      </button>
      {collapsed ? null : <div className="px-3 py-2.5">{children}</div>}
    </div>
  );
}
