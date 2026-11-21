"use client";

import { useState } from "react";
import { mutate as globalMutate } from "swr";
import { apiSend, failure, useApi } from "@/lib/use-api";

interface UpdateSetting {
  enabled: boolean;
  lockedByEnv: boolean;
}

/** Opt-in switch for the "update available" notice (see src/lib/update-check.ts). */
export default function UpdateNoticeSection() {
  const { data, error, mutate } = useApi<UpdateSetting>("/api/admin/settings/updates");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setSaving(true);
    setMsg(null);
    try {
      const res = await apiSend<UpdateSetting>("/api/admin/settings/updates", "PUT", { enabled: next });
      await mutate({ enabled: res.enabled, lockedByEnv: res.lockedByEnv }, { revalidate: false });
      // Refresh the nav badge straight away.
      await globalMutate("/api/admin/update-check");
      setMsg("Saved");
      setTimeout(() => setMsg(null), 3000);
    } catch (err) {
      setMsg(failure("Save", err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Update notices</h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Show admins an &ldquo;Update&rdquo; badge when a newer Lexarr release is published. When on,
          Lexarr asks GitHub for the latest release once a day. It sends nothing about your install.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-[var(--danger)]">Couldn&apos;t load this setting — {error.message}</p>
      ) : !data ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : (
        <div
          className="flex items-center justify-between gap-3 rounded-xl p-4 ring-1 ring-[var(--border)]"
          style={{ background: "var(--card)" }}
        >
          <label htmlFor="update-notices" className="text-sm">
            <span className="font-medium">Check GitHub for new releases</span>
            {data.lockedByEnv && (
              <span className="mt-0.5 block text-xs text-[var(--muted)]">
                Turned off by <code>LEXARR_UPDATE_CHECK=false</code> on this server. Remove it to use this switch.
              </span>
            )}
          </label>
          <div className="flex items-center gap-2">
            {msg && (
              <span className={`text-xs font-medium ${msg === "Saved" ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                {msg}
              </span>
            )}
            <input
              id="update-notices"
              type="checkbox"
              role="switch"
              className="h-5 w-5 accent-[var(--accent)]"
              checked={data.enabled && !data.lockedByEnv}
              disabled={saving || data.lockedByEnv}
              onChange={(e) => void toggle(e.target.checked)}
            />
          </div>
        </div>
      )}
    </section>
  );
}
