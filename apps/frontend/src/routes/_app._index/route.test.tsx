import { render, screen, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import createQueryClient from "@/utils/utils.query-client";
import HomeRoute from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderHome(proxyStatus: "ready" | "not_configured" | "untested" = "not_configured") {
  const queryClient = createQueryClient();
  queryClient.setQueryData(["builder", "model-proxy"], {
    configured: proxyStatus !== "not_configured",
    status: proxyStatus,
    connection_name: "ZRoute",
    base_url: "https://api-dev.zroute.ai/openai",
    model_id: "gemini-3.8-flash",
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <HomeRoute />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("HomeRoute first-run landing page", () => {
  it("stands on its own around MemWal, projects, conversations, and memory", () => {
    renderHome();

    expect(screen.getByRole("heading", { name: "Your next chat should remember your project." })).toBeInTheDocument();
    expect(
      screen.getByText(/Explore ideas, make decisions, and continue where you left off—with relevant project context saved through Walrus Memory\./i),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Connect a model, keep project context, start a new chat" })).toBeInTheDocument();
  });

  it("clearly labels the LaunchLens example as illustrative", () => {
    renderHome();

    const label = screen.getByText("Illustrative example (LaunchLens)");
    expect(label).toBeInTheDocument();
    expect(
      screen.getByText(/This walkthrough is an illustrative example of project memory behavior, not a live model reply or on-chain transaction receipt/i),
    ).toBeInTheDocument();
  });

  it("provides one-click 'Connect model' linking directly to /builder/integrations?connect=model", () => {
    renderHome("not_configured");

    const connectModelLinks = screen.getAllByRole("link", { name: "Connect model" });
    expect(connectModelLinks.length).toBeGreaterThanOrEqual(1);
    expect(connectModelLinks[0]).toHaveAttribute("href", "/builder/integrations?connect=model");

    const getStarted = screen.getByRole("link", { name: "Get started" });
    expect(getStarted).toHaveAttribute("href", "/builder/integrations?connect=model");
  });

  it("removes Provider accounts and full contributor guide from the primary first-run content", () => {
    renderHome();

    // Provider accounts should not be anywhere in the primary onboarding actions
    expect(screen.queryByRole("link", { name: /Provider accounts/i })).not.toBeInTheDocument();

    // Contributor guide is placed behind an explicit secondary details element
    const details = screen.getByText(/For contributors: tool development and repository guidelines/i).closest("details");
    expect(details).toBeInTheDocument();
    expect(details).not.toHaveAttribute("open");

    // The contribution tree is inside the secondary details, not primary content
    expect(within(details as HTMLElement).getAllByText(/contributors\//).length).toBeGreaterThanOrEqual(1);
  });
});
