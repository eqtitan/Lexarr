import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getUpdateStatus } from "@/lib/update-check";

// GET: is a newer Lexarr release available? (admin only; cached 24h)
export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  return NextResponse.json(await getUpdateStatus());
}
