/**
 * Request routes against a real SQLite DB: admin approve/deny/cancel,
 * admin retry, a user's request list, pipeline events and notifications.
 * Replaces the mocked-Prisma admin-requests, admin-retry, requests and
 * notifications suites. Only the *arr router is stubbed.
 */
import { useTestDb, testPrisma } from "../helpers/test-db";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

useTestDb();

let session: unknown = null;
vi.mock("@/lib/auth/config", () => ({ auth: vi.fn(async () => session) }));
const routeToArr = vi.fn();
vi.mock("@/lib/arr/router", () => ({ routeToArr: (...a: unknown[]) => routeToArr(...a) }));

function req(body?: unknown): NextRequest {
  return {
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => Promise.resolve(body ?? {}),
  } as unknown as NextRequest;
}

let adminId: string;
let aliceId: string;
let bobId: string;
const asAdmin = () => (session = { user: { id: adminId, name: "admin", role: "admin" } });
const asAlice = () => (session = { user: { id: aliceId, name: "alice", role: "user" } });

beforeEach(async () => {
  vi.clearAllMocks();
  const prisma = await testPrisma();
  adminId = (await prisma.user.create({ data: { name: "admin", role: "admin" } })).id;
  aliceId = (await prisma.user.create({ data: { name: "alice" } })).id;
  bobId = (await prisma.user.create({ data: { name: "bob" } })).id;
  asAdmin();
});

async function makeRequest(data: {
  userId?: string;
  status: string;
  title?: string;
  releaseType?: string;
  retryCount?: number;
  autoRetryCount?: number;
  availableAt?: Date;
}) {
  const prisma = await testPrisma();
  return prisma.request.create({
    data: {
      userId: data.userId ?? aliceId,
      mediaType: data.releaseType ? "music" : "movie",
      externalId: `${Math.random()}`,
      title: data.title ?? "Dune",
      status: data.status,
      releaseType: data.releaseType,
      retryCount: data.retryCount ?? 0,
      autoRetryCount: data.autoRetryCount ?? 0,
      availableAt: data.availableAt,
    },
  });
}
const statusOf = async (id: string) =>
  (await (await testPrisma()).request.findUniqueOrThrow({ where: { id } })).status;

describe("/api/admin/requests", () => {
  const routes = () => import("@/app/api/admin/requests/route");

  it("is admin-only", async () => {
    const { GET, PATCH, DELETE } = await routes();
    session = null;
    expect((await GET()).status).toBe(403);
    asAlice();
    expect((await GET()).status).toBe(403);
    expect((await PATCH(req({ requestId: "x", action: "approve" }))).status).toBe(403);
    expect((await DELETE(req({ requestId: "x" }))).status).toBe(403);
  });

  it("lists pending requests only", async () => {
    await makeRequest({ status: "pending", title: "Wanted" });
    await makeRequest({ status: "available", title: "Done" });
    const { GET } = await routes();
    const { requests } = await (await GET()).json();
    expect(requests.map((r: { title: string }) => r.title)).toEqual(["Wanted"]);
  });

  it("validates PATCH and DELETE input", async () => {
    const { PATCH, DELETE } = await routes();
    expect((await PATCH(req({ requestId: "x", action: "explode" }))).status).toBe(400);
    expect((await PATCH(req({ action: "approve" }))).status).toBe(400);
    expect((await DELETE(req({}))).status).toBe(400);
  });

  it("approves: sends to the *arr and moves to downloading", async () => {
    routeToArr.mockResolvedValue({ arrId: 7, alreadyExists: false });
    const r = await makeRequest({ status: "pending" });
    const { PATCH } = await routes();
    const res = await PATCH(req({ requestId: r.id, action: "approve" }));
    expect(res.status).toBe(200);
    expect(await statusOf(r.id)).toBe("downloading");
  });

  it("logs the chosen qualityProfileId/rootFolderPath on the sent_to_arr pipeline event", async () => {
    routeToArr.mockResolvedValue({
      arrId: 7,
      alreadyExists: false,
      qualityProfileId: 4,
      rootFolderPath: "/media/movies",
    });
    const r = await makeRequest({ status: "pending" });
    const { PATCH } = await routes();
    await PATCH(req({ requestId: r.id, action: "approve" }));

    const prisma = await testPrisma();
    const event = await prisma.pipelineEvent.findFirst({
      where: { requestId: r.id, event: "sent_to_arr" },
    });
    expect(JSON.parse(event?.detail ?? "{}")).toEqual({
      arrId: 7,
      alreadyExists: false,
      qualityProfileId: 4,
      rootFolderPath: "/media/movies",
    });
  });

  it("approve surfaces the *arr error and marks the request failed", async () => {
    routeToArr.mockRejectedValue(new Error("Radarr down"));
    const r = await makeRequest({ status: "pending" });
    const { PATCH } = await routes();
    const json = await (await PATCH(req({ requestId: r.id, action: "approve" }))).json();
    expect(json.arrError).toBe("Radarr down");
    expect(await statusOf(r.id)).toBe("failed");
  });

  it("denies a pending request", async () => {
    const r = await makeRequest({ status: "pending" });
    const { PATCH } = await routes();
    expect((await PATCH(req({ requestId: r.id, action: "deny", note: "no" }))).status).toBe(200);
    expect(await statusOf(r.id)).toBe("denied");
  });

  it.each(["approve", "deny"])("%s on a request that's no longer pending → 409", async (action) => {
    const r = await makeRequest({ status: "denied" });
    const { PATCH } = await routes();
    expect((await PATCH(req({ requestId: r.id, action }))).status).toBe(409);
  });

  it("cancels an in-progress request; cancelling a terminal one → 409", async () => {
    const active = await makeRequest({ status: "downloading" });
    const done = await makeRequest({ status: "available" });
    const { DELETE } = await routes();
    expect((await DELETE(req({ requestId: active.id }))).status).toBe(200);
    expect(await statusOf(active.id)).toBe("cancelled");
    expect((await DELETE(req({ requestId: done.id }))).status).toBe(409);
  });
});

