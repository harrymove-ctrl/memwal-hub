// Test double for the Walrus Memory bridge (scripts/memwal/recall.mjs).
// It speaks the same stdin/stdout contract, touches no network and holds no
// credentials. Every call is appended to $MEMWAL_FAKE_LOG_DIR/<accountId>.jsonl as one JSON line so
// tests can assert exactly which adapter calls happened, and in which namespace.
import { appendFileSync, readFileSync, existsSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
// One log per account id, so tests running in parallel never share a file.
const dir = process.env.MEMWAL_FAKE_LOG_DIR;
const log = dir ? `${dir}/${input.accountId}.jsonl` : undefined;
const record = (extra = {}) => log && appendFileSync(log, JSON.stringify({ action: input.action, namespace: input.namespace, ...extra }) + "\n");
const reply = (body) => process.stdout.write(JSON.stringify(body));

switch (input.action) {
  case "recall": {
    record({ query: input.query });
    // Distances mirror what the relayer reported in the QA run: related
    // questions 0.29-0.66, an unrelated general-knowledge question 0.72-0.75.
    const unrelated = /capital of france/i.test(input.query);
    const d = unrelated ? [0.722, 0.732, 0.739, 0.752] : [0.291, 0.521, 0.544, 0.617];
    const texts = [
      "LaunchLens serves solo SaaS founders.",
      "Improving onboarding is the LaunchLens priority.",
      "The LaunchLens team has two engineers and a six-week release window.",
      "Team workspaces are deferred for LaunchLens.",
    ];
    // A namespace marker lets tests prove which scope a recall was served from.
    reply({
      ok: true,
      memories: texts.map((text, i) => ({
        text: `${text} [ns:${input.namespace}]`,
        blobId: `blob-${i}`,
        distance: d[i],
        createdAt: `2026-10-09T0${i}:00:00Z`,
      })),
    });
    break;
  }
  case "verify": {
    // Controlled stand-in for the relayer/account check. An account id ending in
    // "bad" is reported as not found; the delegate key is never logged.
    record({ keyLength: typeof input.key === "string" ? input.key.length : 0, serverUrl: input.serverUrl });
    if (/bad$/.test(input.accountId)) {
      reply({ ok: false, code: "account_not_found", message: "No object with this account ID exists on Sui Mainnet." });
    } else {
      reply({ ok: true, ownerAddress: "0x" + "ab".repeat(32) });
    }
    break;
  }
  case "remember_submit":
    record({ idempotencyKey: input.idempotencyKey, text: input.text });
    reply({ ok: true, jobId: `job-${input.idempotencyKey}`, status: "pending" });
    break;
  case "remember_status": {
    // First look at a job says pending; a later look says done with a blob.
    const seen = log && existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    const jobs = (input.jobIds ?? []).map((jobId) => {
      const looked = seen.filter((e) => e.action === "remember_status" && e.jobId === jobId).length;
      record({ jobId });
      return looked === 0
        ? { jobId, status: "pending", blobId: null, error: null }
        : { jobId, status: "done", blobId: `blob-${jobId}`, error: null };
    });
    reply({ ok: true, jobs });
    break;
  }
  default:
    record();
    reply({ ok: false, code: "unsupported_action", message: "Unsupported action in the test double." });
}
