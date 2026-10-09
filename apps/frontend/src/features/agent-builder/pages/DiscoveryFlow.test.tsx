import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { memoryCapabilities, toolsForCapabilities } from "../domain/capabilities";
import { DiscoveryFlow, type DiscoveryStage } from "./DiscoveryFlow";

function Harness() {
  const [stage, setStage] = useState<DiscoveryStage>("review");
  return (
    <DiscoveryFlow
      stage={stage}
      exampleMode
      onRead={() => undefined}
      onSave={() => setStage("save")}
      onNotify={() => undefined}
    />
  );
}

describe("example preview", () => {
  it("does not call Memory or Console and does not report a failed upload", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<Harness />);
    fireEvent.click(screen.getAllByRole("button", { name: "Select" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Preview save (not sent)" }));
    expect(screen.getByText(/Memory was not called/)).toBeInTheDocument();
    expect(screen.getByText(/Console upload is not available/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry report upload/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Console upload unavailable" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preview save (not sent)" })).toBeEnabled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("toolsForCapabilities", () => {
  it("round-trips the memory tools a revision stores", () => {
    const tools = toolsForCapabilities(["memwal_remember", "memwal_recall", "upload_file"]);
    expect(memoryCapabilities(tools)).toEqual(["memwal_recall", "memwal_remember"]);
  });
});
