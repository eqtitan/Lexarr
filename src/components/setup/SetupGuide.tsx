"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import NotificationChannelsSection from "@/components/admin/settings/NotificationChannelsSection";
import UpdateNoticeSection from "@/components/admin/settings/UpdateNoticeSection";
import { apiSend, failure, useApi } from "@/lib/use-api";
import type { ReadinessReport, ReadinessCheck } from "@/lib/readiness";
import type { SetupInfo } from "@/lib/setup";

const STEPS = ["Welcome", "Connections", "Sign-in", "Notifications", "Webhooks", "Updates", "Done"] as const;

const card = "rounded-xl p-4 ring-1 ring-[var(--border)] space-y-3";
const btn = "rounded-lg px-4 py-2 text-sm font-medium transition-colors";

function StatusDot({ status }: { status: ReadinessCheck["status"] }) {
  const color = status === "ok" ? "var(--success)" : status === "warn" ? "#f59e0b" : "var(--danger)";
  return <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} aria-label={status} />;
}

function Connections() {
  const { data, error, isValidating, mutate } = useApi<ReadinessReport>("/api/admin/readiness");
  const services = data?.checks.filter((c) => c.group === "Services" && c.id !== "stack-health") ?? [];
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--muted)]">
        Lexarr hands requests to your Radarr, Sonarr and Lidarr (plus LazyLibrarian for books when you&apos;ve set it
        up). Here&apos;s whether it can reach them now.
      </p>
      <div className={card} style={{ background: "var(--card)" }}>
        {error ? (
          <p className="text-sm text-[var(--danger)]">Couldn&apos;t run the checks — {error.message}</p>
        ) : !data ? (
          <p className="text-sm text-[var(--muted)]">Checking your services…</p>
        ) : (
          <ul className="space-y-3">
            {services.map((c) => (
              <li key={c.id} className="flex gap-3">
                <StatusDot status={c.status} />
                <div className="text-sm">
                  <p className="font-medium">
                    {c.label} <span className="font-normal text-[var(--muted)]">· {c.detail}</span>
                  </p>
                  {c.status !== "ok" && c.fix && <p className="text-xs text-[var(--muted)]">{c.fix}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => void mutate()}
          disabled={isValidating}
          className={`${btn} ring-1 ring-[var(--border)] disabled:opacity-50`}
        >
          {isValidating ? "Checking…" : "Check again"}
        </button>
      </div>
      <p className="text-xs text-[var(--muted)]">
        Addresses and API keys live in your <code>.env</code> file. After changing it, restart the container.
      </p>
    </div>
  );
}

function SignIn({ info }: { info: SetupInfo | undefined }) {
  const on = (v: boolean | undefined) => (v ? "on" : "off");
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--muted)]">
        You&apos;re the admin. Here&apos;s how everyone else gets in. These are set in <code>.env</code>.
      </p>
      <ul className={`${card} text-sm`} style={{ background: "var(--card)" }}>
        <li>
          <span className="font-medium">Open sign-up: {on(info?.registrationOpen)}.</span>{" "}
          <span className="text-[var(--muted)]">
            {info?.registrationOpen
              ? "Anyone who can reach Lexarr can create an account."
              : "Sign-up is closed. Add people under Admin → Users, or set REGISTRATION_OPEN=true."}
          </span>
        </li>
        <li>
          <span className="font-medium">Jellyfin sign-in: {on(info?.jellyfinEnabled)}.</span>{" "}
          <span className="text-[var(--muted)]">Needs JELLYFIN_URL. Hide it with AUTH_JELLYFIN_ENABLED=false.</span>
        </li>
        <li>
          <span className="font-medium">Plex sign-in: {on(info?.plexEnabled)}.</span>{" "}
          <span className="text-[var(--muted)]">Turn it on with AUTH_PLEX_ENABLED=true.</span>
        </li>
      </ul>
      <p className="text-xs text-[var(--muted)]">
        New accounts need your approval for requests unless you mark them trusted under Admin → Users.
      </p>
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (plain HTTP on a LAN address): the text is selectable.
    }
  }
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="shrink-0 text-[var(--muted)]">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded bg-[var(--background)] px-2 py-1">{value}</code>
      <button type="button" onClick={() => void copy()} className={`${btn} px-3 py-1 text-xs ring-1 ring-[var(--border)]`}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Webhooks({ info }: { info: SetupInfo | undefined }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--muted)]">
        Optional. Webhooks let Radarr, Sonarr and Lidarr tell Lexarr the moment something finishes. Without them,
        Lexarr checks every minute, which also works.
      </p>
      <div className={card} style={{ background: "var(--card)" }}>
        {info && !info.webhookSecretSet && (
          <p className="text-sm text-[#f59e0b]">
            <code>LEXARR_WEBHOOK_SECRET</code> isn&apos;t set, so Lexarr will reject webhook calls. Set it in{" "}
            <code>.env</code> and restart first.
          </p>
        )}
        <p className="text-sm font-medium">In each app: Settings → Connect → Add → Webhook</p>
        <CopyField label="Radarr URL" value={`${origin}/api/webhooks/radarr`} />
        <CopyField label="Sonarr URL" value={`${origin}/api/webhooks/sonarr`} />
        <CopyField label="Lidarr URL" value={`${origin}/api/webhooks/lidarr`} />
        <ul className="list-disc space-y-1 pl-5 text-xs text-[var(--muted)]">
          <li>Method: POST. Username: anything. Password: your LEXARR_WEBHOOK_SECRET.</li>
          <li>Events: On Import and On Upgrade.</li>
        </ul>
      </div>
    </div>
  );
}

