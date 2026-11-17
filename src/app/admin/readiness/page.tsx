"use client";

import { useApi } from "@/lib/use-api";
import type { CheckGroup, CheckStatus, ReadinessReport } from "@/lib/readiness";

const GROUPS: CheckGroup[] = ["Security", "Backups", "Services", "Pipeline", "Books"];

const STATUS: Record<CheckStatus, { label: string; color: string; icon: string }> = {
  ok: { label: "OK", color: "var(--success)", icon: "✓" },
  warn: { label: "Warning", color: "var(--warning)", icon: "!" },
  fail: { label: "Problem", color: "var(--danger)", icon: "✕" },
};

function Badge({ status }: { status: CheckStatus }) {
  const s = STATUS[status];
  return (
    <span
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
      style={{ background: s.color, color: status === "warn" ? "#000" : "#fff" }}
      aria-label={s.label}
      title={s.label}
    >
      {s.icon}
    </span>
  );
}

export default function ReadinessPage() {
  const { data, error, isLoading, mutate } = useApi<ReadinessReport>("/api/admin/readiness");

  const counts = data
    ? (["fail", "warn", "ok"] as CheckStatus[]).map((s) => [s, data.checks.filter((c) => c.status === s).length] as const)
    : [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Readiness</h1>
          <p className="text-sm text-[var(--muted)]">
            Is Lexarr safe and working? Read-only checks, refreshed every minute.
          </p>
        </div>
        <button
          onClick={() => mutate()}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--card-hover)]"
        >
          Refresh
        </button>
      </div>

      {isLoading && <p className="text-[var(--muted)]">Running checks…</p>}
      {error && <p style={{ color: "var(--danger)" }}>Couldn&apos;t load the readiness report.</p>}

      {data && (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <Badge status={data.status} />
            <span className="font-semibold">
              {data.status === "ok" ? "All checks pass" : data.status === "warn" ? "Working, with warnings" : "Needs attention"}
            </span>
            <span className="text-sm text-[var(--muted)]">
              {counts.map(([s, n]) => `${n} ${STATUS[s].label.toLowerCase()}`).join(" · ")}
            </span>
            <span className="ml-auto text-xs text-[var(--muted)]">
              {new Date(data.generatedAt).toLocaleTimeString()}
            </span>
          </div>

          {GROUPS.map((group) => {
            const checks = data.checks.filter((c) => c.group === group);
            if (!checks.length) return null;
            return (
              <section key={group} className="mb-6">
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">{group}</h2>
                <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--card)]">
                  {checks.map((c) => (
                    <li key={c.id} className="flex gap-3 p-3" data-check={c.id} data-status={c.status}>
                      <Badge status={c.status} />
                      <div className="min-w-0">
                        <p className="font-medium">{c.label}</p>
                        <p className="text-sm text-[var(--muted)]">{c.detail}</p>
                        {c.status !== "ok" && c.fix && <p className="mt-1 text-sm">→ {c.fix}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
