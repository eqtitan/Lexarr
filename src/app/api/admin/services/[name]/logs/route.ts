/**
 * GET /api/admin/services/:name/logs (M2-01)
 *
 * Admin-only. Returns container status + last 50 log lines for the named
 * service. `name` is validated against SERVICE_REGISTRY to prevent path
 * injection — anything else returns 404.
 *
 * Query: `?refresh=1` requests a live SSH refresh (only honored if
 * STACK_HEALTH_SSH_* env is configured; otherwise falls through to the
 * cached snapshot).
 *
 * Response shape: ContainerStatusDTO | { error }. The DTO's
 * `refreshAvailable` field tells the client whether to render the
 * "Refresh now" button — env values themselves never leave the server.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { SERVICE_REGISTRY } from "@/lib/dashboard/services";
import { getStatus, isSshRefreshConfigured } from "@/lib/arr/container-status";
import { log } from "@/lib/log";

function findService(name: string) {
  return SERVICE_REGISTRY.find((s) => s.name === name);
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { name } = await ctx.params;
  const svc = findService(name);
  if (!svc) {
    return NextResponse.json(
      { error: "Unknown service" },
      { status: 404 },
    );
  }

  // The container name on the host is lower-cased by convention (see M2-02);
  // the registry name is the operator-facing label ("Radarr"). The status
  // helper expects the docker container name.
  const containerName = svc.unraidContainerName ?? svc.name.toLowerCase();
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";

  try {
    const status = await getStatus(containerName, { refresh });
    if (!status) {
      // No cron file and either no SSH or SSH failed. Return a structured
      // empty DTO rather than 404 so the client can render "no data" gracefully.
      return NextResponse.json({
        name: svc.name,
        status: null,
        startedAt: null,
        uptime: null,
        logs: [],
        asOf: null,
        source: null,
        refreshAvailable: isSshRefreshConfigured(),
      });
    }
    // Re-label with the operator-facing service name (the helper echoes the
    // container name, but the modal shows the registry name).
    return NextResponse.json({ ...status, name: svc.name });
  } catch (err) {
    log.error("services-logs: getStatus threw", { name, refresh, err });
    return NextResponse.json(
      { error: "Failed to read container status" },
      { status: 500 },
    );
  }
}
