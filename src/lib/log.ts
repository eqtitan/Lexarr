/**
 * Structured JSON logger (P-04).
 *
 * No external dependencies — uses node's built-in AsyncLocalStorage for
 * request-scoped correlation. One JSON line per log event, serialized so
 * structured log consumers (jq, log shippers, Loki) can parse stdout
 * directly.
 *
 * Usage:
 *   import { log } from "@/lib/log";
 *   log.error("failed to submit", { arrId: 42, err });
 *
 * For a request-scoped child logger that carries requestId/userId on
 * every call, wrap the handler body in `withRequestScope(requestId, fn)`
 * and use `log` normally inside — the scope is inherited across awaits
 * via AsyncLocalStorage.
 *
 * Why not pino/bunyan/winston? Zero dep, ~80 lines, no bundle-size cost,
 * no transport config surface. If we outgrow this, pino is the upgrade
 * path — same JSON-line shape.
 */
import { AsyncLocalStorage } from "node:async_hooks";

type Level = "debug" | "info" | "warn" | "error";

interface LogScope {
  requestId?: string;
  userId?: string;
  route?: string;
  [key: string]: unknown;
}

const scopeStorage = new AsyncLocalStorage<LogScope>();

/**
 * Run `fn` with `scope` attached to every log call made inside it (across
 * awaits). Nested scopes merge — inner keys override outer.
 */
export function withLogScope<T>(scope: LogScope, fn: () => Promise<T> | T): Promise<T> | T {
  const parent = scopeStorage.getStore() ?? {};
  return scopeStorage.run({ ...parent, ...scope }, fn);
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      // Skip full stack in prod to keep lines scannable; keep it in dev.
      ...(process.env.NODE_ENV !== "production" && err.stack
        ? { stack: err.stack.split("\n").slice(0, 6).join("\n") }
        : {}),
    };
  }
  return { message: String(err) };
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  // In tests, silence debug+info to keep vitest output clean. errors/warns
  // still flow so a genuine failure is still visible.
  if (
    process.env.NODE_ENV === "test" &&
    (level === "debug" || level === "info")
  ) {
    return;
  }

  const scope = scopeStorage.getStore() ?? {};
  const line: Record<string, unknown> = {
    t: new Date().toISOString(),
    lvl: level,
    msg,
    ...scope,
  };

  if (fields) {
    // Normalize any `err` field through serializeError for consistent shape.
    for (const [k, v] of Object.entries(fields)) {
      line[k] = k === "err" ? serializeError(v) : v;
    }
  }

  const writer = level === "error" || level === "warn" ? console.error : console.log;
  try {
    writer(JSON.stringify(line));
  } catch {
    // Fallback if a field isn't serializable (circular ref, BigInt, etc.)
    writer(
      JSON.stringify({
        t: line.t,
        lvl: level,
        msg,
        _serializeFailed: true,
      }),
    );
  }
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};

/**
 * Generate a short request id. Not cryptographically unique — just enough
 * to correlate logs for a single request within a reasonable time window.
 */
export function newRequestId(): string {
  return Math.random().toString(36).slice(2, 10);
}
