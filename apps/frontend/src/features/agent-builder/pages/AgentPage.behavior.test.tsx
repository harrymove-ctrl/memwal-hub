import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentPage } from "./AgentPage";
import { Sidebar } from "../components/Sidebar";
import { StoreProvider } from "../state/store";
import type { RunHandle, RunService } from "../services/run-service";
import { ctx, json, memorySessionBody, mockFetch, readyProxy, type Call } from "../test/helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

function createMockRunService(): { service: RunService; triggerDone: () => void } {
  let doneCallback: (() => void) | null = null;
  const service: RunService = {
    mode: "demo",
    start: (_agentId, _prompt, cb): RunHandle => {
      doneCallback = () => cb.onDone({ status: "completed" });
      cb.onEvent({ t: "text", id: "t-1", text: "Starting run..." });
      return {
        stop: () => {
          doneCallback = null;
        },
      };
    },
  };
  return { service, triggerDone: () => doneCallback?.() };
}

function LocationSpy() {
  const loc = useLocation();
  return <div data-testid="location-spy">{loc.pathname}{loc.search}</div>;
}

function renderAgentApp(agentId = "product-discovery", service?: RunService) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const runService = service ?? createMockRunService().service;

  return render(
    <QueryClientProvider client={queryClient}>
      <StoreProvider>
        <MemoryRouter initialEntries={[`/builder/agents/${agentId}`]}>
          <LocationSpy />
          <div style={{ display: "flex" }}>
            <Sidebar onNotice={vi.fn()} mobileOpen={false} onCloseMobile={vi.fn()} hidden={false} />
            <Routes>
              <Route
                path="/builder/agents/:agentId"
                element={<AgentPage ctx={ctx} service={runService} />}
              />
              <Route
                path="/builder/chat"
                element={<div data-testid="chat-destination">Chat View</div>}
              />
            </Routes>
          </div>
        </MemoryRouter>
      </StoreProvider>
    </QueryClientProvider>,
  );
}

