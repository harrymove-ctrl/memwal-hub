/**
 * A horizontal dashed bezier from one node's right edge to another's left
 * edge, after Outglow Studio's connector lines: two control points pulled
 * halfway across the gap so the curve leaves and arrives level.
 */
export function connectorPath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): string {
  const midX = fromX + (toX - fromX) / 2;
  return `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;
}
