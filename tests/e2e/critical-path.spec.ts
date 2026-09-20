import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("control panel critical paths", () => {
  test.beforeEach(async ({ page }) => {
    await expect.poll(async () => (await page.request.get("/api/ready")).status(), { timeout: 30_000 }).toBe(200);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible({ timeout: 15_000 });
    const signIn = page.getByRole("button", { name: "Sign in", exact: true });
    if (await signIn.count()) {
      await signIn.click();
      const dialog = page.getByRole("dialog", { name: "Sign in to your runtime." });
      await dialog.getByLabel("Username").fill("admin");
      await dialog.locator('input[type="password"]').fill("admin");
      await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
    }
    await expect(page.getByText("Admin", { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Dashboard: Overview", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("keyboard navigation and page accessibility", async ({ page }) => {
    await page.getByRole("button", { name: /Models.*Providers/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Models" })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("create, chat, reopen session, inspect run, and export", async ({ page }, testInfo) => {
    const suffix = `${testInfo.workerIndex}-${testInfo.retry}-${Date.now()}`;
    const modelName = `E2E fake model ${suffix}`;
    const agentName = `E2E agent ${suffix}`;

    await page.getByRole("button", { name: /Models.*Providers/ }).click();
    await page.getByRole("button", { name: "Add model", exact: true }).click();
    await page.getByLabel("Name").fill(modelName);
    await page.locator("#model-provider").click();
    await page.getByRole("option", { name: /Deterministic fake/ }).click();
    await page.getByLabel("Model ID").fill("deterministic");
    await page.getByLabel("Credential environment variable").fill("");
    await page.getByRole("button", { name: "Save model" }).click();
    await expect(page.getByText(modelName, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Agents.*Runtime instances/ }).click();
    await page.getByRole("button", { name: "Add agent", exact: true }).click();
    await page.getByLabel("Name").fill(agentName);
    await page.locator("#agent-model").click();
    await page.getByRole("option", { name: modelName, exact: true }).click();
    await page.getByLabel("Instructions").fill("Reply with a short deterministic response.");
    await page.getByRole("button", { name: "Create agent", exact: true }).click();
    await expect(page.getByText(agentName, { exact: true })).toBeVisible();

    await page.locator(".registry-row").filter({ hasText: agentName }).getByRole("button", { name: "Chat" }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "browser-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("browser attachment context"),
    });
    await expect(page.getByText("browser-notes.txt", { exact: true }).first()).toBeVisible();
    await page.getByLabel("Message the agent").fill("hello from browser");
    await page.getByRole("button", { name: "Send" }).click();
    const chat = page.getByRole("region", { name: `${agentName} chat` });
    await expect(chat).toContainText("hello from browser");
    await expect(chat).toContainText("browser-notes.txt");
    await expect(chat).toContainText("Deterministic");
    await expect(chat).toContainText("Activity");

    await page.getByRole("button", { name: "View all conversations", exact: true }).click();
    await expect(page.getByRole("heading", { name: "All conversations" })).toBeVisible();
    await expect(page.getByText("hello from browser").first()).toBeVisible();
    await page.locator(".conversation-manager-row").filter({ hasText: agentName }).getByRole("button", { name: /Open/ }).click();
    await expect(page.getByRole("region", { name: `${agentName} chat` })).toBeVisible();
    await expect(page.getByRole("region", { name: `${agentName} chat` })).toContainText("browser-notes.txt");

    await page.getByRole("button", { name: /Settings.*Operations/ }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export registry" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/registry.*\.json$/);
    await page.locator('input[type="file"]').setInputFiles({
      name: "registry.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ version: 1, models: [], skills: [], tools: [], mcpServers: [], memoryConnectors: [], agents: [] })),
    });
    await expect(page.locator('[role="status"]').filter({ hasText: "Registry imported" })).toBeVisible();
  });
});