describe("Agent behavior & QA repair tests", () => {
  it("rename propagates to sidebar, breadcrumb, and canvas from server response and survives remount", async () => {
    let serverAgent = {
      agent_key: "product-discovery",
      name: "LaunchLens qa-initial",
      instructions: "Find target users and validate hypotheses.",
      revision: 1,
    };

    mockFetch((call: Call) => {
      if (call.url === "/model-proxy") return json(readyProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("verified"));
      if (call.url === "/agent-connections") return json([]);
      if (call.url === "/projects") return json([{ id: "proj-1", name: "Main Project" }]);
      if (call.url === "/builder-agents/product-discovery" && call.method === "GET") {
        return json(serverAgent);
      }
      if (call.url === "/builder-agents" && call.method === "POST") {
        const body = call.body as { name: string; instructions: string };
        serverAgent = {
          ...serverAgent,
          name: body.name,
          instructions: body.instructions,
          revision: serverAgent.revision + 1,
        };
        return json({
          agent_key: "product-discovery",
          name: serverAgent.name,
          instructions: serverAgent.instructions,
          revision: serverAgent.revision,
          replayed: false,
        });
      }
      return undefined;
    });

    const { unmount } = renderAgentApp("product-discovery");

    // Wait for hydration
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("LaunchLens qa-initial");
    });

    // 1. Open Agent inspector
    fireEvent.click(screen.getByRole("button", { name: "Edit Agent" }));
    const nameInput = await screen.findByLabelText("Name");
    expect(nameInput).toHaveValue("LaunchLens qa-initial");

    // 2. Edit name and Apply
    fireEvent.change(nameInput, { target: { value: "QA LaunchLens renamed qa-20261009-0318" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Unsaved changes indicator
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    // Canvas node updates immediately with draft
    expect(screen.getByText("QA LaunchLens renamed qa-20261009-0318", { selector: "strong" })).toBeInTheDocument();

    // 3. Save agent
    const saveButton = screen.getByRole("button", { name: "Save agent" });
    fireEvent.click(saveButton);

    // Wait for server save confirmation
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("QA LaunchLens renamed qa-20261009-0318");
    });

    // Sidebar must reflect authoritative name from server response
    const sidebar = screen.getByRole("navigation", { name: "Primary" });
    expect(within(sidebar).getByText("QA LaunchLens renamed qa-20261009-0318")).toBeInTheDocument();

    // Breadcrumb
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("QA LaunchLens renamed qa-20261009-0318");

    // Canvas node
    expect(screen.getByText("QA LaunchLens renamed qa-20261009-0318", { selector: "strong" })).toBeInTheDocument();

    // 4. Remount to verify survival across page reload / hydrate from GET /builder-agents/{key}
    unmount();
    renderAgentApp("product-discovery");

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("QA LaunchLens renamed qa-20261009-0318");
    });
    expect(screen.getByText("QA LaunchLens renamed qa-20261009-0318", { selector: "strong" })).toBeInTheDocument();
    const newSidebar = screen.getByRole("navigation", { name: "Primary" });
    expect(within(newSidebar).getByText("QA LaunchLens renamed qa-20261009-0318")).toBeInTheDocument();
  });

  it("unsaved-edit choice dialog: Cancel keeps edits without starting a run", async () => {
    mockFetch((call: Call) => {
      if (call.url === "/model-proxy") return json(readyProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("verified"));
      if (call.url === "/agent-connections") return json([]);
      if (call.url === "/projects") return json([{ id: "proj-1", name: "Main Project" }]);
      if (call.url === "/builder-agents/product-discovery") {
        return json({ agent_key: "product-discovery", name: "LaunchLens", instructions: "Initial instructions", revision: 1 });
      }
      return undefined;
    });

    renderAgentApp("product-discovery");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("LaunchLens"));

    // Make an edit to instructions
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const instrBox = await screen.findByLabelText("System instructions");
    fireEvent.change(instrBox, { target: { value: "Draft instructions that are unsaved" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    // Click Preview example -> should show choice dialog
    fireEvent.click(screen.getByRole("button", { name: "Preview example" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Unsaved changes")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save and start" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Use saved version" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    // Click Cancel
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    // Dialog closes, edits remain intact
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("unsaved-edit choice dialog: Use saved version runs saved revision and labels it clearly", async () => {
    mockFetch((call: Call) => {
      if (call.url === "/model-proxy") return json(readyProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("verified"));
      if (call.url === "/agent-connections") return json([]);
      if (call.url === "/projects") return json([{ id: "proj-1", name: "Main Project" }]);
      if (call.url === "/builder-agents/product-discovery") {
        return json({ agent_key: "product-discovery", name: "LaunchLens", instructions: "Initial instructions", revision: 2 });
      }
      return undefined;
    });

    renderAgentApp("product-discovery");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("LaunchLens"));

    // Make edit
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const instrBox = await screen.findByLabelText("System instructions");
    fireEvent.change(instrBox, { target: { value: "Draft instructions unsaved" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Click Preview example
    fireEvent.click(screen.getByRole("button", { name: "Preview example" }));
    const dialog = await screen.findByRole("dialog");

    // Click 'Use saved version'
    fireEvent.click(within(dialog).getByRole("button", { name: "Use saved version" }));

    // Verifies clear labeling
    await waitFor(() => {
      expect(screen.getByTestId("saved-version-notice")).toHaveTextContent(
        "Running saved revision 2; your unsaved changes are not included",
      );
    });

    // Unsaved edits are still kept
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("unsaved-edit choice dialog: Save and start failure shows error and keeps edits", async () => {
    mockFetch((call: Call) => {
      if (call.url === "/model-proxy") return json(readyProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("verified"));
      if (call.url === "/agent-connections") return json([]);
      if (call.url === "/projects") return json([{ id: "proj-1", name: "Main Project" }]);
      if (call.url === "/builder-agents/product-discovery") {
        return json({ agent_key: "product-discovery", name: "LaunchLens", instructions: "Initial instructions", revision: 1 });
      }
      if (call.url === "/builder-agents" && call.method === "POST") {
        return json({ code: "backend_error", message: "Database connection failed during save" }, 500);
      }
      return undefined;
    });

    renderAgentApp("product-discovery");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("LaunchLens"));

    // Make edit
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const instrBox = await screen.findByLabelText("System instructions");
    fireEvent.change(instrBox, { target: { value: "Draft instructions unsaved" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Trigger run -> Choice Dialog
    fireEvent.click(screen.getByRole("button", { name: "Preview example" }));
    const dialog = await screen.findByRole("dialog");

    // Click Save and start
    fireEvent.click(within(dialog).getByRole("button", { name: "Save and start" }));

    // Error is shown in the dialog
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Database connection failed during save");

    // Dialog stays open, edits remain intact (the page indicator, not the dialog title)
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // The modal hides the page from the accessibility tree, so select the breadcrumb directly.
    const crumbs = document.querySelector<HTMLElement>('nav[aria-label="Breadcrumb"]');
    expect(crumbs).not.toBeNull();
    expect(within(crumbs!).getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("unsaved-edit choice dialog: Save and start awaits POST confirmation and runs the returned revision", async () => {
    let resolveSave: ((val: Response) => void) | null = null;
    const savePromise = new Promise<Response>((resolve) => {
      resolveSave = resolve;
    });

    mockFetch((call: Call) => {
      if (call.url === "/model-proxy") return json(readyProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("verified"));
      if (call.url === "/agent-connections") return json([]);
      if (call.url === "/projects") return json([{ id: "proj-1", name: "Main Project" }]);
      if (call.url === "/builder-agents/product-discovery") {
        return json({ agent_key: "product-discovery", name: "LaunchLens", instructions: "Initial instructions", revision: 1 });
      }
      if (call.url === "/builder-agents" && call.method === "POST") {
        return savePromise;
      }
      return undefined;
    });

    renderAgentApp("product-discovery");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("LaunchLens"));

    // Make edit
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const instrBox = await screen.findByLabelText("System instructions");
    fireEvent.change(instrBox, { target: { value: "Instructions saved for run" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Trigger run
    fireEvent.click(screen.getByRole("button", { name: "Preview example" }));
    const dialog = await screen.findByRole("dialog");

    // Click Save and start
    fireEvent.click(within(dialog).getByRole("button", { name: "Save and start" }));

    // Shows waiting / saving state
    expect(within(dialog).getByRole("button", { name: "Saving…" })).toBeDisabled();

    // Server confirms revision 4
    resolveSave!(
      json({
        agent_key: "product-discovery",
        name: "LaunchLens",
        instructions: "Instructions saved for run",
        revision: 4,
        replayed: false,
      }),
    );

    // Dialog closes
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Draft committed: "Unsaved changes" is gone
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("choice dialog on Open chat navigates with exact confirmed revision", async () => {
    mockFetch((call: Call) => {
      if (call.url === "/model-proxy") return json(readyProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("verified"));
      if (call.url === "/agent-connections") return json([]);
      if (call.url === "/projects") return json([{ id: "proj-xyz", name: "Main Project" }]);
      if (call.url === "/builder-agents/product-discovery") {
        return json({ agent_key: "product-discovery", name: "LaunchLens", instructions: "Initial instructions", revision: 2 });
      }
      if (call.url === "/builder-agents" && call.method === "POST") {
        return json({
          agent_key: "product-discovery",
          name: "LaunchLens",
          instructions: "Instructions saved",
          revision: 3,
          replayed: false,
        });
      }
      return undefined;
    });

    renderAgentApp("product-discovery");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("LaunchLens"));

    // Make edit
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const instrBox = await screen.findByLabelText("System instructions");
    fireEvent.change(instrBox, { target: { value: "Instructions for chat" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Click Open chat -> shows choice dialog
    fireEvent.click(screen.getByRole("link", { name: "Open chat" }));
    const dialog = await screen.findByRole("dialog");

    // Click Save and start
    fireEvent.click(within(dialog).getByRole("button", { name: "Save and start" }));

    // Navigates to chat with rev=3 and project=proj-xyz
    await waitFor(() => {
      const loc = screen.getByTestId("location-spy").textContent;
      expect(loc).toContain("/builder/chat?agent=product-discovery&rev=3&project=proj-xyz");
    });
  });

  it("example Open chat keeps the dirty-revision dialog and Exit returns to idle", async () => {
    mockFetch((call: Call) => {
      if (call.url === "/model-proxy") return json(readyProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("verified"));
      if (call.url === "/agent-connections") return json([]);
      if (call.url === "/projects") return json([{ id: "proj-1", name: "Main Project" }]);
      if (call.url === "/builder-agents/product-discovery") {
        return json({ agent_key: "product-discovery", name: "LaunchLens", instructions: "Initial instructions", revision: 1 });
      }
      return undefined;
    });

    renderAgentApp("product-discovery");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("LaunchLens"));

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const instrBox = await screen.findByLabelText("System instructions");
    fireEvent.change(instrBox, { target: { value: "Dirty while previewing" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    fireEvent.click(screen.getByRole("button", { name: "Preview example" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Use saved version" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Exit example" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Exit example" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Preview example" })).toBeInTheDocument());
  });

  it("in-flight run keeps its revision after a later save", async () => {
    const { service } = createMockRunService();

    mockFetch((call: Call) => {
      if (call.url === "/model-proxy") return json(readyProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("verified"));
      if (call.url === "/agent-connections") return json([]);
      if (call.url === "/projects") return json([{ id: "proj-1", name: "Main Project" }]);
      if (call.url === "/builder-agents/custom-agent") {
        return json({ agent_key: "custom-agent", name: "Custom Agent", instructions: "Initial instructions", revision: 1 });
      }
      if (call.url === "/builder-agents" && call.method === "POST") {
        return json({
          agent_key: "custom-agent",
          name: "Custom Agent",
          instructions: "Later instructions revision 2",
          revision: 2,
          replayed: false,
        });
      }
      return undefined;
    });

    renderAgentApp("custom-agent", service);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Custom Agent"));

    // Start a run using composer (not discovery template, or directly via send)
    // First, verify initial revision display
    const followup = screen.getByPlaceholderText("Add a follow-up");
    fireEvent.change(followup, { target: { value: "Run prompt" } });
    fireEvent.submit(followup.closest("form")!);

    // Run starts with revision 1
    await waitFor(() => {
      expect(screen.getByTestId("run-revision-chip")).toHaveTextContent("Revision 1");
    });

    // Now user makes an edit while the run is in-flight
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const instrBox = await screen.findByLabelText("System instructions");
    fireEvent.change(instrBox, { target: { value: "Later instructions revision 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Save the new revision (header Save agent)
    fireEvent.click(screen.getByRole("button", { name: "Save agent" }));

    // Wait for save to complete
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Saved" })).toBeInTheDocument();
    });

    // The in-flight run's displayed revision must REMAIN Revision 1!
    expect(screen.getByTestId("run-revision-chip")).toHaveTextContent("Revision 1");
    expect(screen.getByTestId("run-details-revision")).toHaveTextContent("Run configuration: Revision 1");
  });

  it("tools editor only offers allowlisted memory tools and sends disabled tools as absent", async () => {
    let savedTools: string[] | undefined;

    mockFetch((call: Call) => {
      if (call.url === "/model-proxy") return json(readyProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("verified"));
      if (call.url === "/agent-connections") return json([]);
      if (call.url === "/projects") return json([{ id: "proj-1", name: "Main Project" }]);
      if (call.url === "/builder-agents/product-discovery") {
        return json({ agent_key: "product-discovery", name: "LaunchLens", instructions: "Initial instructions", revision: 1 });
      }
      if (call.url === "/builder-agents" && call.method === "POST") {
        const body = call.body as { tools?: string[] };
        savedTools = body.tools;
        return json({
          agent_key: "product-discovery",
          name: "LaunchLens",
          instructions: "Initial instructions",
          revision: 2,
          replayed: false,
        });
      }
      return undefined;
    });

    renderAgentApp("product-discovery");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("LaunchLens"));

    // Open tools editor
    fireEvent.click(screen.getByRole("button", { name: "Edit Tools" }));
    const dialog = await screen.findByRole("dialog");

    // Only allowlisted tools are offered
    expect(within(dialog).getByText("Recall project memories")).toBeInTheDocument();
    expect(within(dialog).getByText("Remember project memories")).toBeInTheDocument();
    expect(within(dialog).queryByText("list_files")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("download_file")).not.toBeInTheDocument();

    // Disable "Remember project memories"
    const checkboxes = within(dialog).getAllByRole("checkbox");
    // Uncheck remember tool
    fireEvent.click(checkboxes[1]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    // Save agent
    fireEvent.click(screen.getByRole("button", { name: "Save agent" }));

    await waitFor(() => {
      expect(savedTools).toBeDefined();
    });

    // Only memwal_recall is sent; disabled memwal_remember is absent
    expect(savedTools).toEqual(["memwal_recall"]);
  });

  it("editable inspectors enforce limits (name 1-80, instructions 1-4000) and read-only inspectors use Close action", async () => {
    mockFetch((call: Call) => {
      if (call.url === "/model-proxy") return json(readyProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("verified"));
      if (call.url === "/agent-connections") return json([]);
      if (call.url === "/projects") return json([{ id: "proj-1", name: "Main Project" }]);
      if (call.url === "/builder-agents/product-discovery") {
        return json({ agent_key: "product-discovery", name: "LaunchLens", instructions: "Initial instructions", revision: 1 });
      }
      return undefined;
    });

    renderAgentApp("product-discovery");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("LaunchLens"));

    // 1. Name validation
    fireEvent.click(screen.getByRole("button", { name: "Edit Agent" }));
    let dialog = await screen.findByRole("dialog");
    const nameInput = within(dialog).getByLabelText("Name");

    // Empty name
    fireEvent.change(nameInput, { target: { value: "   " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(within(dialog).getByText("Use an agent name between 1 and 80 characters.")).toBeInTheDocument();

    // Name > 80 chars
    fireEvent.change(nameInput, { target: { value: "a".repeat(81) } });
    expect(within(dialog).getByText("Use an agent name between 1 and 80 characters.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    // 2. Instructions validation
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    dialog = await screen.findByRole("dialog");
    const instrInput = within(dialog).getByLabelText("System instructions");

    // Empty instructions
    fireEvent.change(instrInput, { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(within(dialog).getByText("Instructions must be between 1 and 4000 characters.")).toBeInTheDocument();

    // Instructions > 4000 chars
    fireEvent.change(instrInput, { target: { value: "a".repeat(4001) } });
    expect(within(dialog).getByText("Instructions must be between 1 and 4000 characters.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    // 3. Read-only inspector uses 'Close' action
    fireEvent.click(screen.getByRole("button", { name: "Edit Research files" }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  });
});
