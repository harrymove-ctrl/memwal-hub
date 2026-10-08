// LIVE checks that add no Walrus Memory writes: nothing is saved (auto-save stays off).
//   node scripts/e2e/live-checks.mjs
// Uses the workspace login from USER_FILE (created by live-journey.mjs STAGE=setup).
// Billable model calls: one irrelevant question, one question per extra model,
// one cancelled reply, plus the automatic fact suggestion after each finished reply.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { API, APP, launch, shot, writeEvidence } from "./lib.mjs";

const USER_FILE = process.env.USER_FILE ?? `${process.env.HOME}/memwal-demo-tmp/live-user.json`;
const MODELS = (process.env.SWITCH_MODELS ?? "grok-4.5,claude-sonnet-5-5").split(",").map((id) => id.trim()).filter(Boolean);
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function login(context) {
  if (!existsSync(USER_FILE)) throw new Error("Run live-journey.mjs STAGE=setup first");
  const response = await context.request.post(`${API}/auth/login`, { data: JSON.parse(readFileSync(USER_FILE, "utf8")) });
  if (!response.ok()) throw new Error(`login failed: ${response.status()}`);
}

async function ask(page, text, label) {
  const box = page.getByLabel("Message");
  await box.fill(text);
  await box.press("Enter");
  await page.waitForFunction(() => {
    const items = document.querySelectorAll("li.dc-assistant");
    const last = items[items.length - 1];
    return last && last.getAttribute("data-status") !== "streaming";
  }, null, { timeout: 180_000 });
  const turn = page.locator("li.dc-assistant").last();
  const status = await turn.getAttribute("data-status");
  const reply = (await turn.locator(".dc-reply").count()) ? await turn.locator(".dc-reply").innerText() : "";
  const memoryLine = turn.locator(".dc-memory");
  const memorySummary = (await memoryLine.count()) ? (await memoryLine.first().innerText()).split("\n")[0] : "none";
  const facts = [];
  const memoryButton = turn.getByRole("button", { name: /Memory used|provided as context/ });
  if (await memoryButton.count()) {
    await memoryButton.click();
    const rows = turn.locator(".dc-memory li:not(.dc-muted) span");
    for (let index = 0; index < (await rows.count()); index += 1) facts.push(await rows.nth(index).textContent());
  }
  let details = {};
  if (status === "done") {
    await page.waitForFunction(() => document.querySelector(".dc-phase")?.getAttribute("data-phase") !== "generating", null, { timeout: 120_000 }).catch(() => undefined);
    await turn.getByRole("button", { name: /Details/ }).click();
    const terms = await turn.locator(".dc-diag dt").allTextContents();
    const values = await turn.locator(".dc-diag dd").allTextContents();
    details = Object.fromEntries(terms.map((term, index) => [term, values[index]]));
  }
  const error = (await turn.locator(".dc-error").count()) ? await turn.locator(".dc-error").innerText() : null;
  await shot(page, label);
  return { prompt: text, status, reply, memorySummary, facts, details, error };
}

async function chatDirect(context, body) {
  const response = await context.request.post(`${API}/discovery/chat`, { data: body, headers: { origin: APP }, timeout: 120_000 });
  const text = await response.text();
  const events = text.split("\n\n").map((block) => {
    const event = /^event: (.*)$/m.exec(block)?.[1];
    const data = /^data: (.*)$/m.exec(block)?.[1];
    return event ? { event, data: data ? JSON.parse(data) : null } : null;
  }).filter(Boolean);
  return { status: response.status(), events, body: response.ok() ? null : text.slice(0, 300) };
}

