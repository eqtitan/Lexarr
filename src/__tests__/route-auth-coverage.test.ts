/**
 * Every API route must either check who is calling or be on the short
 * public list below, so a new route can't ship without a login check by
 * accident. Static check of the source; each route's own tests cover how
 * it answers.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const API_DIR = path.resolve(__dirname, "../app/api");

/** Routes anyone may call, and why. */
const PUBLIC: Record<string, string> = {
  healthz: "deploy readiness probe; reports only up/down per service",
  livez: "container liveness probe",
  version: "build version for the footer and deploy checks",
  config: "login page needs to know which sign-in methods are on",
  "auth/[...nextauth]": "sign-in itself (rate-limited)",
  "auth/register": "first-user setup; closed afterwards unless REGISTRATION_OPEN",
  "auth/plex": "Plex sign-in flow (rate-limited)",
};

/** Patterns that count as checking the caller. */
const GUARDS = [/\bauth\(\)/, /\brequireAdmin\(/, /\bverifyWebhookToken\(/];

function routes(dir: string, prefix = ""): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const rel = prefix ? `${prefix}/${d.name}` : d.name;
    if (d.isDirectory()) return routes(path.join(dir, d.name), rel);
    return d.name === "route.ts" ? [prefix] : [];
  });
}

describe("API route auth coverage", () => {
  const all = routes(API_DIR);

  it("finds the routes", () => {
    expect(all.length).toBeGreaterThan(30);
  });

  it.each(all.filter((r) => !(r in PUBLIC)))("%s checks the caller", (route) => {
    const src = fs.readFileSync(path.join(API_DIR, route, "route.ts"), "utf8");
    expect(GUARDS.some((g) => g.test(src)), `${route} has no auth()/requireAdmin()/webhook check`).toBe(true);
  });

  it("has no stale entries on the public list", () => {
    for (const r of Object.keys(PUBLIC)) expect(all).toContain(r);
  });
});
