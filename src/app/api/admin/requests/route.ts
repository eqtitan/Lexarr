import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  listPendingRequests,
  approveRequest,
  denyRequest,
  cancelRequest,
  RequestConflictError,
} from "@/lib/services/admin";

// GET: List pending requests
export async function GET() {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { requests } = await listPendingRequests();
  return NextResponse.json({ requests });
}

// PATCH: Approve or deny a request
export async function PATCH(req: NextRequest) {
  const session = await auth();
  const role = session?.user?.role;
  const adminId = session?.user?.id;
  if (!session || role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { requestId, action, note } = await req.json();
  if (!requestId || !["approve", "deny"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const adminName = session.user?.name || "Admin";

  try {
    if (action === "deny") {
      const { request } = await denyRequest({
        requestId,
        note,
        adminId,
        adminName,
      });
      return NextResponse.json({ request });
    }

    const { request, arrError } = await approveRequest({
      requestId,
      note,
      adminId,
      adminName,
    });

    if (arrError) {
      return NextResponse.json({ request, arrError });
    }

    return NextResponse.json({ request });
  } catch (err: unknown) {
    if (err instanceof RequestConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}

// DELETE: Cancel a request
export async function DELETE(req: NextRequest) {
  const session = await auth();
  const role = session?.user?.role;
  const adminId = session?.user?.id;
  if (!session || role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { requestId, note } = await req.json();
  if (!requestId) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const adminName = session.user?.name || "Admin";

  try {
    const { request } = await cancelRequest({
      requestId,
      note,
      adminId,
      adminName,
    });

    return NextResponse.json({ request });
  } catch (err: unknown) {
    if (err instanceof RequestConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
