import { describe, expect, it } from "vitest";

import { runStages } from "./discovery-panels";

describe("runStages", () => {
  it("does not treat a finished reply or a proposal as a Memory save", () => {
    const stages = runStages({
      projectId: "p1",
      replyStatus: "done",
      memory: { state: "none", facts: [], policy: "project" },
      extraction: "done",
      suggestionStates: ["suggested"],
    });
    expect(stages.find((stage) => stage.id === "model")?.state).toBe("completed");
    expect(stages.find((stage) => stage.id === "recall")?.state).toBe("skipped");
    expect(stages.find((stage) => stage.id === "save")?.state).toBe("waiting");
  });

  it("keeps an uncertain save uncertain", () => {
    const stages = runStages({
      projectId: "p1",
      replyStatus: "done",
      extraction: "done",
      suggestionStates: ["uncertain"],
    });
    expect(stages.find((stage) => stage.id === "save")?.state).toBe("uncertain");
  });

  it("does not start Memory without a project", () => {
    const stages = runStages({ projectId: "" });
    expect(stages[0]).toMatchObject({ id: "project", state: "not-started" });
  });
});
