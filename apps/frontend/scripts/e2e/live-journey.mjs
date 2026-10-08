// LIVE Product Discovery journey: real ZRouter replies and Walrus Memory Mainnet.
//
//   STAGE=setup   SECRETS_FILE=... PROXY_BASE_URL=... MODEL_ID=... node live-journey.mjs
//   STAGE=journey node live-journey.mjs
//   STAGE=replay  node live-journey.mjs   (recall-only follow-up questions, saves nothing)
//
// Credentials are typed into the masked dialogs and never printed or screenshotted.
// The throwaway workspace login is kept in USER_FILE (outside the repository, mode 600).
import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { API, APP, launch, shot, statusOf, writeEvidence } from "./lib.mjs";

const STAGE = process.env.STAGE ?? "journey";
const USER_FILE = process.env.USER_FILE ?? `${process.env.HOME}/memwal-demo-tmp/live-user.json`;
const TURN_TIMEOUT = 180_000;
const SAVE_TIMEOUT = 420_000;

async function signIn(context) {
  if (existsSync(USER_FILE)) {
    const user = JSON.parse(readFileSync(USER_FILE, "utf8"));
    const response = await context.request.post(`${API}/auth/login`, { data: user });
    if (!response.ok()) throw new Error(`login failed: ${response.status()}`);
    return;
  }
  const user = { username: `live${Date.now().toString(36)}`, password: `pw-${createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 24)}` };
  const response = await context.request.post(`${API}/auth/register`, { data: user });
  if (!response.ok()) throw new Error(`register failed: ${response.status()}`);
  writeFileSync(USER_FILE, JSON.stringify(user));
  chmodSync(USER_FILE, 0o600);
}

