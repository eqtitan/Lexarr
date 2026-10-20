import { arrFetch, ArrApiError } from "./_fetch";
import { log } from "@/lib/log";
import { env } from "@/lib/env";
import { getBreaker } from "./circuit-breaker";

const base = () => env().NZBGET_URL!;
const username = () => env().NZBGET_USER!;
const password = () => env().NZBGET_PASS!;

// NZBGet always returns HTTP 200, even for method errors -- arrFetch sees
// only the transport status, so it calls recordSuccess() on every call
// regardless of the RPC body. That resets the breaker's own failure
// counter before rpc() below even looks at the body, so recordFailure()
// alone could never accumulate past 1. Track consecutive app-level
// errors here instead, and force the breaker open once they match the
// same threshold every other integration trips at.
const APP_ERROR_THRESHOLD = 5;
let consecutiveAppErrors = 0;

/** Test-only: reset the consecutive-app-error counter between cases. */
export function _resetAppErrorCount(): void {
  consecutiveAppErrors = 0;
}

async function rpc(method: string, params: unknown[] = []) {
  const data = await arrFetch<{ result?: unknown; error?: { message: string } }>(
    "NZBGet",
    base(),
    "/jsonrpc",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${username()}:${password()}`).toString("base64")}`,
      },
      body: JSON.stringify({ version: "1.1", method, params }),
    },
  );
  // NZBGet returns 200 OK even for method errors — inspect the body.
  if (data && typeof data === "object" && "error" in data && data.error) {
    const err = new ArrApiError("NZBGet", `/jsonrpc#${method}`, 200, data.error.message);
    consecutiveAppErrors++;
    if (consecutiveAppErrors >= APP_ERROR_THRESHOLD) {
      getBreaker("NZBGet").forceOpen(err);
    }
    throw err;
  }
  consecutiveAppErrors = 0;
  return data?.result;
}

export async function addNzbFromUrl(
  nzbUrl: string,
  category: string = "default",
): Promise<number> {
  // NZBGet append params: NZBFilename, NZBContent (base64 or URL), Category, Priority, AddToTop, AddPaused, DupeKey, DupeScore, DupeMode, Parameters
  // For URL: fetch the NZB first, then send base64
  const nzbRes = await fetch(nzbUrl);
  if (!nzbRes.ok) throw new Error(`Failed to fetch NZB: ${nzbRes.status}`);
  const nzbBuffer = await nzbRes.arrayBuffer();
  const nzbBase64 = Buffer.from(nzbBuffer).toString("base64");
  const fileName = nzbUrl.split("/").pop()?.split("?")[0] || "download.nzb";
  return (await rpc("append", [
    fileName,
    nzbBase64,
    category,
    0,
    false,
    false,
    "",
    0,
    "SCORE",
    [],
  ])) as number;
}

export async function health(): Promise<boolean> {
  try {
    await rpc("version");
    return true;
  } catch (err) {
    log.debug("nzbget: health check failed", { err });
    return false;
  }
}
