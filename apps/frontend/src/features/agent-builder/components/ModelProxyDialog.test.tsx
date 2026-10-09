import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelProxyDialog } from "./ModelProxyDialog";
import {
  json,
  memorySessionBody,
  mockFetch,
  notConfiguredProxy,
  readyProxy,
  renderWithClient,
} from "../test/helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

function QueryClientProviderFor({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ModelProxyDialog guided continuation flow", () => {
  it("shows post-test continuation panel with verified result only when API reports ready", async () => {
    let currentProxy: Record<string, unknown> = notConfiguredProxy;
    mockFetch((call) => {
      if (call.url === "/model-proxy" && call.method === "GET") {
        return json(currentProxy);
      }
      if (call.url === "/model-proxy" && call.method === "POST") {
        currentProxy = {
          ...readyProxy,
          model_id: "test-verified-model",
          last_tested_at: "2026-10-09T03:30:00Z",
        };
        return json(currentProxy);
      }
      if (call.url === "/memory/session") {
        return json(memorySessionBody("not_connected"));
      }
      if (call.url === "/projects") {
        return json([
          { id: "proj-123", name: "LaunchLens Project", created_at: "", updated_at: "" },
        ]);
      }
      return undefined;
    });

    renderWithClient(<ModelProxyDialog open onClose={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByLabelText(/API base URL/i);

    // Initially not configured, no guided setup panel
    expect(within(dialog).queryByRole("status", { name: "Guided setup" })).not.toBeInTheDocument();

    // Fill form and click Test connection
    fireEvent.change(within(dialog).getByLabelText(/API base URL/i), {
      target: { value: "https://api-dev.zroute.ai/openai" },
    });
    fireEvent.change(within(dialog).getByLabelText(/API key/i), {
      target: { value: "zr_test_secret_key" },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Model ID/), {
      target: { value: "test-verified-model" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Test connection" }));

    // Now API returns ready: guided setup panel appears
    const guided = await waitFor(() =>
      within(dialog).getByRole("status", { name: "Guided setup" }),
    );
    expect(guided).toHaveTextContent("test-verified-model");
    expect(guided).toHaveTextContent("2026-10-09T03:30:00Z");

    // Since memory is not verified, shows "Set up project memory" and "Continue without memory"
    expect(within(guided).getByRole("button", { name: "Set up project memory" })).toBeInTheDocument();
    expect(within(guided).getByRole("button", { name: "Continue without memory" })).toBeInTheDocument();

    // Click "Continue without memory" to advance to project selection
    fireEvent.click(within(guided).getByRole("button", { name: "Continue without memory" }));

    // Project selection and Continue to conversation link are now visible
    const projectSelect = await waitFor(() =>
      within(guided).getByLabelText("Select project"),
    );
    expect(projectSelect).toHaveValue("proj-123");

    const chatLink = within(guided).getByRole("link", { name: "Continue to conversation" });
    expect(chatLink).toHaveAttribute("href", "/builder/chat?project=proj-123");
  });

  it("skips memory setup prompt when memory is already verified per the API", async () => {
    mockFetch((call) => {
      if (call.url === "/model-proxy") {
        return json({
          ...readyProxy,
          model_id: "gemini-3.8-flash",
          last_tested_at: "2026-10-09T03:30:00Z",
        });
      }
      if (call.url === "/memory/session") {
        return json(memorySessionBody("verified"));
      }
      if (call.url === "/projects") {
        return json([
          { id: "proj-abc", name: "Alpha Project", created_at: "", updated_at: "" },
        ]);
      }
      return undefined;
    });

    renderWithClient(<ModelProxyDialog open onClose={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    const guided = await waitFor(() =>
      within(dialog).getByRole("status", { name: "Guided setup" }),
    );

    // Memory is verified per API: says so and skips setup button
    expect(within(guided).getByText(/Project memory is already verified/)).toBeInTheDocument();
    expect(within(guided).queryByRole("button", { name: "Set up project memory" })).not.toBeInTheDocument();

    // Project select is directly available
    const projectSelect = within(guided).getByLabelText("Select project");
    expect(projectSelect).toHaveValue("proj-abc");
    expect(within(guided).getByRole("link", { name: "Continue to conversation" })).toHaveAttribute(
      "href",
      "/builder/chat?project=proj-abc",
    );
  });

  it("does not show next-step panel as ready when saving without testing (remains untested)", async () => {
    let savedProxy: Omit<typeof notConfiguredProxy, "connection_name" | "base_url" | "model_id"> & { connection_name: string | null; base_url: string | null; model_id: string | null } = notConfiguredProxy;
    let closed = false;
    mockFetch((call) => {
      if (call.url === "/model-proxy" && call.method === "GET") {
        return json(savedProxy);
      }
      if (call.url === "/model-proxy" && call.method === "POST") {
        savedProxy = {
          ...notConfiguredProxy,
          configured: true,
          status: "untested",
          connection_name: "Untested proxy",
          base_url: "https://proxy.example.com/v1",
          model_id: "untested-model",
        };
        return json(savedProxy);
      }
      if (call.url === "/memory/session") {
        return json(memorySessionBody("not_connected"));
      }
      return undefined;
    });

    renderWithClient(<ModelProxyDialog open onClose={() => { closed = true; }} />);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByLabelText(/API base URL/i);

    fireEvent.change(within(dialog).getByLabelText(/API base URL/i), {
      target: { value: "https://proxy.example.com/v1" },
    });
    fireEvent.change(within(dialog).getByLabelText(/API key/i), {
      target: { value: "zr_secret_key" },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Model ID/), {
      target: { value: "untested-model" },
    });

    // Save without testing (not Test connection)
    fireEvent.click(within(dialog).getByRole("button", { name: "Save without testing" }));

    await waitFor(() => expect(closed).toBe(true));
    expect(within(dialog).queryByRole("status", { name: "Guided setup" })).not.toBeInTheDocument();
  });
});

const savedZroute = {
  ...readyProxy,
  status: "untested",
  connection_name: "My ZRoute",
  base_url: "https://api-dev.zroute.ai/openai",
  model_id: "claude-sonnet-5-5",
  last_tested_at: null,
  last_model_reported: null,
  max_output_tokens: 1200,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("ModelProxyDialog saved-connection hydration", () => {
  it("shows a loading state instead of blank editable defaults while the saved status is in flight", async () => {
    const status = deferred<Response>();
    mockFetch((call) => {
      if (call.url === "/model-proxy" && call.method === "GET") return status.promise;
      if (call.url === "/model-proxy/models") return json({ available: true, models: ["claude-sonnet-5-5"] });
      if (call.url === "/memory/session") return json(memorySessionBody("not_connected"));
      return undefined;
    });
    renderWithClient(<ModelProxyDialog open onClose={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("status", { name: /loading saved connection/i })).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/API base URL/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Test connection" })).not.toBeInTheDocument();

    status.resolve(json(savedZroute));
    const base = await within(dialog).findByLabelText(/API base URL/i);
    expect(base).toHaveValue("https://api-dev.zroute.ai/openai");
    expect(within(dialog).getByLabelText(/Connection name/i)).toHaveValue("My ZRoute");
    expect(within(dialog).getByLabelText(/^Model/)).toHaveValue("claude-sonnet-5-5");
  });

  it("does not offer a form when the saved status cannot be read, so a blank save cannot clobber it", async () => {
    let failing = true;
    mockFetch((call) => {
      if (call.url === "/model-proxy" && call.method === "GET") return failing ? json({ error: "boom" }, 500) : json(savedZroute);
      if (call.url === "/memory/session") return json(memorySessionBody("not_connected"));
      return undefined;
    });
    renderWithClient(<ModelProxyDialog open onClose={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/could not be loaded/i);
    expect(within(dialog).queryByRole("button", { name: "Test connection" })).not.toBeInTheDocument();
    failing = false;
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    expect(await within(dialog).findByLabelText(/API base URL/i)).toHaveValue("https://api-dev.zroute.ai/openai");
  });

  it("reopening a saved connection shows its non-secret fields and tests with the stored key", async () => {
    const { calls } = mockFetch((call) => {
      if (call.url === "/model-proxy" && call.method === "GET") return json(savedZroute);
      if (call.url === "/model-proxy" && call.method === "POST") return json({ ...savedZroute, status: "ready", last_model_reported: "claude-sonnet-5-5-high" });
      if (call.url === "/model-proxy/models") return json({ available: true, models: ["claude-opus-5-5", "claude-sonnet-5-5"] });
      if (call.url === "/memory/session") return json(memorySessionBody("not_connected"));
      return undefined;
    });
    const { rerender, client } = renderWithClient(<ModelProxyDialog open onClose={() => {}} />);
    let dialog = await screen.findByRole("dialog");
    await within(dialog).findByDisplayValue("https://api-dev.zroute.ai/openai");

    rerender(<QueryClientProviderFor client={client}><ModelProxyDialog open={false} onClose={() => {}} /></QueryClientProviderFor>);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    rerender(<QueryClientProviderFor client={client}><ModelProxyDialog open onClose={() => {}} /></QueryClientProviderFor>);
    dialog = await screen.findByRole("dialog");

    expect(await within(dialog).findByDisplayValue("https://api-dev.zroute.ai/openai")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/API key/i)).toHaveValue("");
    expect(within(dialog).getByLabelText(/API key/i)).toHaveAttribute("placeholder", "Stored key (hidden)");
    expect(dialog).toHaveTextContent(/stored securely and never shown/i);
    fireEvent.click(within(dialog).getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(within(dialog).getByRole("status", { name: /connection status/i })).toHaveTextContent("Ready"));
    const post = calls.find((call) => call.method === "POST" && call.url === "/model-proxy");
    expect(post?.body).toMatchObject({
      test: true,
      base_url: "https://api-dev.zroute.ai/openai",
      model_id: "claude-sonnet-5-5",
      connection_name: "My ZRoute",
      api_key: null,
    });
    expect(JSON.stringify(calls)).not.toMatch(/zr_(live|test)_/);
  });

  it("keeps what the user typed when the saved status refetches underneath them", async () => {
    let status: Record<string, unknown> = savedZroute;
    mockFetch((call) => {
      if (call.url === "/model-proxy" && call.method === "GET") return json(status);
      if (call.url === "/model-proxy/models") return json({ available: false, models: [], message: "Provider has no model list." });
      if (call.url === "/memory/session") return json(memorySessionBody("not_connected"));
      return undefined;
    });
    const { client } = renderWithClient(<ModelProxyDialog open onClose={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    const model = await within(dialog).findByLabelText(/^Model ID/);
    fireEvent.change(model, { target: { value: "claude-opus-5-5" } });
    fireEvent.change(within(dialog).getByLabelText(/Connection name/i), { target: { value: "Edited name" } });

    status = { ...savedZroute, model_id: "someone-elses-model", connection_name: "Changed elsewhere" };
    await client.invalidateQueries({ queryKey: ["builder", "model-proxy"] });
    await waitFor(() => expect(client.getQueryData<{ model_id: string }>(["builder", "model-proxy"])?.model_id).toBe("someone-elses-model"));

    expect(within(dialog).getByLabelText(/^Model ID/)).toHaveValue("claude-opus-5-5");
    expect(within(dialog).getByLabelText(/Connection name/i)).toHaveValue("Edited name");
  });

  it("a failed provider test is shown as an error, never as Ready, and the key is not kept in the page", async () => {
    mockFetch((call) => {
      if (call.url === "/model-proxy" && call.method === "GET") return json(savedZroute);
      if (call.url === "/model-proxy" && call.method === "POST") {
        // The backend stored the settings and key, then the provider test failed.
        return json({ ...savedZroute, model_id: "typo-model", status: "needs_attention", last_error: "The provider rejected the key." });
      }
      if (call.url === "/model-proxy/models") return json({ available: false, models: [], message: "no list" });
      if (call.url === "/memory/session") return json(memorySessionBody("not_connected"));
      return undefined;
    });
    renderWithClient(<ModelProxyDialog open onClose={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(await within(dialog).findByLabelText(/^Model ID/), { target: { value: "typo-model" } });
    fireEvent.change(within(dialog).getByLabelText(/API key/i), { target: { value: "typed-key-123" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Test connection" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The provider rejected the key.");
    expect(within(dialog).getByRole("status", { name: /connection status/i })).toHaveTextContent("Needs attention");
    expect(within(dialog).getByRole("status", { name: /connection status/i })).not.toHaveTextContent("Ready");
    expect(within(dialog).getByLabelText(/^Model ID/)).toHaveValue("typo-model");
    expect(within(dialog).getByLabelText(/API key/i)).toHaveValue("");
    expect(document.body.innerHTML).not.toContain("typed-key-123");
  });

  it("keeps every edit including the typed key when the request itself fails", async () => {
    mockFetch((call) => {
      if (call.url === "/model-proxy" && call.method === "GET") return json(savedZroute);
      if (call.url === "/model-proxy" && call.method === "POST") return undefined; // network failure
      if (call.url === "/model-proxy/models") return json({ available: false, models: [], message: "no list" });
      if (call.url === "/memory/session") return json(memorySessionBody("not_connected"));
      return undefined;
    });
    renderWithClient(<ModelProxyDialog open onClose={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(await within(dialog).findByLabelText(/^Model ID/), { target: { value: "typo-model" } });
    fireEvent.change(within(dialog).getByLabelText(/API key/i), { target: { value: "typed-key-123" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Test connection" }));
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Model ID/)).toHaveValue("typo-model");
    expect(within(dialog).getByLabelText(/API key/i)).toHaveValue("typed-key-123");
    expect(within(dialog).getByRole("status", { name: /connection status/i })).not.toHaveTextContent("Ready");
  });

  it("keeps edits and shows the error when saving fails", async () => {
    mockFetch((call) => {
      if (call.url === "/model-proxy" && call.method === "GET") return json(savedZroute);
      if (call.url === "/model-proxy" && call.method === "POST") return json({ error: { message: "Enter a model ID made of letters." } }, 422);
      if (call.url === "/model-proxy/models") return json({ available: false, models: [], message: "no list" });
      if (call.url === "/memory/session") return json(memorySessionBody("not_connected"));
      return undefined;
    });
    renderWithClient(<ModelProxyDialog open onClose={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(await within(dialog).findByLabelText(/^Model ID/), { target: { value: "bad id" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save without testing" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(within(dialog).getByLabelText(/^Model ID/)).toHaveValue("bad id");
  });
});

describe("ModelProxyDialog model selection in the main flow", () => {
  it("shows the Model field without opening Advanced and validates it before sending anything", async () => {
    const { calls } = mockFetch((call) => {
      if (call.url === "/model-proxy") return json(notConfiguredProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("not_connected"));
      return undefined;
    });
    renderWithClient(<ModelProxyDialog open onClose={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(await within(dialog).findByLabelText(/API base URL/i), { target: { value: "https://proxy.example.com/v1" } });
    fireEvent.change(within(dialog).getByLabelText(/API key/i), { target: { value: "key-abc-123" } });
    expect(within(dialog).getByRole("button", { name: "Advanced" })).toHaveAttribute("aria-expanded", "false");
    expect(within(dialog).getByLabelText(/^Model ID/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Test connection" }));
    expect(await within(dialog).findByText(/Enter a model ID/)).toBeInTheDocument();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("lists the provider's real models for an unsaved draft, then falls back to typing when listing fails", async () => {
    let listing: Record<string, unknown> = { available: true, models: ["claude-opus-5-5", "claude-sonnet-5-5"] };
    const { calls } = mockFetch((call) => {
      if (call.url === "/model-proxy") return json(notConfiguredProxy);
      if (call.url === "/model-proxy/models" && call.method === "POST") return json(listing);
      if (call.url === "/memory/session") return json(memorySessionBody("not_connected"));
      return undefined;
    });
    renderWithClient(<ModelProxyDialog open onClose={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(await within(dialog).findByLabelText(/API base URL/i), { target: { value: "https://proxy.example.com/v1" } });
    fireEvent.change(within(dialog).getByLabelText(/API key/i), { target: { value: "key-abc-123" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "List models" }));
    const select = await within(dialog).findByRole("combobox", { name: /^Model/ });
    expect(select.tagName).toBe("SELECT");
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["Select a model", "claude-opus-5-5", "claude-sonnet-5-5"]);
    const discovery = calls.find((call) => call.url === "/model-proxy/models" && call.method === "POST");
    expect(discovery?.body).toEqual({ base_url: "https://proxy.example.com/v1", api_key: "key-abc-123" });

    listing = { available: false, models: [], message: "The provider returned 404 for /models. You can still type the model ID manually." };
    fireEvent.click(within(dialog).getByRole("button", { name: "Refresh model list" }));
    const manual = await within(dialog).findByLabelText(/^Model ID/);
    expect(manual.tagName).toBe("INPUT");
    expect(dialog).toHaveTextContent(/404 for \/models/);
  });

  it("drops a model list that belongs to a different base URL", async () => {
    mockFetch((call) => {
      if (call.url === "/model-proxy") return json(notConfiguredProxy);
      if (call.url === "/model-proxy/models" && call.method === "POST") return json({ available: true, models: ["only-on-a"] });
      if (call.url === "/memory/session") return json(memorySessionBody("not_connected"));
      return undefined;
    });
    renderWithClient(<ModelProxyDialog open onClose={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    const base = await within(dialog).findByLabelText(/API base URL/i);
    fireEvent.change(base, { target: { value: "https://a.example.com/v1" } });
    fireEvent.change(within(dialog).getByLabelText(/API key/i), { target: { value: "key-abc-123" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "List models" }));
    expect((await within(dialog).findByRole("combobox", { name: /^Model/ })).tagName).toBe("SELECT");
    fireEvent.change(base, { target: { value: "https://b.example.com/v1" } });
    expect(within(dialog).getByLabelText(/^Model ID/).tagName).toBe("INPUT");
  });

  it("refuses to reuse the stored key for a different host and says why", async () => {
    const { calls } = mockFetch((call) => {
      if (call.url === "/model-proxy" && call.method === "GET") return json(savedZroute);
      if (call.url === "/model-proxy/models") return json({ available: true, models: ["claude-sonnet-5-5"] });
      if (call.url === "/memory/session") return json(memorySessionBody("not_connected"));
      return undefined;
    });
    renderWithClient(<ModelProxyDialog open onClose={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(await within(dialog).findByLabelText(/API base URL/i), { target: { value: "https://other.example.com/v1" } });
    expect(dialog).toHaveTextContent(/stored key only works for the saved host/i);
    fireEvent.click(within(dialog).getByRole("button", { name: "Test connection" }));
    expect(await within(dialog).findByText(/key for the new host/i)).toBeInTheDocument();
    expect(calls.filter((call) => call.method === "POST" && call.url === "/model-proxy")).toHaveLength(0);
  });

  it("the Model control is reachable by keyboard in tab order before the Advanced toggle", async () => {
    mockFetch((call) => {
      if (call.url === "/model-proxy") return json(notConfiguredProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("not_connected"));
      return undefined;
    });
    renderWithClient(<ModelProxyDialog open onClose={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByLabelText(/API base URL/i);
    const focusable = [...dialog.querySelectorAll<HTMLElement>("input, select, textarea, button")].filter((el) => !el.hasAttribute("disabled") && el.tabIndex >= 0);
    const model = focusable.findIndex((el) => el.getAttribute("placeholder") === "provider/model-name");
    const advanced = focusable.findIndex((el) => el.textContent === "Advanced");
    expect(model).toBeGreaterThan(-1);
    expect(model).toBeLessThan(advanced);
  });
});
