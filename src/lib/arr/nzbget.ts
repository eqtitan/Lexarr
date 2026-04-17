import { arrFetch, ArrApiError } from "./_fetch";

const BASE = process.env.NZBGET_URL!;
const USER = process.env.NZBGET_USER!;
const PASS = process.env.NZBGET_PASS!;

async function rpc(method: string, params: unknown[] = []) {
  const data = await arrFetch<{ result?: unknown; error?: { message: string } }>(
    "NZBGet",
    BASE,
    "/jsonrpc",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${USER}:${PASS}`).toString("base64")}`,
      },
      body: JSON.stringify({ version: "1.1", method, params }),
    },
  );
  // NZBGet returns 200 OK even for method errors — inspect the body.
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new ArrApiError("NZBGet", `/jsonrpc#${method}`, 200, data.error.message);
  }
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
  } catch {
    return false;
  }
}
