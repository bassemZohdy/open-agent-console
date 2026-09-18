#!/usr/bin/env node

import { mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.OAC_DEMO_BASE_URL ?? "http://127.0.0.1:5173";
const outputDir = resolve("docs/assets");
const videoTempDir = resolve(".capture-video");
mkdirSync(outputDir, { recursive: true });
mkdirSync(videoTempDir, { recursive: true });

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(baseUrl + "/api/ready");
      if (response.ok) return;
    } catch {
      // The local server may still be starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }
  throw new Error("Open Agent Console is not ready at " + baseUrl);
}

async function request(path, options) {
  const response = await fetch(baseUrl + path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    throw new Error((options?.method ?? "GET") + " " + path + " failed with " + response.status + ": " + await response.text());
  }
  return response.status === 204 ? undefined : response.json();
}

await waitForServer();

const suffix = Date.now().toString(36);
const model = await request("/api/models", {
  method: "POST",
  body: JSON.stringify({
    name: "README demo model " + suffix,
    provider: "fake",
    modelId: "deterministic",
    apiKeyEnv: "",
    capabilities: ["streaming"],
    timeoutMs: 10000,
    maxRetries: 0,
  }),
});
const agent = await request("/api/agents", {
  method: "POST",
  body: JSON.stringify({
    name: "README demo agent " + suffix,
    description: "Deterministic agent used by the README walkthrough.",
    modelRef: model.id,
    instructions: "Reply with a short deterministic response and mention that this is a README demo.",
    maxModelCalls: 6,
    maxToolCalls: 10,
    skillIds: [],
    toolIds: [],
  }),
});

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: videoTempDir, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  await page.screenshot({ path: resolve(outputDir, "dashboard.png"), fullPage: true });

  await page.getByRole("button", { name: /Agents Runtime instances/ }).click();
  await page.getByText(agent.name, { exact: true }).waitFor();
  await page.locator(".registry-row").filter({ hasText: agent.name }).getByRole("button", { name: "Chat" }).click();
  await page.getByRole("dialog", { name: agent.name + " chat" }).waitFor();
  await page.getByLabel("Message the agent").fill("Show a deterministic README demo response.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("dialog", { name: agent.name + " chat" }).getByText("Deterministic").waitFor();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve(outputDir, "agent-chat.png"), fullPage: true });

  await page.getByRole("button", { name: "Close chat" }).click();
  await page.getByRole("button", { name: /Runs Execution log/ }).click();
  await page.getByRole("button", { name: "Inspect" }).first().click();
  await page.getByText("RUN DETAIL").waitFor();
  await page.screenshot({ path: resolve(outputDir, "run-detail.png"), fullPage: true });
  await page.waitForTimeout(1500);
} finally {
  const video = page.video();
  await context.close();
  await browser.close();
  if (video) {
    const tempVideo = await video.path();
    copyFileSync(tempVideo, resolve(outputDir, "open-agent-console-demo.webm"));
  }
}
console.log("Captured README media in " + outputDir);

