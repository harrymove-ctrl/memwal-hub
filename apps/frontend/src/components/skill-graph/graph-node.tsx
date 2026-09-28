import { useState, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";

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
}

/**
 * One collapsible node card, after Outglow Studio's builder nodes: a header
 * row (chevron, label, optional status chip) over a body. The chevron
 * genuinely toggles the body, matching the reference's own affordance rather
 * than sitting there as decoration. `data-graph-node` opts the card out of
 * the canvas's own pan-drag so its content stays selectable and clickable.
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
}: GraphNodeProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div
      id={id}
      data-graph-node
      className="absolute rounded-xl border border-border bg-card shadow-md"
      style={{ left: x, top: y, width }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
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
