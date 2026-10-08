// Shared helpers for the Product Discovery browser checks (headless Chromium).
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

export const APP = process.env.APP_URL ?? "http://127.0.0.1:5188";
export const API = process.env.API_URL ?? "http://127.0.0.1:8080";
export const OUT = resolve(process.env.EVIDENCE_DIR ?? "../../docs/memwal-chat-demo/evidence");
mkdirSync(OUT, { recursive: true });

export async function launch(options = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const page = await context.newPage();
  return { browser, context, page };
}

/** Creates a throwaway username/password workspace user; wallet sign-in cannot run headless. */
export async function registerUser(context, prefix) {
  const username = `${prefix}${Date.now().toString(36)}`;
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const response = await context.request.post(`${API}/auth/register`, { data: { username, password } });
  if (!response.ok()) throw new Error(`register failed: ${response.status()} ${await response.text()}`);
  return { username };
}

export async function shot(page, name) {
  const path = resolve(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`screenshot ${path}`);
  return path;
}

export function writeEvidence(name, data) {
  const path = resolve(OUT, name);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`evidence ${path}`);
}

export const statusOf = (page, name) =>
  page.locator("li", { has: page.locator("strong", { hasText: name }) }).getByRole("status");
