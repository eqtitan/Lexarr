import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import * as radarr from "@/lib/arr/radarr";
import * as sonarr from "@/lib/arr/sonarr";
import * as lidarr from "@/lib/arr/lidarr";
import * as lazylibrarian from "@/lib/arr/lazylibrarian";

async function checkService(name: string, healthFn: () => Promise<any>) {
  try {
    await healthFn();
    return { name, healthy: true };
  } catch (err: any) {
    return { name, healthy: false, error: err.message };
  }
}

export async function GET() {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const services = await Promise.all([
    checkService("Radarr", radarr.health),
    checkService("Sonarr", sonarr.health),
    checkService("Lidarr", lidarr.health),
    checkService("LazyLibrarian", lazylibrarian.health),
  ]);

  return NextResponse.json({ services });
}