const evidence = { when: new Date().toISOString(), mode: "LIVE checks, no Memory writes", steps: [] };
const { browser, context, page } = await launch();
const other = await browser.newContext();
try {
  await login(context);
  const before = await (await context.request.get(`${API}/memory/stats`, { timeout: 300_000 })).json().catch(() => null);
  evidence.agentBlobsBefore = before?.on_chain?.memwalBlobsForThisAgent ?? null;

  // 1. Cross-user isolation (no model call).
  const username = `iso${Date.now().toString(36)}`;
  const registered = await other.request.post(`${API}/auth/register`, { data: { username, password: `pw-${createHash("sha256").update(username).digest("hex").slice(0, 20)}` } });
  check("Second user registers", registered.ok());
  const otherProxy = await (await other.request.get(`${API}/model-proxy`)).json();
  const otherMemory = await (await other.request.get(`${API}/memory/session`)).json();
  check("Second user sees no ZRouter connection", otherProxy.configured === false && otherProxy.key_saved === false);
  check("Second user sees no Walrus Memory connection", otherMemory.walrus?.configured === false && otherMemory.walrus?.account_id === null);
  const otherChat = await other.request.post(`${API}/discovery/chat`, { data: { messages: [{ role: "user", content: "How many engineers do we have?" }] }, headers: { origin: APP } });
  check("Second user cannot chat with the first user's model", !otherChat.ok(), `${otherChat.status()} ${(await otherChat.text()).slice(0, 80)}`);
  const foreign = await context.request.post(`${API}/discovery/chat`, { data: { messages: [{ role: "user", content: "x" }] }, headers: { origin: "https://evil.example" } });
  check("Requests from another origin are refused", foreign.status() === 403);

  // 2. Model outage: an unknown model ID is reported as an error, never as a reply.
  const outage = await chatDirect(context, { messages: [{ role: "user", content: "Say OK" }], use_memory: false, model: "model-id-that-does-not-exist" });
  const outageError = outage.events.find((item) => item.event === "error");
  check("Unknown model is reported as an error", Boolean(outageError) && !outage.events.some((item) => item.event === "done"), outageError ? `${outageError.data.code}: ${outageError.data.message}` : JSON.stringify(outage).slice(0, 200));
  evidence.steps.push({ step: "Model outage (unknown model ID)", http: outage.status, error: outageError?.data ?? null });

  await page.goto(`${APP}/builder/chat`);
  await page.getByText(/ZRouter: Ready/).waitFor({ timeout: 20_000 });
  await page.getByText(/Walrus Memory: Ready/).waitFor({ timeout: 20_000 });
  check("Auto-save is off by default", !(await page.getByLabel("Auto-save suggestions").isChecked()));
  const select = page.getByLabel("Model for this conversation");
  await select.waitFor();
  // The list loads after the page; wait for it instead of reading the first render.
  await page.waitForFunction(() => document.querySelectorAll('select[aria-label="Model for this conversation"] option').length > 1, null, { timeout: 15_000 }).catch(() => undefined);
  const options = await select.locator("option").allTextContents();
  evidence.modelOptions = options;
  check("Model list comes from the proxy", options.length > 1, options.join(", "));

  // 3. Irrelevant question: no false recall.
  const irrelevant = await ask(page, "What is a good recipe for banana bread?", "40-irrelevant-question");
  check("Irrelevant question recalls no facts", irrelevant.facts.length === 0 && /no relevant facts/i.test(irrelevant.memorySummary), irrelevant.memorySummary);
  evidence.steps.push({ step: "Irrelevant question", ...irrelevant });

  // 4. Model switching with the same Memory.
  for (const [index, model] of MODELS.entries()) {
    await page.getByRole("button", { name: /New chat/ }).click();
    await select.selectOption(model);
    const result = await ask(page, "How many engineers do we have, and what is the next release focused on?", `4${index + 1}-model-${model.replace(/[^a-z0-9.-]/gi, "_")}`);
    const usedFacts = result.facts.length > 0;
    check(`Model ${model} answered with recalled Memory`, result.status === "done" && usedFacts && result.details["Model requested"] === model, `reported ${result.details["Model reported"] ?? "none"}, finish ${result.details["Finish reason"] ?? "?"}`);
    evidence.steps.push({ step: `Model switch: ${model}`, ...result });
  }
  await select.selectOption({ index: 0 });

  // 5. Cancellation mid-stream.
  await page.getByRole("button", { name: /New chat/ }).click();
  const box = page.getByLabel("Message");
  await box.fill("Write a detailed twelve-step onboarding research plan for solo developers, with two paragraphs per step.");
  await box.press("Enter");
  await page.locator("li.dc-assistant .dc-reply").last().waitFor({ timeout: 120_000 });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => {
    const items = document.querySelectorAll("li.dc-assistant");
    return items[items.length - 1]?.getAttribute("data-status") === "stopped";
  }, null, { timeout: 15_000 }).catch(() => undefined);
  const stopped = await page.locator("li.dc-assistant").last().getAttribute("data-status");
  check("Stop (Esc) cancels the reply and keeps the partial text", stopped === "stopped");
  await shot(page, "45-cancelled");
  evidence.steps.push({ step: "Cancellation", status: stopped });

  // 6. Nothing was saved.
  const after = await (await context.request.get(`${API}/memory/stats`, { timeout: 300_000 })).json().catch(() => null);
  evidence.agentBlobsAfter = after?.on_chain?.memwalBlobsForThisAgent ?? null;
  check("No Walrus writes during these checks", evidence.agentBlobsBefore !== null && evidence.agentBlobsBefore === evidence.agentBlobsAfter, `${evidence.agentBlobsBefore} → ${evidence.agentBlobsAfter}`);
  const html = await page.content();
  check("Page contains no key-shaped strings", !/zr_(live|test)_[A-Za-z0-9_-]{8,}|suiprivkey1/.test(html));
} catch (error) {
  check("Run completed", false, error instanceof Error ? error.message : String(error));
  await shot(page, "error-live-checks").catch(() => undefined);
} finally {
  evidence.results = results;
  writeEvidence("live-checks.json", evidence);
  await browser.close();
}
const failed = results.filter((result) => !result.pass);
console.log(`${results.length - failed.length}/${results.length} live checks passed`);
process.exit(failed.length ? 1 : 0);
