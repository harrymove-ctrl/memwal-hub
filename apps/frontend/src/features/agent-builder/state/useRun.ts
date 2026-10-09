import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentId, RunEvent, RunState } from "../domain/types";
import type { RunHandle, RunService } from "../services/run-service";

const idle = (agentId: AgentId): RunState => ({ agentId, status: "idle", events: [], elapsedMs: 0, tokens: 0, error: null, revision: null });

/**
 * Explicit lifecycle: idle → starting → running → completed | stopped | failed.
 * Each run carries a generation; callbacks from an older run (e.g. after an
 * agent switch or Stop) are ignored so nothing leaks into the wrong agent.
 */
export function useRun(service: RunService, agentId: AgentId, autoStart: boolean) {
  const [run, setRun] = useState<RunState>(() => idle(agentId));
  const [boundAgent, setBoundAgent] = useState(agentId);
  if (boundAgent !== agentId) {
    setBoundAgent(agentId);
    setRun(idle(agentId));
  }
  const handle = useRef<RunHandle | null>(null);
  const gen = useRef(0);
  const stop = useCallback(() => {
    gen.current += 1;
    handle.current?.stop();
    handle.current = null;
    setRun((r) => (r.status === "running" || r.status === "starting" ? { ...r, status: "stopped" } : r));
  }, []);

  const start = useCallback(
    (prompt: string | null, revision?: number | null) => {
      handle.current?.stop();
      const my = ++gen.current;
      setRun((r) => ({
        ...(prompt ? r : idle(agentId)),
        agentId,
        status: "starting",
        error: null,
        revision: revision !== undefined ? revision : (r.revision ?? null),
      }));
      const apply = (fn: (r: RunState) => RunState) => { if (gen.current === my) setRun(fn); };
      handle.current = service.start(agentId, prompt, {
        onEvent: (e: RunEvent) =>
          apply((r) => {
            if (e.t === "toolStatus") {
              return { ...r, status: "running", events: r.events.map((x) => (x.t === "tool" && x.id === e.id ? { ...x, status: e.status } : x)) };
            }
            return { ...r, status: "running", events: [...r.events, e] };
          }),
        onProgress: (elapsedMs, tokens) => apply((r) => ({ ...r, elapsedMs, tokens })),
        onDone: (res) =>
          apply((r) => (res.status === "completed" ? { ...r, status: "completed" } : { ...r, status: "failed", error: res.error })),
      });
      apply((r) => (r.status === "starting" ? { ...r, status: "running" } : r));
    },
    [agentId, service],
  );

  useEffect(() => {
    const timer = autoStart ? window.setTimeout(() => start(null), 0) : undefined;
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      gen.current += 1;
      handle.current?.stop();
      handle.current = null;
    };
  }, [agentId, autoStart, start]);

  const busy = run.status === "starting" || run.status === "running";
  return { run, start, stop, busy };
}
