/**
 * Single source of truth for "is this request stuck, and how urgently."
 *
 * Before this file existed, "stuck" was answered independently in three
 * places with no shared definition: status-checker.ts's three escalation
 * tiers (each with its own Prisma `where` clause and hardcoded hour
 * constant), warnings.ts's dashboard rules (its own copy of the same
 * conditions, plus its own copy of the "is this unreleased, not actually
 * stuck" string-matching), and WarningsPanel.tsx's action mapping (a third
 * copy, matching on `warning.title.startsWith(...)`). A request could fall
 * through all three tiers' preconditions at once -- exactly what happened
 * to a request that had `arrId` set but kept throwing on every status
 * check: it matched none of them and sat silently stuck for months.
 *
 * Each `RuleKind` below pairs a status-checker.ts auto-escalation tier
 * (which *acts* on a stuck request once `escalateThresholdMs` has passed)
 * with a warnings.ts dashboard rule (which *tells an admin* once the
 * earlier `warnThresholdMs` has passed) -- so the two can never silently
 * disagree about what "stuck" means or drift out of sync the way the
 * three separate copies did.
 */

export type RuleKind =
  | "never-dispatched" // Tier A: approved, arrId still null
  | "check-failing" // Tier D: arrId set, but the status check keeps throwing
  | "no-sources-found" // Tier B: downloading, nothing found in the *arr queue
  | "stalled-too-long"; // Tier C: status already stalled

export interface PipelineRule {
  kind: RuleKind;
  severity: "critical" | "warning";
  /** Dashboard warning title prefix (warnings.ts / WarningsPanel.tsx). */
  titlePrefix: string;
  /** How old the condition must be before the dashboard shows a warning. */
  warnThresholdMs: number;
  /** How old it must be before status-checker.ts actually acts on it. */
  escalateThresholdMs: number;
}

export const PIPELINE_RULES: { [K in RuleKind]: PipelineRule } = {
  "never-dispatched": {
    kind: "never-dispatched",
    severity: "critical",
    titlePrefix: "Failed to route",
    warnThresholdMs: 60 * 60 * 1000,
    escalateThresholdMs: 60 * 60 * 1000,
  },
  "check-failing": {
    kind: "check-failing",
    severity: "critical",
    titlePrefix: "Can't verify",
    warnThresholdMs: 30 * 60 * 1000,
    escalateThresholdMs: 2 * 60 * 60 * 1000,
  },
  "no-sources-found": {
    kind: "no-sources-found",
    severity: "warning",
    titlePrefix: "Stuck download",
    warnThresholdMs: 2 * 60 * 60 * 1000,
    escalateThresholdMs: 12 * 60 * 60 * 1000,
  },
  "stalled-too-long": {
    kind: "stalled-too-long",
    severity: "warning",
    titlePrefix: "Stalled",
    // No dashboard delay -- once status-checker.ts has already moved a
    // request to "stalled" (Tier B's own 12h floor), the admin should see
    // it immediately. escalateThresholdMs below is Tier C's separate
    // "how long stalled before auto-failing" cutoff.
    warnThresholdMs: 0,
    escalateThresholdMs: 48 * 60 * 60 * 1000,
  },
};

/**
 * True when `lastError` is one of the exact strings
 * status-checker.ts's movie-unreleased block writes (the only call sites
 * that ever set this) -- an "approved" request parked there on purpose,
 * not stuck. Matching on them is precise, not a guess.
 */
/** Written for a movie showing in theaters with no home-release date yet. */
export const IN_THEATERS_MESSAGE = "In theaters — waiting for digital release";

export const UNRELEASED_ERROR_PREFIXES = ["Awaiting release:", "Not yet released", IN_THEATERS_MESSAGE] as const;

export function isUnreleased(lastError: string | null | undefined): boolean {
  if (!lastError) return false;
  return UNRELEASED_ERROR_PREFIXES.some((prefix) => lastError.startsWith(prefix));
}