async function setup(page) {
  const secrets = JSON.parse(readFileSync(process.env.SECRETS_FILE, "utf8"));
  const baseUrl = process.env.PROXY_BASE_URL;
  const modelId = process.env.MODEL_ID;
  if (!baseUrl || !modelId) throw new Error("PROXY_BASE_URL and MODEL_ID are required");
  await page.goto(`${APP}/builder/integrations`);
  const proxyRow = page.locator("li", { has: page.locator("strong", { hasText: "ZRouter / OpenAI-compatible proxy" }) });
  await proxyRow.getByRole("button", { name: /Configure|Manage/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("API base URL", { exact: false }).first().fill(baseUrl);
  await dialog.getByLabel("API key", { exact: false }).first().fill(secrets.zroute_key);
  await dialog.getByLabel("Model ID", { exact: false }).first().fill(modelId);
  await dialog.getByRole("button", { name: "Test connection" }).click();
  // Wait for the single explicit test request to finish; no screenshot while the key field is filled.
  await page.waitForFunction(() => !document.querySelector('[role="dialog"] button[type="submit"]')?.textContent?.includes("Testing"), null, { timeout: 60_000 });
  const keyValue = await dialog.getByLabel("API key", { exact: false }).first().inputValue();
  if (keyValue) throw new Error("API key field was not cleared after save");
  const badge = await dialog.getByRole("status").first().textContent();
  console.log(`ZRouter test result: ${badge}`);
  await shot(page, "10-zrouter-dialog-after-test");
  await page.keyboard.press("Escape");
  await statusOf(page, "ZRouter / OpenAI-compatible proxy").filter({ hasText: /Ready|Needs attention|Unavailable/ }).waitFor();
  if ((await statusOf(page, "ZRouter / OpenAI-compatible proxy").textContent()) !== "Ready") throw new Error("ZRouter did not reach Ready");

  const memoryRow = page.locator("li", { has: page.locator("strong", { hasText: "Walrus Memory" }) });
  await memoryRow.getByRole("button", { name: /Connect|Manage/ }).click();
  const memoryDialog = page.getByRole("dialog");
  await memoryDialog.getByLabel("Account ID").fill(secrets.memwal_account_id);
  await memoryDialog.getByLabel("Delegate key", { exact: false }).fill(secrets.memwal_delegate_key);
  await memoryDialog.getByRole("button", { name: "Save and verify" }).click();
  await Promise.race([
    memoryDialog.waitFor({ state: "detached", timeout: 90_000 }),
    memoryDialog.getByRole("alert").first().waitFor({ timeout: 90_000 }),
  ]);
  if (await page.getByRole("dialog").count()) {
    const alert = await page.getByRole("dialog").getByRole("alert").allTextContents();
    await page.getByRole("dialog").getByLabel("Delegate key", { exact: false }).fill("");
    throw new Error(`Memory verification failed: ${alert.join(" | ")}`);
  }
  await statusOf(page, "Walrus Memory").filter({ hasText: "Ready" }).waitFor({ timeout: 15_000 });
  await shot(page, "11-integrations-both-ready");
  console.log("setup complete: ZRouter Ready, Walrus Memory Ready");
}

const shapes = [];
function watchRequests(page) {
  page.on("request", (request) => {
    if (!request.url().endsWith("/discovery/chat")) return;
    const body = request.postDataJSON();
    shapes.push({
      use_memory: body.use_memory,
      messages: body.messages.map((message) => ({ role: message.role, characters: message.content.length, sha256_prefix: createHash("sha256").update(message.content).digest("hex").slice(0, 12) })),
    });
  });
}

const lastAssistant = (page) => page.locator("li.dc-assistant").last();

async function ask(page, text, label) {
  const box = page.getByLabel("Message");
  await box.fill(text);
  await box.press("Enter");
  const turn = lastAssistant(page);
  await page.waitForFunction(() => {
    const items = document.querySelectorAll("li.dc-assistant");
    const last = items[items.length - 1];
    return last && last.getAttribute("data-status") !== "streaming";
  }, null, { timeout: TURN_TIMEOUT });
  const status = await turn.getAttribute("data-status");
  if (status !== "done") throw new Error(`${label}: reply ended with ${status}: ${await turn.locator(".dc-error").textContent().catch(() => "")}`);
  await page.waitForFunction(() => document.querySelector(".dc-phase")?.getAttribute("data-phase") === "idle", null, { timeout: 120_000 });
  const reply = await turn.locator(".dc-reply").textContent();
  const memoryLine = turn.locator(".dc-memory");
  let memory = { summary: (await memoryLine.count()) ? (await memoryLine.first().innerText()).split("\n")[0] : "none", facts: [] };
  const memoryButton = turn.getByRole("button", { name: /Memory used|provided as context/ });
  if (await memoryButton.count()) {
    await memoryButton.click();
    const rows = turn.locator(".dc-memory li:not(.dc-muted)");
    for (let index = 0; index < (await rows.count()); index += 1) {
      const row = rows.nth(index);
      memory.facts.push({ text: await row.locator("span").textContent(), source: await row.locator("small").textContent() });
    }
  }
  await turn.getByRole("button", { name: /Details/ }).click();
  const terms = await turn.locator(".dc-diag dt").allTextContents();
  const values = await turn.locator(".dc-diag dd").allTextContents();
  const details = Object.fromEntries(terms.map((term, index) => [term, values[index]]));
  const suggestions = [];
  const region = turn.getByRole("region", { name: "Suggested memories" });
  if (await region.count()) {
    const items = region.locator("li");
    for (let index = 0; index < (await items.count()); index += 1) {
      const item = items.nth(index);
      const input = item.locator("input.dc-fact-input");
      suggestions.push({ text: (await input.count()) ? await input.inputValue() : await item.locator(".dc-fact span").textContent() });
    }
  }
  await shot(page, label);
  return { prompt: text, reply, memory, details, suggestions };
}

async function saveAll(page, label) {
  const region = lastAssistant(page).getByRole("region", { name: "Suggested memories" });
  if (!(await region.count())) return [];
  await region.getByRole("button", { name: "Save selected" }).click();
  await shot(page, `${label}-saving`);
  await page.waitForFunction(() => {
    const regions = document.querySelectorAll('section[aria-label="Suggested memories"]');
    const last = regions[regions.length - 1];
    return last && [...last.querySelectorAll("li")].every((item) => ["saved", "failed", "uncertain"].includes(item.getAttribute("data-state") ?? ""));
  }, null, { timeout: SAVE_TIMEOUT });
  const items = region.locator("li");
  const out = [];
  for (let index = 0; index < (await items.count()); index += 1) {
    const item = items.nth(index);
    out.push({ text: await item.locator(".dc-fact span").textContent(), state: await item.getAttribute("data-state"), detail: await item.locator("small").textContent() });
  }
  await shot(page, `${label}-saved`);
  return out;
}

async function journey(page, context) {
  watchRequests(page);
  const evidence = { when: new Date().toISOString(), mode: "LIVE (ZRouter + Walrus Memory Mainnet)", steps: [] };
  await page.goto(`${APP}/builder/chat`);
  await page.getByText(/ZRouter: Ready/).waitFor({ timeout: 20_000 });
  await page.getByText(/Walrus Memory: Ready/).waitFor({ timeout: 20_000 });

  const a = await ask(page, "We are building a product for solo developers. Our next release focuses on onboarding, and we have two engineers.", "20-conversation-a-reply");
  a.saved = await saveAll(page, "21-conversation-a");
  evidence.steps.push({ step: "Conversation A", ...a });

  await page.getByRole("button", { name: /New chat/ }).click();
  const b = await ask(page, "Should we prioritize shared team workspaces next?", "22-new-chat-recall");
  evidence.steps.push({ step: "New chat B (recall from Conversation A)", ...b });

  await page.reload();
  await page.getByText(/Walrus Memory: Ready/).waitFor({ timeout: 20_000 });
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  evidence.browserStorageMentionsSoloDevelopers = /solo developers/i.test(storage);
  const c = await ask(page, "What do you already know about our product, team and release focus?", "23-after-reload-recall");
  evidence.steps.push({ step: "After reload, new conversation", ...c });

  const d = await ask(page, "We now have four engineers, and team collaboration is becoming a priority.", "24-revised-context");
  d.saved = await saveAll(page, "25-revised-context");
  evidence.steps.push({ step: "Revised context", ...d });

  await page.getByRole("button", { name: /New chat/ }).click();
  const e = await ask(page, "How many engineers do we have, and should we prioritize shared team workspaces now?", "26-after-revision-recall");
  evidence.steps.push({ step: "New chat after revision", ...e });

  evidence.chatRequestShapes = shapes;
  // Write the conversation evidence first; the on-chain blob scan can take minutes.
  writeEvidence("live-journey.json", evidence);
  try {
    const stats = await context.request.get(`${API}/memory/stats`, { timeout: 300_000 });
    evidence.memoryStats = { status: stats.status(), body: stats.ok() ? await stats.json() : await stats.text() };
  } catch (error) {
    evidence.memoryStats = { error: String(error).slice(0, 200) };
  }
  writeEvidence("live-journey.json", evidence);
}

// Recall-only replay: asks the follow-up questions again in fresh conversations
// and saves nothing, so it adds no Walrus writes.
async function replay(page) {
  watchRequests(page);
  const evidence = { when: new Date().toISOString(), mode: "LIVE replay, recall only, nothing saved", steps: [] };
  await page.goto(`${APP}/builder/chat`);
  await page.getByText(/ZRouter: Ready/).waitFor({ timeout: 20_000 });
  await page.getByText(/Walrus Memory: Ready/).waitFor({ timeout: 20_000 });
  const b = await ask(page, "Should we prioritize shared team workspaces next?", "30-replay-new-chat-recall");
  evidence.steps.push({ step: "Fresh conversation (recall)", ...b });
  await page.reload();
  await page.getByText(/Walrus Memory: Ready/).waitFor({ timeout: 20_000 });
  const c = await ask(page, "What do you already know about our product, team and release focus?", "31-replay-after-reload");
  evidence.steps.push({ step: "After reload, new conversation (recall)", ...c });
  await page.getByRole("button", { name: /New chat/ }).click();
  const e = await ask(page, "How many engineers do we have, and should we prioritize shared team workspaces now?", "32-replay-after-revision");
  evidence.steps.push({ step: "New conversation after the revision (recall)", ...e });
  evidence.chatRequestShapes = shapes;
  writeEvidence("live-journey-replay.json", evidence);
}

const { browser, context, page } = await launch();
try {
  await signIn(context);
  if (STAGE === "setup") await setup(page);
  else if (STAGE === "replay") await replay(page);
  else await journey(page, context);
} catch (error) {
  console.error(`FAILED: ${error instanceof Error ? error.message : error}`);
  // Setup screens may contain credential fields, so only journey failures are captured.
  if (STAGE !== "setup") {
    await shot(page, "error-journey").catch(() => undefined);
    writeEvidence("live-journey-partial.json", { shapes });
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
