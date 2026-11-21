/**
 * "Is a newer Lexarr out?" -- the admin-only update notice.
 *
 * Asks GitHub for the latest published release at most once a day (a failed
 * lookup is retried after an hour) and compares it to the running version.
 * Nothing about the install is sent. Set LEXARR_UPDATE_CHECK=false to turn it
 * off (air-gapped hosts); the status then reports `enabled: false` and no
 * request is made.
 */
import { updateCheckCache } from "@/lib/cache";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { APP_VERSION } from "@/lib/version";

const REPO = "eqtitan/Lexarr";
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
const CACHE_KEY = "latest-release";
const FAILURE_TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 5_000;

export interface UpdateStatus {
  /** False when LEXARR_UPDATE_CHECK=false; nothing else is meaningful then. */
  enabled: boolean;
  current: string;
  /** Latest published release, without the leading "v"; null if unknown. */
  latest: string | null;
  updateAvailable: boolean;
  /** Release notes page for `latest` (or the releases list). */
  url: string;
  /** ISO time of the lookup that produced this; null when disabled. */
  checkedAt: string | null;
}

/**
 * Compare two SemVer strings: negative if a < b, 0 if equal, positive if
 * a > b. Pre-release versions sort below their release (1.0.0-rc.1 < 1.0.0).
 * Build metadata is ignored. Returns null for anything that isn't SemVer.
 */
export function compareVersions(a: string, b: string): number | null {
  const parse = (v: string) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
    return m ? { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4]?.split(".") ?? [] } : null;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] - pb.core[i];
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) - Number(y);
    if (xn) return -1;
    if (yn) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function unknownStatus(): UpdateStatus {
  return {
    enabled: true,
    current: APP_VERSION,
    latest: null,
    updateAvailable: false,
    url: RELEASES_PAGE,
    checkedAt: new Date().toISOString(),
  };
}

async function lookup(): Promise<UpdateStatus | null> {
  try {
    const res = await fetch(LATEST_URL, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `Lexarr/${APP_VERSION}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      log.warn("update check: GitHub answered with an error", { status: res.status });
      return null;
    }
    const body: unknown = await res.json();
    const tag =
      body && typeof body === "object" && "tag_name" in body && typeof body.tag_name === "string"
        ? body.tag_name
        : null;
    const cmp = tag ? compareVersions(tag, APP_VERSION) : null;
    if (!tag || cmp === null) {
      log.warn("update check: unrecognised release tag", { tag });
      return null;
    }
    // Only ever link to this project's own releases, whatever the API says.
    const apiUrl =
      "html_url" in (body as object) && typeof (body as { html_url: unknown }).html_url === "string"
        ? (body as { html_url: string }).html_url
        : "";
    const url = apiUrl.startsWith(`${RELEASES_PAGE}/`) ? apiUrl : RELEASES_PAGE;
    return {
      enabled: true,
      current: APP_VERSION,
      latest: tag.replace(/^v/, ""),
      updateAvailable: cmp > 0,
      url,
      checkedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    log.warn("update check failed", { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** The current update status. Never throws; a failed lookup says "no update". */
export async function getUpdateStatus(): Promise<UpdateStatus> {
  if (env().LEXARR_UPDATE_CHECK === "false") {
    return { enabled: false, current: APP_VERSION, latest: null, updateAvailable: false, url: RELEASES_PAGE, checkedAt: null };
  }
  const cached = updateCheckCache.get(CACHE_KEY) as UpdateStatus | undefined;
  if (cached) return cached;
  const fresh = await lookup();
  if (fresh) {
    updateCheckCache.set(CACHE_KEY, fresh);
    return fresh;
  }
  const failed = unknownStatus();
  updateCheckCache.set(CACHE_KEY, failed, FAILURE_TTL_MS);
  return failed;
}
