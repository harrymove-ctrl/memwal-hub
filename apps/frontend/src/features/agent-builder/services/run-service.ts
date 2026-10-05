import { DEMO_TOKENS_PER_MS, demoScript } from "../data/fixtures";
import type { AgentId, Clock, RunEvent } from "../domain/types";

export interface RunHandle {
  /** Cancels every pending event; no callbacks fire afterwards. */
  stop(): void;
}
export interface RunCallbacks {
  onEvent(e: RunEvent): void;
  onProgress(elapsedMs: number, tokens: number): void;
  onDone(result: { status: "completed" } | { status: "failed"; error: string }): void;
}

/** Connected mode implements this against a real backend (auth, server secrets, cancel). */
export interface RunService {
  readonly mode: "demo" | "connected";
  start(agentId: AgentId, prompt: string | null, cb: RunCallbacks): RunHandle;
}

export interface DemoOptions {
  clock: Clock;
  /** Inject a failure after N events (tests / "simulate failure"). */
  failAfter?: number;
  tickMs?: number;
}

/** Deterministic demo run. Follow-ups replay a short scripted reply. */
export function createDemoRunService(opts: DemoOptions): RunService {
  const { clock } = opts;
  const tickMs = opts.tickMs ?? 1000;
  return {
    mode: "demo",
    start(agentId, prompt, cb) {
      const script: [number, RunEvent][] = prompt
        ? [
            [0, { t: "user", id: `u-${clock.now()}`, text: prompt }],
            [900, { t: "text", id: `r-${clock.now()}`, text: `Noted — I'll factor “${prompt}” into this run. (Demo reply: no model is connected.)` }],
          ]
        : demoScript(agentId);

      const timers = new Set<number>();
      let stopped = false;
      const start = clock.now();
      const schedule = (fn: () => void, ms: number) => {
        const id = clock.setTimeout(() => { timers.delete(id); if (!stopped) fn(); }, ms);
        timers.add(id);
      };
      const tick = () => {
        const elapsed = clock.now() - start;
        cb.onProgress(elapsed, Math.round(elapsed * DEMO_TOKENS_PER_MS));
        schedule(tick, tickMs);
      };
      schedule(tick, tickMs);

      let at = 0;
      script.forEach(([delay, ev], i) => {
        at += delay;
        schedule(() => {
          if (opts.failAfter !== undefined && i >= opts.failAfter) {
            stop();
            cb.onDone({ status: "failed", error: "Demo failure: the tool provider timed out." });
            return;
          }
          cb.onEvent(ev);
          if (i === script.length - 1) {
            stop();
            cb.onDone({ status: "completed" });
          }
        }, at);
      });

      function stop() {
        stopped = true;
        timers.forEach((id) => clock.clearTimeout(id));
        timers.clear();
      }
      return { stop };
    },
  };
}
