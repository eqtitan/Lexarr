import { describe, it, expect, vi } from "vitest";

const auth = vi.fn();
vi.mock("@/lib/auth/config", () => ({ auth: () => auth() }));
vi.mock("@/lib/readiness", () => ({ getReadinessReport: vi.fn(async () => ({ status: "ok", checks: [], generatedAt: "t" })) }));

import { GET } from "@/app/api/admin/readiness/route";

describe("GET /api/admin/readiness", () => {
  it.each([[null], [{ user: { role: "user" } }]])("refuses %j with 403", async (session) => {
    auth.mockResolvedValue(session);
    expect((await GET()).status).toBe(403);
  });

  it("returns the report to an admin", async () => {
    auth.mockResolvedValue({ user: { role: "admin" } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });
});
