"use client";

import { useEffect, useState } from "react";
import type { ServiceHealthDTO } from "@/types/dashboard";

/** Matches the shape from src/lib/arr/circuit-breaker.ts snapshotAllBreakers(). */
interface BreakerSnapshot {
  service: string;
  state: "closed" | "open" | "half_open";
  failures: number;
  lastFailureAt: string | null;
  retryAt: string | null;
  lastError: string | null;
}

interface DiagnoseModalProps {
  service: ServiceHealthDTO | null;
  onClose: () => void;
}

function stateLabel(state: BreakerSnapshot["state"]): string {
  if (state === "open") return "Open — failing fast";
  if (state === "half_open") return "Half-open — probing";
  return "Closed — normal";
}

function stateColor(state: BreakerSnapshot["state"]): string {
  if (state === "open") return "var(--danger)";
  if (state === "half_open") return "var(--warning)";
  return "var(--success)";
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) {
    const future = Math.abs(diff);
    if (future < 60_000) return `in ${Math.ceil(future / 1000)}s`;
    return `in ${Math.ceil(future / 60_000)}m`;
  }
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleString();
}

/**
 * Read-only diagnostic view for a single service. Shows:
 *   - Current health-check result + last error
 *   - Circuit-breaker state (closed / open / half-open)
 *   - Retry time when breaker is open
 *   - Link to open the service UI directly (new tab)
 *
 * No container control. No manual trip / reset. Just information.
 */
export default function DiagnoseModal({ service, onClose }: DiagnoseModalProps) {
  const [breakers, setBreakers] = useState<BreakerSnapshot[] | null | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!service) return;
    setBreakers(undefined);
    let cancelled = false;
    fetch("/api/admin/arr-breakers")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => {
        if (!cancelled) setBreakers(d.breakers ?? []);
      })
      .catch(() => {
        if (!cancelled) setBreakers(null);
      });
    return () => {
      cancelled = true;
    };
  }, [service]);

  useEffect(() => {
    if (!service) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [service, onClose]);

  if (!service) return null;

  const breaker = (breakers || []).find((b) => b.service === service.name) ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="diagnose-title"
    >
      <div
        className="my-8 w-full max-w-xl overflow-hidden rounded-2xl bg-[var(--card)] ring-1 ring-[var(--border)] shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  background: service.healthy
                    ? "var(--success)"
                    : "var(--danger)",
                  boxShadow: service.healthy
                    ? "0 0 6px var(--success)"
                    : "0 0 6px var(--danger)",
                }}
              />
              <h2 id="diagnose-title" className="text-lg font-bold">
                {service.name}
              </h2>
              {service.category && (
                <span className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--muted)] ring-1 ring-[var(--border)]">
                  {service.category}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {service.healthy
                ? "Responding to health checks"
                : "Health check is failing"}
              {service.responseMs > 0 && ` · ${service.responseMs}ms`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--foreground)]"
            aria-label="Close"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Last error from health check */}
          {service.error && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
                Last Error
              </h3>
              <pre className="mt-1.5 whitespace-pre-wrap break-words rounded-lg bg-[var(--background)] p-3 font-mono text-[11px] leading-relaxed text-[var(--danger)]">
                {service.error}
              </pre>
            </div>
          )}

          {/* Circuit breaker */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
              Circuit Breaker
            </h3>
            {breakers === undefined ? (
              <p className="mt-1.5 text-xs text-[var(--muted)]">Loading…</p>
            ) : breakers === null ? (
              <p className="mt-1.5 text-xs text-[var(--danger)]">
                Couldn&apos;t load breaker state.
              </p>
            ) : !breaker ? (
              <p className="mt-1.5 text-xs text-[var(--muted)]">
                No requests have been made to this service yet in this process —
                no breaker state recorded.
              </p>
            ) : (
              <div className="mt-1.5 space-y-1 rounded-lg bg-[var(--background)] p-3 text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex h-2 w-2 rounded-full"
                    style={{ background: stateColor(breaker.state) }}
                  />
                  <span
                    className="font-medium"
                    style={{ color: stateColor(breaker.state) }}
                  >
                    {stateLabel(breaker.state)}
                  </span>
                </div>
                <div className="ml-4 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[11px] text-[var(--muted)]">
                  <span>Failures (window):</span>
                  <span className="tabular-nums text-[var(--foreground)]">
                    {breaker.failures}
                  </span>
                  {breaker.lastFailureAt && (
                    <>
                      <span>Last failure:</span>
                      <span
                        className="text-[var(--foreground)]"
                        title={new Date(breaker.lastFailureAt).toLocaleString()}
                      >
                        {formatWhen(breaker.lastFailureAt)}
                      </span>
                    </>
                  )}
                  {breaker.retryAt && (
                    <>
                      <span>Next probe:</span>
                      <span
                        className="text-[var(--foreground)]"
                        title={new Date(breaker.retryAt).toLocaleString()}
                      >
                        {formatWhen(breaker.retryAt)}
                      </span>
                    </>
                  )}
                  {breaker.lastError && (
                    <>
                      <span>Breaker err:</span>
                      <span className="truncate text-[var(--foreground)]" title={breaker.lastError}>
                        {breaker.lastError.slice(0, 120)}
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Open service in new tab */}
          {service.url && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--background)] p-3">
              <code className="truncate text-xs text-[var(--muted)]">
                {service.url}
              </code>
              <a
                href={service.url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                style={{ background: "var(--accent)" }}
              >
                Open ↗
              </a>
            </div>
          )}

          <p className="text-[10px] text-[var(--muted)]">
            Diagnose is read-only. To restart a container or change its config,
            use the Unraid dashboard directly.
          </p>
        </div>
      </div>
    </div>
  );
}
