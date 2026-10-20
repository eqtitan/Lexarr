/**
 * Smoke test of the core Lexarr flow, end to end, through the real UI:
 * a user searches and requests a movie, an admin approves it, Radarr (the
 * stub) receives it, and once the download "finishes" the request shows
 * as available. See e2e/stub-server.mjs and e2e/seed.mjs.
 */
import { test, expect, type Page } from "@playwright/test";

const RADARR = "http://127.0.0.1:7878";
const DUNE_TMDB_ID = 438631;

// Content-Security-Policy is report-only (next.config.ts): violations are
// logged to the console, not blocked. Any violation fails the run, so the
// policy can be switched to enforcing once this stays clean.
const cspViolations: string[] = [];
function watchCsp(page: Page) {
  page.on("console", (msg) => {
    const text = msg.text();
    if (/Content Security Policy|Content-Security-Policy|\[Report Only\]/i.test(text)) {
      cspViolations.push(text);
    }
  });
}

async function login(page: Page, name: string, password: string) {
  await page.goto("/login");
  await page.getByPlaceholder("Username").fill(name);
  await page.getByPlaceholder("Password").fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/");
}

test("request → approve → sent to Radarr → available", async ({ browser, request }) => {
  // ── A regular user searches and requests a movie ──────────────────
  const userCtx = await browser.newContext();
  const user = await userCtx.newPage();
  watchCsp(user);
  await login(user, "alice", "alice-pass-123");

  await user.getByRole("button", { name: "Movies", exact: true }).click();
  await user.getByPlaceholder("Search movies, TV shows, music, books...").fill("Dune");
  await expect(user.getByRole("heading", { name: /^Dune/ })).toBeVisible();
  await user.getByRole("button", { name: "Request", exact: true }).first().click();
  await expect(user.getByRole("button", { name: "Requested ✓" })).toBeVisible();

  // Not auto-approved: nothing reaches Radarr yet.
  expect((await (await request.get(`${RADARR}/__e2e/state`)).json()).movies).toHaveLength(0);

  // ── An admin approves it from the dashboard ───────────────────────
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  watchCsp(admin);
  await login(admin, "e2e-admin", "admin-pass-123");
  await admin.goto("/admin/dashboard");
  await admin.getByRole("tab", { name: /Approvals/ }).click();
  await admin.getByRole("button", { name: "Approve", exact: true }).click();
  await admin.getByRole("button", { name: "Confirm", exact: true }).click();

  await expect
    .poll(async () => (await (await request.get(`${RADARR}/__e2e/state`)).json()).movies)
    .toEqual([expect.objectContaining({ tmdbId: DUNE_TMDB_ID, hasFile: false })]);

  // ── The download finishes; the next status check marks it available ─
  await request.post(`${RADARR}/__e2e/import?tmdbId=${DUNE_TMDB_ID}`);
  const check = await admin.request.post("/api/status");
  expect(check.ok()).toBe(true);

  const mine = await (await user.request.get("/api/requests")).json();
  expect(mine.requests).toEqual([
    expect.objectContaining({ title: "Dune", status: "available" }),
  ]);
  await user.goto("/requests");
  await expect(user.getByText("Available", { exact: true })).toHaveCount(1);

  expect(cspViolations).toEqual([]);

  await userCtx.close();
  await adminCtx.close();
});

test("health endpoints: liveness up, readiness sees the stub *arr apps", async ({ request }) => {
  expect((await request.get("/api/livez")).status()).toBe(200);
  const ready = await request.get("/api/healthz");
  expect(ready.status()).toBe(200);
  expect((await ready.json()).ok).toBe(true);
});
