import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("control panel critical paths", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("keyboard navigation and page accessibility", async ({ page }) => {
    await page.getByRole("button", { name: /Models Providers/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Models" })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("create, chat, reopen session, inspect run, and export", async ({ page }) => {
    await page.getByRole("button", { name: /Models Providers/ }).click();
    await page.getByLabel("Name").fill("E2E fake model");
    await page.getByLabel("Provider").selectOption("fake");
    await page.getByLabel("Model ID").fill("deterministic");
    await page.getByLabel("Credential environment variable").fill("");
    await page.getByRole("button", { name: "Save model" }).click();
    await expect(page.getByText("E2E fake model")).toBeVisible();

    await page.getByRole("button", { name: /Agents Runtime instances/ }).click();
    await page.getByLabel("Name").fill("E2E agent");
    await page.getByLabel("Model").selectOption({ label: "E2E fake model" });
    await page.getByLabel("Instructions").fill("Reply with a short deterministic response.");
    await page.getByRole("button", { name: "Create agent" }).click();
    await expect(page.getByText("E2E agent")).toBeVisible();

    await page.getByRole("button", { name: "Chat" }).click();
    await page.getByLabel("Message the agent").fill("hello from browser");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("dialog", { name: "E2E agent chat" })).toContainText("hello from browser");
    await expect(page.getByRole("dialog", { name: "E2E agent chat" })).toContainText("deterministic");
    await page.getByRole("button", { name: "Close chat" }).click();

    await page.getByRole("button", { name: /Sessions Conversation history/ }).click();
    await expect(page.getByText("hello from browser")).toBeVisible();
    await page.getByRole("button", { name: "Open" }).click();
    await expect(page.getByRole("dialog", { name: "E2E agent chat" })).toBeVisible();
    await page.getByRole("button", { name: "Close chat" }).click();

    await page.getByRole("button", { name: /Runs Execution log/ }).click();
    await expect(page.getByText("completed")).toBeVisible();
    await page.getByRole("button", { name: "Inspect" }).click();
    await expect(page.getByText("RUN DETAIL")).toBeVisible();

    await page.getByRole("button", { name: /Settings Operations/ }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export registry" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/registry.*\.json$/);
    await page.locator('input[type="file"]').setInputFiles({
      name: "registry.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ version: 1, models: [], skills: [], tools: [], mcpServers: [], memoryConnectors: [], agents: [] })),
    });
    await expect(page.getByRole("status")).toContainText("Registry imported");
  });
});
