/**
 * Pick a sane default quality profile from an *arr's profile list.
 *
 * The previous behaviour — `profiles[0]?.id` — returns whichever
 * profile the *arr's API happened to sort first. For Radarr + Sonarr
 * that's profile id=1 named "Any", which allows CAM, WORKPRINT,
 * Remux-2160p, and everything in between. A user clicking Request
 * without picking quality in DetailPanel would silently get that,
 * blowing any size caps the admin had carefully set on other
 * profiles.
 *
 * This helper preferentially returns a capped, WEB-friendly profile,
 * falling through a list of regex patterns by priority. Last resort
 * is "any profile NOT named 'Any'". Only if every profile is called
 * "Any" (pathological) do we return profiles[0].
 */

interface NamedProfile {
  id: number;
  name: string;
}

/**
 * @param profiles — the list returned by the *arr's /qualityprofile endpoint
 * @param preferred — regexes to try in priority order. First match wins.
 */
export function pickDefaultProfile<T extends NamedProfile>(
  profiles: T[],
  preferred: RegExp[],
): T | undefined {
  if (profiles.length === 0) return undefined;
  for (const pattern of preferred) {
    const match = profiles.find((p) => pattern.test(p.name));
    if (match) return match;
  }
  // Last resort: first profile whose name isn't "Any" (the catch-all).
  return profiles.find((p) => !/^any$/i.test(p.name)) ?? profiles[0];
}

/**
 * Sensible defaults for each *arr. Order matters — first-match wins.
 * Admins can still override by selecting a profile explicitly in
 * DetailPanel; these only apply when the caller passes no profile id.
 */

/** Radarr: prefer HD Bluray + WEB, then any WEB 1080p profile. */
export const RADARR_DEFAULT_PATTERNS: RegExp[] = [
  /^HD Bluray \+ WEB$/i,
  /WEB.*1080p/i,
  /1080p/i,
];

/** Sonarr: same naming conventions as Radarr in most setups. */
export const SONARR_DEFAULT_PATTERNS: RegExp[] = [
  /^HD Bluray \+ WEB$/i,
  /WEB.*1080p/i,
  /1080p/i,
];

/**
 * Lidarr: music uses different profile names (Lossless / Standard /
 * High / Trash etc). "Standard" or "High" are the common non-Any
 * defaults. Fall through to anything not-Any.
 */
export const LIDARR_DEFAULT_PATTERNS: RegExp[] = [
  /^standard$/i,
  /^high$/i,
  /lossless/i,
];
