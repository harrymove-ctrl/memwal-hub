import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocation } from "react-router";

import { IntegrationsPage } from "./IntegrationsPage";
import { SettingsDialog } from "../components/SettingsDialog";
import { ctx, json, memorySessionBody, mockFetch, notConfiguredProxy, readyProxy, renderWithClient } from "../test/helpers";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

function renderIntegrations(entry: string) {
  return renderWithClient(
    <>
      <LocationProbe />
      <IntegrationsPage ctx={ctx} />
    </>,
    [entry],
  );
}

afterEach(() => vi.unstubAllGlobals());

function row(name: string) {
  return screen.getByText(name, { selector: "strong" }).closest("li") as HTMLElement;
}

describe("IntegrationsPage (mocked backend)", () => {
  it("shows separate ZRouter, Memory and Console cards without fake Console controls", async () => {
    mockFetch((call) => {
      if (call.url === "/model-proxy") return json(notConfiguredProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("verified"));
      if (call.url === "/agent-connections") return json([]);
      return undefined;
    });
    renderWithClient(<IntegrationsPage ctx={ctx} />);
    await waitFor(() => expect(within(row("Walrus Memory")).getByRole("status")).toHaveTextContent("Ready"));
    const proxy = row("ZRouter / OpenAI-compatible proxy");
    expect(within(proxy).getByText("Use your proxy endpoint and model for chat responses.")).toBeInTheDocument();
    expect(within(proxy).getByRole("status")).toHaveTextContent("Not configured");
    expect(within(proxy).getByRole("button", { name: "Configure" })).toBeInTheDocument();
    expect(screen.getAllByText("Walrus Console", { selector: "strong" })).toHaveLength(1);
    const consoleRow = row("Walrus Console");
    expect(within(consoleRow).getByRole("status")).toHaveTextContent("Unavailable");
    expect(within(consoleRow).queryByRole("button")).not.toBeInTheDocument();
    const memoryRow = row("Walrus Memory");
    expect(within(memoryRow).getByRole("button", { name: "Manage" })).toBeInTheDocument();
    expect(within(memoryRow).getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it("clicking Manage on a Ready card opens settings and does not disconnect", async () => {
    const { calls } = mockFetch((call) => {
      if (call.url === "/model-proxy") return json(readyProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("verified"));
      if (call.url === "/agent-connections") return json([]);
      return undefined;
    });
    renderWithClient(<IntegrationsPage ctx={ctx} />);
    const proxy = await waitFor(() => {
      const element = row("ZRouter / OpenAI-compatible proxy");
      expect(within(element).getByRole("status")).toHaveTextContent("Ready");
      return element;
    });
    fireEvent.click(within(proxy).getByRole("button", { name: "Manage" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("ZRouter / OpenAI-compatible proxy");
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("reports a Memory API failure as Unavailable, not Not connected", async () => {
    mockFetch((call) => {
      if (call.url === "/model-proxy") return json(notConfiguredProxy);
      if (call.url === "/memory/session") return json({ code: "backend_error", message: "Walrus Memory status could not be read from the database." }, 500);
      if (call.url === "/agent-connections") return json([]);
      return undefined;
    });
    renderWithClient(<IntegrationsPage ctx={ctx} />);
    await waitFor(() => expect(within(row("Walrus Memory")).getByRole("status")).toHaveTextContent("Unavailable"));
    expect(within(row("Walrus Memory")).getByText(/could not be read from the database/)).toBeInTheDocument();
  });

  it("refreshes the card after Test connection without a reload, and the key never reaches the page", async () => {
    let state: Record<string, unknown> = notConfiguredProxy;
    const { calls } = mockFetch((call) => {
      if (call.url === "/model-proxy" && call.method === "GET") return json(state);
      if (call.url === "/model-proxy" && call.method === "POST") {
        state = { ...readyProxy, base_url: "https://proxy.example.com/v1", model_id: "model-a" };
        return json(state);
      }
      if (call.url === "/memory/session") return json(memorySessionBody("not_connected"));
      if (call.url === "/agent-connections") return json([]);
      return undefined;
    });
    renderWithClient(<IntegrationsPage ctx={ctx} />);
    const proxy = await waitFor(() => {
      const element = row("ZRouter / OpenAI-compatible proxy");
      expect(within(element).getByRole("status")).toHaveTextContent("Not configured");
      return element;
    });
    fireEvent.click(within(proxy).getByRole("button", { name: "Configure" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByLabelText(/API base URL/);
    fireEvent.change(within(dialog).getByLabelText(/API base URL/), { target: { value: "https://proxy.example.com/v1" } });
    fireEvent.change(within(dialog).getByLabelText(/API key/), { target: { value: "secret-test-key-123" } });
    // Without a provider list the model is typed in the main form, not under Advanced.
    fireEvent.change(within(dialog).getByLabelText(/^Model ID/), { target: { value: "model-a" } });
    expect(within(dialog).getByLabelText(/API key/)).toHaveAttribute("type", "password");
    fireEvent.click(within(dialog).getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(within(dialog).getByRole("status", { name: /connection status/i })).toHaveTextContent("Ready"));
    const post = calls.find((call) => call.method === "POST");
    expect(post?.body).toMatchObject({ test: true, api_key: "secret-test-key-123", model_id: "model-a" });
    expect(within(dialog).getByLabelText(/API key/)).toHaveValue("");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(row("ZRouter / OpenAI-compatible proxy")).getByRole("status")).toHaveTextContent("Ready");
    expect(calls.filter((call) => call.url === "/model-proxy" && call.method === "GET")).toHaveLength(1);
    expect(document.body.innerHTML).not.toContain("secret-test-key-123");
    expect(JSON.stringify(window.localStorage)).not.toContain("secret-test-key-123");
    expect(JSON.stringify(window.sessionStorage)).not.toContain("secret-test-key-123");
  });

  it("shows validation errors and sends nothing for an incomplete form", async () => {
    const { calls } = mockFetch((call) => {
      if (call.url === "/model-proxy") return json(notConfiguredProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("not_connected"));
      if (call.url === "/agent-connections") return json([]);
      return undefined;
    });
    renderWithClient(<IntegrationsPage ctx={ctx} />);
    const proxy = await waitFor(() => row("ZRouter / OpenAI-compatible proxy"));
    fireEvent.click(within(proxy).getByRole("button", { name: "Configure" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Test connection" }));
    expect(within(dialog).getByText("Enter the API base URL.")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter the API key.")).toBeInTheDocument();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("opens the ZRoute dialog immediately in one click when ?connect=model is present, including on refresh", async () => {
    mockFetch((call) => {
      if (call.url === "/model-proxy") return json(notConfiguredProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("verified"));
      if (call.url === "/agent-connections") return json([]);
      return undefined;
    });
    renderWithClient(<IntegrationsPage ctx={ctx} />, ["/builder/integrations?connect=model"]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: /ZRouter \/ OpenAI-compatible proxy/i })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/API base URL/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/API key/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Test connection/i })).toBeInTheDocument();

    // Closing the dialog cleans up the query parameter
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(window.location.search).not.toContain("connect=model");
  });

  it("still opens the ZRoute form for the older ?setup=model alias and drops it on close", async () => {
    mockFetch((call) => {
      if (call.url === "/model-proxy") return json(notConfiguredProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("verified"));
      if (call.url === "/agent-connections") return json([]);
      return undefined;
    });
    renderWithClient(<IntegrationsPage ctx={ctx} />, ["/builder/integrations?setup=model"]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: /ZRouter \/ OpenAI-compatible proxy/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Test connection/i })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(window.location.search).not.toContain("setup=model");
    expect(window.location.search).not.toContain("connect=model");
  });

  it("opens Walrus Memory for ?connect=memory and keeps unrelated params on close", async () => {
    mockFetch((call) => {
      if (call.url === "/model-proxy") return json(notConfiguredProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("not_connected"));
      if (call.url === "/agent-connections") return json([]);
      return undefined;
    });
    renderIntegrations("/builder/integrations?connect=memory&project=abc");
    expect(await screen.findByRole("heading", { name: "Connect Walrus Memory" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Connect Walrus Memory" })).not.toBeInTheDocument());
    expect(screen.getByTestId("location")).toHaveTextContent("/builder/integrations?project=abc");
    expect(screen.getByTestId("location").textContent).not.toContain("connect=memory");
  });

  it("opens Walrus Memory for the older ?setup=memory alias", async () => {
    mockFetch((call) => {
      if (call.url === "/model-proxy") return json(notConfiguredProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("not_connected"));
      if (call.url === "/agent-connections") return json([]);
      return undefined;
    });
    renderIntegrations("/builder/integrations?setup=memory&connect=other");
    expect(await screen.findByRole("heading", { name: "Connect Walrus Memory" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /ZRouter/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Connect Walrus Memory" })).not.toBeInTheDocument());
    expect(screen.getByTestId("location")).toHaveTextContent("connect=other");
    expect(screen.getByTestId("location").textContent).not.toContain("setup=memory");
  });

  it("lets connect=model win over setup=memory and continues into Memory setup", async () => {
    mockFetch((call) => {
      if (call.url === "/model-proxy") return json(readyProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("not_connected"));
      if (call.url === "/agent-connections") return json([]);
      if (call.url === "/projects") return json([]);
      return undefined;
    });
    renderIntegrations("/builder/integrations?connect=model&setup=memory");
    const model = await screen.findByRole("heading", { name: /ZRouter \/ OpenAI-compatible proxy/i });
    expect(model).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Connect Walrus Memory" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Set up project memory" }));
    expect(await screen.findByRole("heading", { name: "Connect Walrus Memory" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /ZRouter \/ OpenAI-compatible proxy/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("connect=memory");
    expect(screen.getByTestId("location").textContent).not.toContain("connect=model");
    expect(screen.getByTestId("location").textContent).not.toContain("setup=memory");
  });

  it("displays per-project namespace copy and labels the account connection namespace", async () => {
    mockFetch((call) => {
      if (call.url === "/model-proxy") return json(readyProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("verified"));
      if (call.url === "/agent-connections") return json([]);
      return undefined;
    });
    renderWithClient(<IntegrationsPage ctx={ctx} />);
    const memory = await waitFor(() => row("Walrus Memory"));
    expect(within(memory).getByText(/Each project has its own memory namespace \(project\/<id>\)/)).toBeInTheDocument();
    expect(within(memory).getByText(/Account connection namespace \(not used for project chats\): bew-harness\/product-discovery/)).toBeInTheDocument();
    expect(within(memory).queryByText(/^Mainnet · namespace bew-harness\/product-discovery/)).not.toBeInTheDocument();
  });
});

describe("SettingsDialog (mocked backend)", () => {
  it("has one Console section, labels workspace sign-in, and no Console key form", async () => {
    mockFetch((call) => {
      if (call.url === "/model-proxy") return json(readyProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("verified"));
      return undefined;
    });
    renderWithClient(<SettingsDialog open onClose={() => undefined} />);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText("Workspace sign-in")).toBeInTheDocument());
    expect(within(dialog).getAllByRole("heading", { name: /Walrus Console/ })).toHaveLength(1);
    const consoleCard = within(dialog).getByRole("heading", { name: /Walrus Console/ }).closest("section") as HTMLElement;
    expect(within(consoleCard).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(consoleCard).queryByRole("button")).not.toBeInTheDocument();
  });
});
