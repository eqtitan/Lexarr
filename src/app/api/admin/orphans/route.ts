import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { listOrphans } from "@/lib/arr/orphans";
import { deleteTorrent } from "@/lib/arr/qbittorrent";
import { logAudit } from "@/lib/audit";

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const orphans = await listOrphans();
  return NextResponse.json({ orphans });
}

interface DeleteBody {
  hash?: string;
  deleteFiles?: boolean;
  folderName?: string;
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  const adminId = session?.user?.id;
  if (session?.user?.role !== "admin" || !adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as DeleteBody | null;
  if (!body || typeof body.hash !== "string" || !body.hash) {
    return NextResponse.json(
      { error: "Expected { hash: string, deleteFiles?: boolean, folderName?: string }" },
      { status: 400 },
    );
  }

  const { hash, deleteFiles = false, folderName } = body;

  try {
    await deleteTorrent(hash, deleteFiles);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `qBittorrent rejected the delete: ${msg}` },
      { status: 502 },
    );
  }

  logAudit(
    adminId,
    "remove_orphan",
    { type: "torrent", id: hash },
    { deleteFiles, folderName: folderName ?? hash },
  );

  return NextResponse.json({ removed: true, hash, deleteFiles });
}
