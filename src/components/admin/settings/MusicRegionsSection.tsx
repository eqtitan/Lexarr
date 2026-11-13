"use client";

import { useEffect, useState } from "react";
import { apiSend, failure, useApi } from "@/lib/use-api";

interface RegionsResponse {
  regions: string[];
  supported: { code: string; label: string }[];
}

/** Music search region filter (saved, not yet applied -- see the copy). */
export default function MusicRegionsSection() {
  const { data, error, mutate } = useApi<RegionsResponse>("/api/admin/settings/music");
  const [regions, setRegions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Start editing from what's saved whenever it (re)loads.
  useEffect(() => {
    if (data) setRegions(data.regions);
  }, [data]);

  const saved = data?.regions ?? [];
  const dirty = regions.length !== saved.length || regions.some((r) => !saved.includes(r));

  function toggle(code: string) {
    setRegions((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
    setSaveMsg(null);
  }

  async function save() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await apiSend<{ regions: string[] }>("/api/admin/settings/music", "PUT", { regions });
      await mutate((d) => d && { ...d, regions: res.regions }, { revalidate: false });
      setSaveMsg("Saved");
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (err) {
      setSaveMsg(failure("Save", err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">
          Music Search Regions
          <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] ring-1 ring-[var(--border)]">
            preview
          </span>
        </h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Intended to filter MusicBrainz results by release country. Selections are saved but not
          yet active — MusicBrainz&apos;s release-group search index doesn&apos;t expose a country
          field, so a post-fetch artist-country filter is planned for a later release. Your choices
          persist for when it lands.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-[var(--danger)]">Couldn&apos;t load regions — {error.message}</p>
      ) : !data ? (
        <p className="text-sm text-[var(--muted)]">Loading regions…</p>
      ) : (
        <div className="rounded-xl p-4 ring-1 ring-[var(--border)] space-y-3" style={{ background: "var(--card)" }}>
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {data.supported.map((r) => {
              const on = regions.includes(r.code);
              return (
                <button
                  key={r.code}
                  type="button"
                  onClick={() => toggle(r.code)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ring-1 transition-colors"
                  style={{
                    background: on ? "rgba(99,102,241,0.12)" : "var(--background)",
                    borderColor: on ? "var(--accent)" : "var(--border)",
                    color: "var(--foreground)",
                  }}
                >
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
                    style={{
                      borderColor: on ? "var(--accent)" : "var(--border)",
                      background: on ? "var(--accent)" : "transparent",
                    }}
                    aria-hidden="true"
                  >
                    {on && (
                      <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  <span className="flex-1">
                    <span className="font-medium">{r.code}</span>
                    <span className="ml-1.5 text-xs text-[var(--muted)]">{r.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-[var(--muted)]">
              {regions.length === 0
                ? "No filter — all regions included"
                : `${regions.length} region${regions.length === 1 ? "" : "s"} selected`}
            </p>
            <div className="flex items-center gap-2">
              {saveMsg && (
                <span
                  className={`text-xs font-medium ${saveMsg === "Saved" ? "text-[var(--success)]" : "text-[var(--danger)]"}`}
                >
                  {saveMsg}
                </span>
              )}
              <button
                onClick={save}
                disabled={!dirty || saving}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "var(--accent)" }}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
