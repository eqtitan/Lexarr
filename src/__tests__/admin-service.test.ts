/**
 * Direct tests for src/lib/services/admin.ts's approve/deny/cancel guards.
 *
 * Regression coverage for the finding this fixes: approveRequest/
 * denyRequest previously updated by id alone, with no check of the
 * request's current status -- two concurrent calls (double-click, two
 * admin tabs) both ran to completion, double-dispatching to the *arr
 * and double-firing notifications. cancelRequest could also be
 * re-triggered on an already-terminal request.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const requestUpdateMany = vi.fn();
const requestFindUnique = vi.fn();
const requestFindUniqueOrThrow = vi.fn();
const requestFindMany = vi.fn().mockResolvedValue([]);
const pipelineEventCreate = vi.fn().mockResolvedValue({});

vi.mock("@/lib/db", () => ({
  prisma: {
    request: {
      updateMany: (...args: unknown[]) => requestUpdateMany(...args),
      findUnique: (...args: unknown[]) => requestFindUnique(...args),
      findUniqueOrThrow: (...args: unknown[]) => requestFindUniqueOrThrow(...args),
      findMany: (...args: unknown[]) => requestFindMany(...args),
    },
    pipelineEvent: {
      create: (...args: unknown[]) => pipelineEventCreate(...args),
    },
  },
}));

vi.mock("@/lib/log", () => ({ log: { warn: vi.fn(), error: vi.fn() } }));

const notify = vi.fn();
vi.mock("@/lib/notifications", () => ({ notify: (...args: unknown[]) => notify(...args) }));

const logAudit = vi.fn();
vi.mock("@/lib/audit", () => ({ logAudit: (...args: unknown[]) => logAudit(...args) }));

const sendToArrAndUpdateStatus = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/services/request", () => ({
  sendToArrAndUpdateStatus: (...args: unknown[]) => sendToArrAndUpdateStatus(...args),
}));

const radarrGetQueueDetails = vi.fn();
vi.mock("@/lib/arr/radarr", () => ({
  getQueueDetails: (...args: unknown[]) => radarrGetQueueDetails(...args),
}));
vi.mock("@/lib/arr/sonarr", () => ({ getQueue: vi.fn() }));
vi.mock("@/lib/arr/lidarr", () => ({ getQueue: vi.fn() }));

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    title: "Dune",
    mediaType: "movie",
    status: "pending",
    externalId: "438631",
    externalId2: null,
    releaseType: null,
    bookFormat: null,
    arrId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listPendingRequests", () => {
  it("caps the query at 200 rows", async () => {
    const { listPendingRequests } = await import("@/lib/services/admin");
    await listPendingRequests();
    expect(requestFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    );
  });
});

describe("approveRequest", () => {
  it("approves a pending request, updating only rows still in 'pending'", async () => {
    requestUpdateMany.mockResolvedValue({ count: 1 });
    requestFindUniqueOrThrow.mockResolvedValue(requestRow({ status: "approved" }));

    const { approveRequest } = await import("@/lib/services/admin");
    await approveRequest({ requestId: "r1", adminId: "a1", adminName: "Admin" });

    expect(requestUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "r1", status: "pending" } }),
    );
    expect(notify).toHaveBeenCalledTimes(1);
    expect(sendToArrAndUpdateStatus).toHaveBeenCalledTimes(1);
  });

  it("throws RequestConflictError and does NOT dispatch to the *arr or notify when already non-pending", async () => {
    requestUpdateMany.mockResolvedValue({ count: 0 });
    requestFindUnique.mockResolvedValue(requestRow({ status: "denied" }));

    const { approveRequest, RequestConflictError } = await import("@/lib/services/admin");
    await expect(
      approveRequest({ requestId: "r1", adminId: "a1", adminName: "Admin" }),
    ).rejects.toBeInstanceOf(RequestConflictError);

    expect(notify).not.toHaveBeenCalled();
    expect(sendToArrAndUpdateStatus).not.toHaveBeenCalled();
    expect(pipelineEventCreate).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("a second concurrent approve call is rejected even if the first already fired side effects", async () => {
    // Simulates two near-simultaneous approve() calls on the same request:
    // only one updateMany can match status:"pending" (the guard is the
    // real protection here -- Prisma/SQLite serialize the two writes, so
    // exactly one sees count:1 and one sees count:0).
    requestUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    requestFindUniqueOrThrow.mockResolvedValue(requestRow({ status: "approved" }));
    requestFindUnique.mockResolvedValue(requestRow({ status: "approved" }));

    const { approveRequest, RequestConflictError } = await import("@/lib/services/admin");
    const input = { requestId: "r1", adminId: "a1", adminName: "Admin" };

    await approveRequest(input);
    await expect(approveRequest(input)).rejects.toBeInstanceOf(RequestConflictError);

    // Only the first call's side effects ran.
    expect(notify).toHaveBeenCalledTimes(1);
    expect(sendToArrAndUpdateStatus).toHaveBeenCalledTimes(1);
  });
});

describe("denyRequest", () => {
  it("denies a pending request", async () => {
    requestUpdateMany.mockResolvedValue({ count: 1 });
    requestFindUniqueOrThrow.mockResolvedValue(requestRow({ status: "denied" }));

    const { denyRequest } = await import("@/lib/services/admin");
    await denyRequest({ requestId: "r1", adminId: "a1", adminName: "Admin" });

    expect(requestUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "r1", status: "pending" } }),
    );
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("throws RequestConflictError and does not notify when already non-pending", async () => {
    requestUpdateMany.mockResolvedValue({ count: 0 });
    requestFindUnique.mockResolvedValue(requestRow({ status: "approved" }));

    const { denyRequest, RequestConflictError } = await import("@/lib/services/admin");
    await expect(
      denyRequest({ requestId: "r1", adminId: "a1", adminName: "Admin" }),
    ).rejects.toBeInstanceOf(RequestConflictError);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("cancelRequest", () => {
  it("cancels a non-terminal request and attempts best-effort arr queue removal", async () => {
    requestFindUnique.mockResolvedValue(requestRow({ status: "approved", arrId: 42 }));
    radarrGetQueueDetails.mockResolvedValue({ records: [] });
    requestUpdateMany.mockResolvedValue({ count: 1 });
    requestFindUniqueOrThrow.mockResolvedValue(requestRow({ status: "cancelled" }));

    const { cancelRequest } = await import("@/lib/services/admin");
    await cancelRequest({ requestId: "r1", adminId: "a1", adminName: "Admin" });

    expect(radarrGetQueueDetails).toHaveBeenCalledTimes(1);
    expect(requestUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "r1", status: { notIn: ["cancelled", "denied", "available"] } },
      }),
    );
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("rejects immediately on an already-terminal request, without touching the arr queue", async () => {
    requestFindUnique.mockResolvedValue(requestRow({ status: "cancelled" }));

    const { cancelRequest, RequestConflictError } = await import("@/lib/services/admin");
    await expect(
      cancelRequest({ requestId: "r1", adminId: "a1", adminName: "Admin" }),
    ).rejects.toBeInstanceOf(RequestConflictError);

    expect(radarrGetQueueDetails).not.toHaveBeenCalled();
    expect(requestUpdateMany).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("rejects when a genuine concurrent update beats it to the final write", async () => {
    // Early check sees a non-terminal state, but by the time the guarded
    // write runs, another process has already moved it to a terminal one.
    requestFindUnique
      .mockResolvedValueOnce(requestRow({ status: "approved" })) // early check
      .mockResolvedValueOnce(requestRow({ status: "denied" })); // conflict lookup
    requestUpdateMany.mockResolvedValue({ count: 0 });

    const { cancelRequest, RequestConflictError } = await import("@/lib/services/admin");
    await expect(
      cancelRequest({ requestId: "r1", adminId: "a1", adminName: "Admin" }),
    ).rejects.toBeInstanceOf(RequestConflictError);
    expect(notify).not.toHaveBeenCalled();
  });
});
