/**
 * Plain-English reasons for failed requests.
 *
 * Errors from the *arr clients look like "LazyLibrarian /api?cmd=addBook&...:
 * 500 <!DOCTYPE html ...>" and database errors like "Invalid
 * `prisma.request.update()` invocation: ...". Shown to users as a request's
 * reason, they leak internal addresses and server internals and explain
 * nothing. This turns them into a short sentence; the raw text stays in the
 * server log and the admin's pipeline events.
 *
 * Applied when a reason is saved (status checker, request service) and again
 * when a non-admin reads one (/api/requests, the event timeline), so reasons
 * stored before this existed are cleaned up too.
 */

const SERVICES = "Radarr|Sonarr|Lidarr|LazyLibrarian|Prowlarr|Jellyfin|Bazarr|qBittorrent|NZBGet";
const ARR_ERROR = new RegExp(`^(${SERVICES}) \\S*: (\\d{3}|network)\\b`);
const DB_ERROR = /prisma|invocation:|Operations timed out|SQLITE_|database is locked/i;
const MAX_LENGTH = 200;

function fromArrError(service: string, status: string): string {
  if (status === "network") return `${service} isn't reachable right now. Lexarr will try again.`;
  const code = Number(status);
  if (service === "LazyLibrarian" && code >= 500) {
    return "LazyLibrarian couldn't look this book up. An admin can retry it.";
  }
  if (code >= 500) return `${service} had an internal error with this request. An admin can retry it.`;
  if (code === 404) return `${service} couldn't find this title.`;
  if (code === 401 || code === 403) return `Lexarr couldn't sign in to ${service}. An admin needs to check its settings.`;
  return `${service} rejected this request. An admin can check it.`;
}

/** A short, safe reason for users, or the input unchanged if empty. */
export function userFacingError<T extends string | null | undefined>(raw: T): T | string {
  if (!raw) return raw;
  const text = raw.trim();

  // "Check failed: <error>" and "Stall check failed: <error>" wrap another error.
  const wrapped = /^((?:Stall )?[Cc]heck failed): ([\s\S]*)$/.exec(text);
  if (wrapped) return `Couldn't check this request's status: ${lowerFirst(userFacingError(wrapped[2]) as string)}`;

  const arr = ARR_ERROR.exec(text);
  if (arr) return fromArrError(arr[1], arr[2]);
  if (DB_ERROR.test(text)) return "Lexarr hit a database error with this request. It will try again.";

  // Anything else is already a written reason ("Not on TheTVDB yet, ..."):
  // just make sure no markup or internal address rides along.
  const cleaned = text
    .replace(/<[^>]*>/g, " ")
    .replace(/\bhttps?:\/\/\S+/g, "")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "")
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > MAX_LENGTH ? `${cleaned.slice(0, MAX_LENGTH - 1)}…` : cleaned;
}

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}
