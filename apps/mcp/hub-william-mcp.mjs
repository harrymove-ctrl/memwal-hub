#!/usr/bin/env node
/**
 * Hub William MCP server (stdio, dependency-free).
 *
 * Exposes the SERV Reasoning control plane as MCP tools so a coding agent
 * (Claude Code, Codex, Cursor, ...) authorizes itself via the device flow and
 * then runs every task through the three Bew Harness checkpoints.
 *
 * Usage (e.g. in .mcp.json):
 *   { "hub-william": { "command": "node", "args": ["apps/mcp/hub-william-mcp.mjs"],
 *     "env": { "HUB_URL": "http://localhost:8080" } } }
 *
 * Tools:
 *   authorize_device    — start device flow, wait for operator approval, cache key
 *   reasoning_plan      — SERV plan checkpoint (POST /reasoning/plan)
 *   reasoning_authorize — Bew Harness boundary gate (POST /reasoning/authorize)
 *   reasoning_verify    — SERV evidence verification (POST /reasoning/verify)
 */
import { createInterface } from "node:readline";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HUB_URL = (process.env.HUB_URL ?? "http://localhost:8080").replace(/\/$/, "");
const CRED_DIR = join(homedir(), ".hub-william");
const CRED_FILE = join(CRED_DIR, "credentials.json");

function loadKey() {
  try {
    return JSON.parse(readFileSync(CRED_FILE, "utf8")).gateway_key ?? null;
  } catch {
    return null;
  }
}

function saveKey(key) {
  mkdirSync(CRED_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CRED_FILE, JSON.stringify({ gateway_key: key }, null, 2), {
    mode: 0o600,
  });
  // writeFileSync's mode only applies to new files; enforce on existing too.
  chmodSync(CRED_FILE, 0o600);
}

class HubHttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function hub(path, body, key) {
  const headers = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  const response = await fetch(`${HUB_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new HubHttpError(
      payload?.message ?? `${path} failed with ${response.status}`,
      response.status,
    );
  }
  return payload;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function authorizeDevice({ agent_label = "MCP agent" }) {
  const existing = loadKey();
  if (existing) {
    return { status: "already_authorized", hint: "Cached key found; delete ~/.hub-william/credentials.json to re-authorize." };
  }
  const started = await hub("/agent-auth/device", { agent_label });
  const deadline = Date.now() + started.expires_in_seconds * 1000;
  process.stderr.write(
    `Approve this agent: ${started.verification_uri} (code ${started.user_code})\n`,
  );
  while (Date.now() < deadline) {
    await sleep(started.poll_interval_seconds * 1000);
    let token;
    try {
      token = await hub("/agent-auth/device/token", {
        device_code: started.device_code,
      });
    } catch (error) {
      // Only a definitive 404 (expired/consumed) ends the flow; transient
      // network errors or 5xx just wait for the next poll tick.
      if (error instanceof HubHttpError && error.status === 404) {
        return { status: "expired" };
      }
      continue;
    }
    if (token.status === "denied") return { status: "denied" };
    if (token.status === "approved" && token.key) {
      saveKey(token.key);
      return { status: "authorized" };
    }
  }
  return { status: "expired" };
}

function requireKey() {
  const key = loadKey();
  if (!key) {
    throw new Error("Not authorized. Call the authorize_device tool first.");
  }
  return key;
}

const TOOLS = [
  {
    name: "authorize_device",
    description:
      "Authorize this agent with Hub William via the device flow. Prints a verification link the operator approves in the browser; the agent receives its own revocable gateway key.",
    inputSchema: {
      type: "object",
      properties: { agent_label: { type: "string", description: "Label the operator sees, e.g. 'Claude Code on MacBook'" } },
    },
  },
  {
    name: "reasoning_plan",
    description:
      "SERV plan checkpoint: submit the task before touching code. Returns required Bew Harness contracts, dependency-ordered steps, prohibited actions, and verification criteria.",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        task: { type: "string" },
        context_files: { type: "array", items: { type: "string" } },
        available_skills: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "reasoning_authorize",
    description:
      "Bew Harness boundary gate: check a critical action (push, out-of-scope edit, credential access) against active contracts before executing it. Blocked means do not proceed.",
    inputSchema: {
      type: "object",
      required: ["task", "action"],
      properties: {
        task: { type: "string" },
        action: { type: "string" },
        target: { type: "string" },
        plan_id: { type: "string" },
        step_id: { type: "string" },
        active_contracts: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "reasoning_verify",
    description:
      "SERV verification checkpoint: submit evidence (test output, modified files) after finishing. Only a passing verdict justifies declaring the task complete.",
    inputSchema: {
      type: "object",
      required: ["task", "completed_steps", "evidence"],
      properties: {
        task: { type: "string" },
        plan_id: { type: "string" },
        completed_steps: { type: "array", items: { type: "string" } },
        evidence: { type: "string" },
        modified_files: { type: "array", items: { type: "string" } },
        test_output: { type: "string" },
      },
    },
  },
];

async function callTool(name, args) {
  switch (name) {
    case "authorize_device":
      return authorizeDevice(args ?? {});
    case "reasoning_plan":
      return hub("/reasoning/plan", args, requireKey());
    case "reasoning_authorize":
      return hub("/reasoning/authorize", args, requireKey());
    case "reasoning_verify":
      return hub("/reasoning/verify", args, requireKey());
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function replyError(id, message) {
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }) + "\n",
  );
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = message;
  if (method === "initialize") {
    reply(id, {
      protocolVersion: params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "hub-william", version: "0.1.0" },
    });
  } else if (method === "notifications/initialized") {
    // notification: no response
  } else if (method === "tools/list") {
    reply(id, { tools: TOOLS });
  } else if (method === "tools/call") {
    callTool(params.name, params.arguments)
      .then((result) =>
        reply(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        }),
      )
      .catch((error) => replyError(id, error.message));
  } else if (id !== undefined) {
    replyError(id, `Unsupported method: ${method}`);
  }
});
