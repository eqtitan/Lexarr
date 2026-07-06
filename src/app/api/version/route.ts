import { NextResponse } from "next/server";
import { getBuildInfo } from "@/lib/build-info";

/**
 * Reports the running app's version + build provenance.
 *
 * Non-sensitive (version string, git SHA, build timestamp) — no auth
 * required, same posture as `/api/healthz`. Exists so anyone deploying or
 * debugging Lexarr can confirm exactly what's running in a given container
 * without SSHing in and inspecting image tags.
 */
export async function GET() {
  return NextResponse.json(getBuildInfo());
}
