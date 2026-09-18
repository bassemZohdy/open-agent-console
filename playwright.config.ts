import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DB_FILE_NAME: "/tmp/open-agent-console-e2e.db",
      HOST: "127.0.0.1",
      PORT: "3000",
    },
  },
});
