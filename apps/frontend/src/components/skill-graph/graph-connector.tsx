import { connectorPath } from "@/utils/utils.graph-connector";

interface GraphConnectorProps {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  tone?: "primary" | "amber" | "sky";
}

const TONE_STROKE: Record<NonNullable<GraphConnectorProps["tone"]>, string> = {
  primary: "var(--primary)",
  amber: "#d97706",
  sky: "#0284c7",
};

/** One dashed connector with a dot at each end, drawn inside the canvas SVG. */
export default function GraphConnector({
  fromX,
  fromY,
  toX,
  toY,
  tone = "primary",
}: GraphConnectorProps) {
  const stroke = TONE_STROKE[tone];
  return (
    <g>
      <path
        d={connectorPath(fromX, fromY, toX, toY)}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeDasharray="4 4"
        strokeOpacity={0.55}
      />
      <circle cx={fromX} cy={fromY} r={3} fill={stroke} />
      <circle cx={toX} cy={toY} r={3} fill={stroke} />
    </g>
  );
}
