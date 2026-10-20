/**
 * Route-level test for /api/admin/services/[name]/diagnose-opened (M2-03).
 *
 * Validates: admin gate, service-name validation, errorClass passes through
 * to AuditLog.detail, malformed payloads collapse to errorClass="unknown"
 * (telemetry must never fail a UI interaction).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  env: () => ({
    NEXTAUTH_SECRET: "test",
    ARR_HOST: "http://localhost",
    RADARR_API_KEY: "test",
    SONARR_API_KEY: "test",
    LIDARR_API_KEY: "test",
    TMDB_API_KEY: "test",
  }),
}));

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

function makeReq(url: string, body: unknown): NextRequest {
  const u = new URL(url);
  return {
    headers: new Headers({ "content-type": "application/json" }),
    nextUrl: u,
    url: u.toString(),
    json: async () => body,
  } as unknown as NextRequest;
}

const ctx = (name: string) => ({ params: Promise.resolve({ name }) });

describe("POST /api/admin/services/[name]/diagnose-opened (M2-03)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 403 for non-admin sessions", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", role: "user" },
      expires: "9999",
    } as never);

    const { POST } = await import(
      "@/app/api/admin/services/[name]/diagnose-opened/route"
    );
    const res = await POST(
      makeReq(
        "http://localhost/api/admin/services/Radarr/diagnose-opened",
        { errorClass: "timeout" },
      ),
      ctx("Radarr"),
    );
    expect(res.status).toBe(403);
    // No audit row should be written when the gate rejects.
    const { logAudit } = await import("@/lib/audit");
    expect(vi.mocked(logAudit)).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown service names", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", role: "admin" },
      expires: "9999",
    } as never);

    const { POST } = await import(
      "@/app/api/admin/services/[name]/diagnose-opened/route"
    );
    const res = await POST(
      makeReq(
        "http://localhost/api/admin/services/MadeUpService/diagnose-opened",
        { errorClass: "timeout" },
      ),
      ctx("MadeUpService"),
    );
    expect(res.status).toBe(404);
  });

  it("records errorClass into AuditLog.detail for valid input", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "admin-1", role: "admin" },
      expires: "9999",
    } as never);

    const { POST } = await import(
      "@/app/api/admin/services/[name]/diagnose-opened/route"
    );
    const res = await POST(
      makeReq(
        "http://localhost/api/admin/services/Sonarr/diagnose-opened",
        { errorClass: "breaker_open" },
      ),
      ctx("Sonarr"),
    );
    expect(res.status).toBe(200);
    const { logAudit } = await import("@/lib/audit");
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      "admin-1",
      "service_diagnose_opened",
      { type: "service", id: "Sonarr" },
      { errorClass: "breaker_open" },
    );
  });

  it("collapses unknown errorClass values to 'unknown'", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "admin-1", role: "admin" },
      expires: "9999",
    } as never);

    const { POST } = await import(
      "@/app/api/admin/services/[name]/diagnose-opened/route"
    );
    const res = await POST(
      makeReq(
        "http://localhost/api/admin/services/Radarr/diagnose-opened",
        { errorClass: "garbage_value_from_stale_client" },
      ),
      ctx("Radarr"),
    );
    expect(res.status).toBe(200);
    const { logAudit } = await import("@/lib/audit");
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      "admin-1",
      "service_diagnose_opened",
      { type: "service", id: "Radarr" },
      { errorClass: "unknown" },
    );
  });

  it("does not crash on missing body — records 'unknown'", async () => {
    const { auth } = await import("@/lib/auth/config");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "admin-1", role: "admin" },
      expires: "9999",
    } as never);

    const { POST } = await import(
      "@/app/api/admin/services/[name]/diagnose-opened/route"
    );
    // Simulate a body that throws on .json() — telemetry must still succeed.
    const u = new URL(
      "http://localhost/api/admin/services/Lidarr/diagnose-opened",
    );
    const req = {
      headers: new Headers(),
      nextUrl: u,
      url: u.toString(),
      json: async () => {
        throw new Error("malformed");
      },
    } as unknown as NextRequest;
    const res = await POST(req, ctx("Lidarr"));
    expect(res.status).toBe(200);
    const { logAudit } = await import("@/lib/audit");
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      "admin-1",
      "service_diagnose_opened",
      { type: "service", id: "Lidarr" },
      { errorClass: "unknown" },
    );
  });
});