describe("/api/admin/retry", () => {
  const retry = async (body: unknown) => (await import("@/app/api/admin/retry/route")).POST(req(body));

  it("is admin-only and validates input", async () => {
    asAlice();
    expect((await retry({ requestId: "x" })).status).toBe(403);
    asAdmin();
    expect((await retry({})).status).toBe(400);
    expect((await retry({ requestId: "nope" })).status).toBe(404);
  });

  it("refuses a status that can't be retried regardless of retryCount", async () => {
    const done = await makeRequest({ status: "available" });
    expect((await retry({ requestId: done.id })).status).toBe(400);
  });

  it("retries a 'downloading' request (warnings.ts's Orphaned-download case) -- previously dead on arrival", async () => {
    // Regression test: the "Orphaned download" warning (downloading, no
    // queue item) pointed at this same action, but "downloading" wasn't
    // in RETRYABLE -- the admin's only offered action always 400'd.
    routeToArr.mockResolvedValue({ arrId: 9, alreadyExists: true });
    const r = await makeRequest({ status: "downloading" });
    const res = await retry({ requestId: r.id });
    expect(res.status).toBe(200);
    expect(await statusOf(r.id)).toBe("downloading");
  });

  it("has no retry cap: a request already retried many times can still be retried manually", async () => {
    // Regression test: manual retry used to share a hard-capped counter
    // with the silent background auto-retry (status-checker.ts Tier A),
    // so an admin could lose the ability to retry at all with no warning.
    // A deliberate admin click isn't capped the way an unattended loop is.
    routeToArr.mockResolvedValue({ arrId: 9, alreadyExists: false });
    const r = await makeRequest({ status: "failed", retryCount: 10 });
    const res = await retry({ requestId: r.id });
    expect(res.status).toBe(200);
    expect(await statusOf(r.id)).toBe("downloading");
  });

  it("is unaffected by autoRetryCount being maxed out -- the two counters are independent", async () => {
    routeToArr.mockResolvedValue({ arrId: 9, alreadyExists: false });
    const r = await makeRequest({ status: "failed", autoRetryCount: 3 });
    expect((await retry({ requestId: r.id })).status).toBe(200);
    const row = await (await testPrisma()).request.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ status: "downloading", retryCount: 1, autoRetryCount: 3 });
  });

  it("re-sends with the request's own releaseType and moves to downloading", async () => {
    routeToArr.mockResolvedValue({ arrId: 5, alreadyExists: false });
    const r = await makeRequest({ status: "failed", releaseType: "single" });
    expect((await retry({ requestId: r.id })).status).toBe(200);
    expect(routeToArr).toHaveBeenCalledWith(expect.objectContaining({ releaseType: "single" }));
    const row = await (await testPrisma()).request.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ status: "downloading", arrId: 5, retryCount: 1 });
  });

  it("marks the request failed when the *arr send fails", async () => {
    routeToArr.mockRejectedValue(new Error("Radarr unreachable"));
    const r = await makeRequest({ status: "stalled" });
    const res = await retry({ requestId: r.id });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Radarr unreachable");
    expect(await statusOf(r.id)).toBe("failed");
  });
});

describe("/api/requests and events", () => {
  it("requires a session", async () => {
    session = null;
    const { GET } = await import("@/app/api/requests/route");
    expect((await GET()).status).toBe(403);
  });

  it("shows a user only their own requests; admins see everyone's", async () => {
    await makeRequest({ status: "pending", title: "Alice's" });
    await makeRequest({ userId: bobId, status: "pending", title: "Bob's" });
    const { GET } = await import("@/app/api/requests/route");

    asAlice();
    const mine = (await (await GET()).json()).requests.map((r: { title: string }) => r.title);
    expect(mine).toEqual(["Alice's"]);
    asAdmin();
    expect((await (await GET()).json()).requests).toHaveLength(2);
  });

  it("events: owner and admin can read; others get 404 (not 403)", async () => {
    const r = await makeRequest({ status: "pending" });
    await (await testPrisma()).pipelineEvent.create({ data: { requestId: r.id, event: "submitted" } });
    const { GET } = await import("@/app/api/requests/[id]/events/route");
    const call = (id: string) => GET(new Request("http://x"), { params: Promise.resolve({ id }) });

    session = null;
    expect((await call(r.id)).status).toBe(401);
    asAlice();
    expect((await (await call(r.id)).json()).events).toHaveLength(1);
    expect((await call("missing")).status).toBe(404);
    session = { user: { id: bobId, role: "user" } };
    expect((await call(r.id)).status).toBe(404);
    asAdmin();
    expect((await call(r.id)).status).toBe(200);
  });
});

describe("/api/notifications", () => {
  it("returns only the user's own requests that became available in the last 7 days", async () => {
    const now = Date.now();
    await makeRequest({ status: "available", title: "New", availableAt: new Date(now - 60_000) });
    await makeRequest({ status: "available", title: "Old", availableAt: new Date(now - 8 * 864e5) });
    await makeRequest({ status: "downloading", title: "Not yet" });
    await makeRequest({ userId: bobId, status: "available", title: "Bob's", availableAt: new Date(now) });
    const { GET } = await import("@/app/api/notifications/route");

    session = null;
    expect((await GET()).status).toBe(401);
    asAlice();
    const { notifications } = await (await GET()).json();
    expect(notifications.map((n: { title: string }) => n.title)).toEqual(["New"]);
  });
});
