import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * End-to-end smoke tests (e2e/). They run the real production build
 * (`npm run build` first) against a freshly seeded SQLite DB and a stub
 * TMDB/*arr server, so nothing outside this machine is contacted.
 */
const PORT = 5057;
const DB_FILE = path.resolve(__dirname, "e2e/.tmp/e2e.db").replace(/\\/g, "/");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/stub-server.mjs",
      url: "http://127.0.0.1:7878/api/v3/health",
      reuseExistingServer: false,
    },
    {
      command: `node e2e/seed.mjs && npx next start -p ${PORT} -H 127.0.0.1`,
      url: `http://127.0.0.1:${PORT}/api/livez`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: `file:${DB_FILE}`,
        NEXTAUTH_SECRET: "e2e-secret-not-for-production",
        PORT: String(PORT), // readiness self-check fetches its own pages
        NEXTAUTH_URL: `http://127.0.0.1:${PORT}`,
        AUTH_TRUST_HOST: "true",
        AUTH_JELLYFIN_ENABLED: "false",
        ARR_HOST: "http://127.0.0.1",
        RADARR_API_KEY: "e2e",
        SONARR_API_KEY: "e2e",
        LIDARR_API_KEY: "e2e",
        TMDB_API_KEY: "e2e",
        TMDB_API_BASE: "http://127.0.0.1:9100",
        DISCOVER_STUB_BASE: "http://127.0.0.1:9100",
      },
    },
  ],
});
