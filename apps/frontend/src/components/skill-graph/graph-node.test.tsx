import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import GraphNode from "./graph-node";
import { GraphCanvasScaleContext } from "./graph-canvas-scale";

function DraggableNode() {
  const [position, setPosition] = useState({ x: 40, y: 20 });
  return (
    <GraphCanvasScaleContext.Provider value={1}>
      <GraphNode
        id="node-frontmatter"
        label="Front matter"
        x={position.x}
        y={position.y}
        onMove={(x, y) => setPosition({ x, y })}
      >
        body
      </GraphNode>
    </GraphCanvasScaleContext.Provider>
  );
}

describe("GraphNode", () => {
  it("moves when the card is dragged and does not collapse", () => {
    render(<DraggableNode />);
    const node = document.getElementById("node-frontmatter");
    expect(node).not.toBeNull();

    fireEvent.pointerDown(node!, {
      button: 0,
      clientX: 100,
      clientY: 80,
      pointerId: 1,
    });
    fireEvent.pointerMove(node!, {
      clientX: 160,
      clientY: 110,
      pointerId: 1,
    });
    fireEvent.pointerUp(node!, {
      clientX: 160,
      clientY: 110,
      pointerId: 1,
    });

    expect(node).toHaveStyle({ left: "100px", top: "50px" });
    expect(screen.getByRole("button", { name: /front matter/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
