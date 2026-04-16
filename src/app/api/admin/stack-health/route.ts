import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { readStackHealth } from "@/lib/stack-health";

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const report = await readStackHealth();
  if (!report) {
    return NextResponse.json({ report: null }, { status: 200 });
  }
  return NextResponse.json({ report });
}
