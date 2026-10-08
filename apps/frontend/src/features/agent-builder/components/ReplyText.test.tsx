import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReplyText } from "./ReplyText";

describe("ReplyText (mocked, no network)", () => {
  it("renders bold, lists and rules as elements without raw markers", () => {
    const { container } = render(
      <ReplyText text={"No, not yet.\n\n* **Audience:** solo developers\n* *Team:* two engineers\n\n***\n1. Finish onboarding\n2. Scope workspaces"} />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("Audience:");
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelector("hr")).not.toBeNull();
    expect(container.textContent).not.toContain("*");
  });

  it("never interprets HTML from the model", () => {
    const { container } = render(<ReplyText text={'<img src=x onerror="alert(1)"> **hi**'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it("keeps an unfinished bold marker as text while streaming", () => {
    const { container } = render(<ReplyText text="Partial **bold" />);
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toBe("Partial **bold");
  });
});
