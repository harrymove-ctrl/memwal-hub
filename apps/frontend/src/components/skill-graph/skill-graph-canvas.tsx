import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Minus, Plus } from "lucide-react";

import { GraphCanvasScaleContext } from "./graph-canvas-scale";


const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.75;

interface SkillGraphCanvasProps {
  children: ReactNode;
  /** SVG connector paths, drawn under the nodes in canvas space. */
  connectors?: ReactNode;
}

/**
 * A pannable, zoomable node canvas over a dotted ground — after Outglow
 * Studio's agent builder (agent-builder-ui-one.vercel.app/#/agents/...).
 * Drag the background to pan, wheel or the +/- controls to zoom; nodes stay
 * plain DOM (draggable, selectable text) inside a single CSS-transformed
 * layer, while connectors live in an SVG sized to the same transform so a
 * pan or zoom never desyncs the two.
 */
export default function SkillGraphCanvas({
  children,
  connectors,
}: SkillGraphCanvasProps) {
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const dragState = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest("[data-graph-node]")) return;
      dragState.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: transform.x,
        originY: transform.y,
      };
      containerRef.current?.setPointerCapture(event.pointerId);
    },
    [transform.x, transform.y],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragState.current;
      if (!drag) return;
      setTransform((current) => ({
        ...current,
        x: drag.originX + (event.clientX - drag.startX),
        y: drag.originY + (event.clientY - drag.startY),
      }));
    },
    [],
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    dragState.current = null;
    containerRef.current?.releasePointerCapture(event.pointerId);
  }, []);

  const onWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setTransform((current) => ({
      ...current,
      scale: Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, current.scale - event.deltaY * 0.001),
      ),
    }));
  }, []);

  const zoomBy = (delta: number) =>
    setTransform((current) => ({
      ...current,
      scale: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.scale + delta)),
    }));

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onWheel={onWheel}
      className="canvas-grid-dots relative h-full w-full cursor-grab touch-none overflow-hidden bg-background active:cursor-grabbing"
      style={{
        backgroundPosition: `${transform.x}px ${transform.y}px`,
      }}
    >
      <GraphCanvasScaleContext.Provider value={transform.scale}>
        <div
          className="absolute top-0 left-0"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: "0 0",
          }}
        >
          <svg
            className="pointer-events-none absolute top-0 left-0 overflow-visible"
            aria-hidden="true"
          >
            {connectors}
          </svg>
          {children}
        </div>
      </GraphCanvasScaleContext.Provider>

      <div className="absolute right-4 bottom-4 flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-md">
        <button
          type="button"
          onClick={() => zoomBy(-0.1)}
          aria-label="Zoom out"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Minus aria-hidden="true" className="size-3.5" />
        </button>
        <span className="w-10 text-center font-mono text-[11px] text-muted-foreground">
          {Math.round(transform.scale * 100)}%
        </span>
        <button
          type="button"
          onClick={() => zoomBy(0.1)}
          aria-label="Zoom in"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus aria-hidden="true" className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
