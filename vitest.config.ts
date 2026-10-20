import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    // Migrates one template DB per run for real-DB tests (helpers/test-db.ts).
    globalSetup: ["./src/__tests__/helpers/db-template.global.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      // istanbul, not v8: source-level instrumentation at transform time,
      // rather than tracking which scripts V8 happened to load at runtime.
      // A category of routes here (auth/plex, library-status, quality-profiles,
      // requests, requests/[id]/events, config, admin/audit, etc.) appeared
      // completely absent from the v8 *text* coverage table -- investigated
      // 2026-07-06/07-10 and confirmed via coverage-summary.json that this
      // was a text-reporter display bug (rows silently dropped from the
      // printed table), NOT actually missing coverage -- every one of those
      // files is at 100% in the underlying data, and the true overall
      // src/app/api/ figure (73.00%) matches what PR #8 originally reported.
      // Switching to istanbul anyway as a more standard/widely-used provider,
      // but note: the *same* text-table row-dropping happens under istanbul
      // too, so don't eyeball the printed table for exact per-file numbers --
      // read coverage/coverage-summary.json (already emitted) instead.
      provider: "istanbul",
      reporter: ["text", "json-summary"],
      include: ["src/lib/**", "src/app/api/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