const COPY: Record<(typeof STEPS)[number], { title: string; lead?: string }> = {
  Welcome: { title: "Welcome to Lexarr", lead: "A two-minute tour of what to check before you share it. Skip anything, and find it all again in Admin → Settings." },
  Connections: { title: "Connect your apps" },
  "Sign-in": { title: "Who can sign in" },
  Notifications: { title: "Notifications", lead: "Optional. Get a Discord, Slack or webhook message when requests are made, approved, fail or finish." },
  Webhooks: { title: "Instant status updates" },
  Updates: { title: "Update notices" },
  Done: { title: "You're set", lead: "That's it. Lexarr is ready for requests." },
};

export default function SetupGuide() {
  const router = useRouter();
  const { data: info } = useApi<SetupInfo>("/api/admin/setup");
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = STEPS[step];
  const last = step === STEPS.length - 1;

  async function finish(status: "completed" | "skipped") {
    setSaving(true);
    setError(null);
    try {
      await apiSend("/api/admin/setup", "PUT", { status });
      router.push("/");
    } catch (err) {
      setError(failure("Saving", err));
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
          Setup guide · step {step + 1} of {STEPS.length}
        </p>
        <div className="flex gap-1" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className="h-1 flex-1 rounded-full"
              style={{ background: i <= step ? "var(--accent)" : "var(--border)" }}
            />
          ))}
        </div>
        <h1 className="text-2xl font-bold">{COPY[name].title}</h1>
        {COPY[name].lead && <p className="text-sm text-[var(--muted)]">{COPY[name].lead}</p>}
      </div>

      {name === "Connections" && <Connections />}
      {name === "Sign-in" && <SignIn info={info} />}
      {name === "Notifications" && <NotificationChannelsSection onError={setError} />}
      {name === "Webhooks" && <Webhooks info={info} />}
      {name === "Updates" && <UpdateNoticeSection />}

      {error && (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={() => void finish("skipped")}
          disabled={saving}
          className="text-sm text-[var(--muted)] underline-offset-2 hover:underline disabled:opacity-50"
        >
          {last ? "" : "Skip setup"}
        </button>
        <div className="flex gap-2">
          {step > 0 && (
            <button type="button" onClick={() => setStep(step - 1)} className={`${btn} ring-1 ring-[var(--border)]`}>
              Back
            </button>
          )}
          {last ? (
            <button
              type="button"
              onClick={() => void finish("completed")}
              disabled={saving}
              className={`${btn} bg-[var(--accent)] text-white disabled:opacity-50`}
            >
              Finish
            </button>
          ) : (
            <button type="button" onClick={() => setStep(step + 1)} className={`${btn} bg-[var(--accent)] text-white`}>
              {step === 0 ? "Start" : "Next"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
