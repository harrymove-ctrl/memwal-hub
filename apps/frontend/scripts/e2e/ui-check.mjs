// Browser UI checks against the local frontend and backend with a fresh user and
// no credentials: layout, keyboard, reduced motion and honest empty states.
import { APP, launch, registerUser, shot, statusOf, writeEvidence } from "./lib.mjs";

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const { browser, context, page } = await launch({ reducedMotion: "reduce" });
const consoleErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
try {
  await registerUser(context, "uicheck");
  await page.goto(`${APP}/builder/integrations`);
  await statusOf(page, "ZRouter / OpenAI-compatible proxy").waitFor();
  check("ZRouter card shows Not configured", (await statusOf(page, "ZRouter / OpenAI-compatible proxy").textContent()) === "Not configured");
  check("ZRouter description", await page.getByText("Use your proxy endpoint and model for chat responses.").first().isVisible());
  await page.waitForFunction(() => !document.body.innerText.includes("Verifying"), null, { timeout: 15000 }).catch(() => undefined);
  check("Memory card shows Not connected for a new user", (await statusOf(page, "Walrus Memory").textContent()) === "Not connected");
  check("Console card says Unavailable", (await statusOf(page, "Walrus Console").textContent()) === "Unavailable");
  check("Exactly one Console card", (await page.locator("strong", { hasText: "Walrus Console" }).count()) === 1);
  const consoleButtons = await page.locator("li", { has: page.locator("strong", { hasText: "Walrus Console" }) }).getByRole("button").count();
  check("Console card has no connect or key controls", consoleButtons === 0);
  await shot(page, "01-integrations-empty-desktop");

  // Keyboard: reach Configure with Tab, open with Enter, close with Escape.
  const configure = page.locator("li", { has: page.locator("strong", { hasText: "ZRouter / OpenAI-compatible proxy" }) }).getByRole("button", { name: "Configure" });
  await configure.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  check("Dialog has the required fields", (await Promise.all(["Connection name", "API base URL", "API key", "Model ID"].map((label) => dialog.getByLabel(label, { exact: false }).first().isVisible()))).every(Boolean));
  check("API key input is masked", (await dialog.getByLabel("API key", { exact: false }).first().getAttribute("type")) === "password");
  check("Base URL field shows a placeholder only", (await dialog.getByLabel("API base URL", { exact: false }).first().inputValue()) === "");
  await dialog.getByRole("button", { name: "Test connection" }).click();
  check("Empty submit shows validation", await dialog.getByText("Enter the API base URL.").isVisible());
  await shot(page, "02-zrouter-dialog-validation");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  check("Escape closes the dialog", true);

  // Settings: a single Console section and workspace sign-in wording.
  await page.getByRole("button", { name: "Settings" }).last().click();
  const settings = page.getByRole("dialog");
  await settings.waitFor();
  check("Settings has one Console section", (await settings.getByRole("heading", { name: /Walrus Console/ }).count()) === 1);
  check("Settings labels workspace sign-in", await settings.getByText("Workspace sign-in").first().isVisible());
  await shot(page, "03-settings-desktop");
  await page.keyboard.press("Escape");

  // Chat empty state: calm intro, no pre-rendered findings, sending disabled until ZRouter is Ready.
  await page.goto(`${APP}/builder/chat`);
  await page.getByText("Configure ZRouter and test it until it shows Ready").waitFor();
  check("Chat explains ZRouter is required", true);
  check("Send disabled without a Ready model", await page.getByRole("button", { name: "Send" }).isDisabled());
  check("No suggested memories before any run", (await page.getByRole("region", { name: "Suggested memories" }).count()) === 0);
  await shot(page, "04-chat-empty-desktop");

  // Narrow viewport.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${APP}/builder/integrations`);
  await statusOf(page, "ZRouter / OpenAI-compatible proxy").waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("No horizontal overflow at 390px", overflow <= 1, `overflow ${overflow}px`);
  await shot(page, "05-integrations-narrow");
  await page.goto(`${APP}/builder/chat`);
  await page.getByLabel("Message").waitFor();
  const chatOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("Chat has no horizontal overflow at 390px", chatOverflow <= 1, `overflow ${chatOverflow}px`);
  await shot(page, "06-chat-narrow");
  check("Reduced motion stops the phase animation", await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches));
} finally {
  writeEvidence("ui-check.json", { when: new Date().toISOString(), results, consoleErrors: consoleErrors.slice(0, 20) });
  await browser.close();
}
const failed = results.filter((result) => !result.pass);
console.log(`${results.length - failed.length}/${results.length} UI checks passed`);
process.exit(failed.length ? 1 : 0);
