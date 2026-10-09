// Browser audit of the builder pages with a signed-in user whose ZRouter and
// Memory are Ready: truncated or overlapping controls, badges that act like
// buttons, provider connect behaviour and runtime errors. No model calls, no saves.
//   node scripts/e2e/ui-audit.mjs
import { existsSync, readFileSync } from "node:fs";
import { API, APP, launch, shot, statusOf, writeEvidence } from "./lib.mjs";

const USER_FILE = process.env.USER_FILE ?? `${process.env.HOME}/memwal-demo-tmp/live-user.json`;
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const layoutProblems = (page) => page.evaluate(() => {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  };
  // Only controls a user can actually see and hit: an element scrolled out of
  // view inside a scrolling list is clipped, not overlapping.
  const hittable = (element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(hit) && (hit === element || element.contains(hit) || hit.contains(element));
  };
  const controls = [...document.querySelectorAll("button, a.btn, select, input:not([type=hidden]), textarea")].filter(visible).filter(hittable);
  const label = (element) => (element.getAttribute("aria-label") || element.textContent || element.getAttribute("placeholder") || element.tagName).trim().slice(0, 40);
  const truncated = controls
    .filter((element) => element.tagName === "BUTTON" || element.tagName === "A")
    .filter((element) => element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflow !== "visible")
    .map(label);
  const overlaps = [];
  for (let i = 0; i < controls.length; i += 1) {
    for (let j = i + 1; j < controls.length; j += 1) {
      const a = controls[i];
      const b = controls[j];
      if (a.contains(b) || b.contains(a)) continue;
      const r1 = a.getBoundingClientRect();
      const r2 = b.getBoundingClientRect();
      const x = Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left);
      const y = Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top);
      if (x > 4 && y > 4) overlaps.push(`${label(a)} × ${label(b)}`);
    }
  }
  return { truncated, overlaps: overlaps.slice(0, 10), horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});

const { browser, context, page } = await launch();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text().slice(0, 200)}`); });
const layout = {};
try {
  if (!existsSync(USER_FILE)) throw new Error("Run live-journey.mjs STAGE=setup first");
  await context.request.post(`${API}/auth/login`, { data: JSON.parse(readFileSync(USER_FILE, "utf8")) });

  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${APP}/builder/integrations`);
    await statusOf(page, "Walrus Memory").filter({ hasText: /Ready|Not connected|Needs|Unavailable/ }).waitFor({ timeout: 20_000 });
    layout[`integrations ${width}`] = await layoutProblems(page);
    await page.goto(`${APP}/builder`);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const agent = page.getByRole("link", { name: "Product Discovery", exact: true }).first();
    if (await agent.count()) { await agent.click().catch(() => undefined); await page.waitForTimeout(800); }
    layout[`agent canvas ${width}`] = { url: page.url().replace(APP, ""), ...(await layoutProblems(page)) };
    await shot(page, `50-agent-canvas-${width}`);
    await page.goto(`${APP}/builder/chat`);
    await page.getByLabel("Message").waitFor();
    layout[`chat ${width}`] = await layoutProblems(page);
  }
  for (const [name, value] of Object.entries(layout)) {
    check(`No truncated buttons: ${name}`, value.truncated.length === 0, value.truncated.join(", "));
    check(`No overlapping controls: ${name}`, value.overlaps.length === 0, value.overlaps.join("; "));
    check(`No horizontal overflow: ${name}`, value.horizontalOverflow <= 1, `${value.horizontalOverflow}px`);
  }

  // Badges are status text, not buttons, and clicking them changes nothing.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${APP}/builder/integrations`);
  await statusOf(page, "Walrus Memory").filter({ hasText: "Ready" }).waitFor({ timeout: 20_000 });
  for (const name of ["ZRouter / OpenAI-compatible proxy", "Walrus Memory", "Walrus Console"]) {
    const badge = statusOf(page, name);
    const before = await badge.textContent();
    const tag = await badge.evaluate((element) => element.tagName);
    await badge.click();
    await page.waitForTimeout(400);
    check(`${name} badge is not a control and stays "${before}"`, tag !== "BUTTON" && (await statusOf(page, name).textContent()) === before && (await page.getByRole("dialog").count()) === 0);
  }
  const memory = await (await context.request.get(`${API}/memory/session`)).json();
  check("Memory is still connected after clicking badges", memory.walrus?.status === "verified");

  // A provider that needs authorization never shows Connected without the provider's confirmation.
  const claude = page.locator("li", { has: page.locator("strong", { hasText: /^Claude$/ }) });
  const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
  await claude.getByRole("button", { name: "Connect" }).click();
  const popup = await popupPromise;
  await page.waitForTimeout(3000);
  const claudeStatus = await claude.getByRole("status").textContent();
  const alert = await page.getByRole("alert").allTextContents();
  const callbackField = await page.getByLabel(/callback|authorization code/i).count();
  check("Claude is not marked Connected without provider confirmation", !/^Connected$/.test(claudeStatus ?? ""), `status "${claudeStatus}", popup ${popup ? popup.url().slice(0, 60) : "none"}, callback field ${callbackField}, message ${alert.join(" | ").slice(0, 160)}`);
  await shot(page, "51-claude-connect-attempt");
  if (popup) await popup.close();

  // Settings: one Console section, workspace sign-in wording.
  await page.getByRole("button", { name: "Settings" }).last().click();
  const settings = page.getByRole("dialog");
  await settings.waitFor();
  check("Settings has exactly one Walrus Console section", (await settings.getByRole("heading", { name: /Walrus Console/ }).count()) === 1);
  check("Wallet sign-in is labelled as workspace sign-in, not Console", (await settings.getByText("Workspace sign-in").count()) > 0);
  await page.keyboard.press("Escape");
  check("No runtime errors in the console", errors.length === 0, errors.slice(0, 5).join(" | "));
} catch (error) {
  check("Run completed", false, error instanceof Error ? error.message : String(error));
  await shot(page, "error-ui-audit").catch(() => undefined);
} finally {
  writeEvidence("ui-audit.json", { when: new Date().toISOString(), results, layout, errors: errors.slice(0, 30) });
  await browser.close();
}
const failed = results.filter((result) => !result.pass);
console.log(`${results.length - failed.length}/${results.length} audit checks passed`);
process.exit(failed.length ? 1 : 0);
