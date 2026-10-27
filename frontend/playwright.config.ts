import { defineConfig } from "@playwright/test"

// Browser tests against a separate API (port 8100) and database (nis2_e2e, recreated with demo data on every run),
// using the locally installed Google Chrome. Run: `npm run e2e` (or `npm run e2e -- --headed`).
const API_PORT = 8100
const WEB_PORT = 5180
// The first-run project gets its own API on an empty database (no bootstrap admin) and its own Vite.
const SETUP_API_PORT = 8101
const SETUP_WEB_PORT = 5181
export const E2E_ENV = {
  NIS2_DATABASE_URL: "postgresql+psycopg://nis2@127.0.0.1:55432/nis2_e2e",
  NIS2_ENV: "development",
  NIS2_BASE_URL: `http://localhost:${WEB_PORT}`,
  NIS2_BOOTSTRAP_ADMIN_EMAIL: "admin@example.local",
  NIS2_BOOTSTRAP_ADMIN_PASSWORD: "E2E-Admin-Password-2026!",
  NIS2_SMTP_HOST: "",
}

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1, // one shared database
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" } },
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    locale: "en-GB",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "chrome", dependencies: ["setup"], testIgnore: [/auth\.setup\.ts/, /setup\.spec\.ts/] },
    { name: "first-run", testMatch: /setup\.spec\.ts/, use: { baseURL: `http://localhost:${SETUP_WEB_PORT}` } },
  ],
  webServer: [
    {
      command: `../scripts/e2e-db.sh && exec .venv/bin/uvicorn app.main:app --port ${API_PORT}`,
      cwd: "../backend",
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: { ...process.env, ...E2E_ENV } as Record<string, string>,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { ...process.env, NIS2_API_TARGET: `http://127.0.0.1:${API_PORT}` } as Record<string, string>,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `../scripts/e2e-db.sh --empty nis2_e2e_setup && exec .venv/bin/uvicorn app.main:app --port ${SETUP_API_PORT}`,
      cwd: "../backend",
      url: `http://127.0.0.1:${SETUP_API_PORT}/api/health`,
      env: {
        ...process.env,
        NIS2_DATABASE_URL: "postgresql+psycopg://nis2@127.0.0.1:55432/nis2_e2e_setup",
        NIS2_ENV: "development",
        NIS2_BASE_URL: `http://localhost:${SETUP_WEB_PORT}`,
        NIS2_BOOTSTRAP_ADMIN_EMAIL: "",
        NIS2_BOOTSTRAP_ADMIN_PASSWORD: "",
        NIS2_SMTP_HOST: "",
      } as Record<string, string>,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `npx vite --port ${SETUP_WEB_PORT} --strictPort`,
      url: `http://localhost:${SETUP_WEB_PORT}`,
      env: { ...process.env, NIS2_API_TARGET: `http://127.0.0.1:${SETUP_API_PORT}` } as Record<string, string>,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
