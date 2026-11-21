"use client";

import { useState } from "react";

interface Props {
  required: string[];
  /** Variables the server found missing or malformed, by name. */
  problems: Record<string, "missing" | "invalid">;
}

const HINTS: Record<string, string> = {
  NEXTAUTH_SECRET: "A long random string that signs login cookies.",
  ARR_HOST: "Address of the machine running Radarr, Sonarr and Lidarr, e.g. http://192.168.1.100",
  RADARR_API_KEY: "Radarr → Settings → General → API Key",
  SONARR_API_KEY: "Sonarr → Settings → General → API Key",
  LIDARR_API_KEY: "Lidarr → Settings → General → API Key",
  TMDB_API_KEY: "Free at themoviedb.org → Settings → API",
};

function randomSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function fieldError(name: string, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (name === "ARR_HOST" && !/^https?:\/\/\S+$/.test(v)) return "Must start with http:// or https://";
  return null;
}

export default function SetupNeededForm({ required, problems }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [webhook, setWebhook] = useState("");
  const [copied, setCopied] = useState(false);

  const filled = required.every((n) => (values[n] ?? "").trim() !== "" && !fieldError(n, values[n] ?? ""));

  const lines = [...required, "LEXARR_WEBHOOK_SECRET"].map((n) => {
    const v = (n === "LEXARR_WEBHOOK_SECRET" ? webhook : (values[n] ?? "")).trim();
    return `${n}=${v}`;
  });
  const block = lines.join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(block);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked (plain http): the block is selectable below */
    }
  }

  return (
    <div className="mt-6 space-y-5">
      {required.map((name) => {
        const err = fieldError(name, values[name] ?? "");
        return (
          <div key={name}>
            <label htmlFor={name} className="flex items-center gap-2 text-sm font-medium">
              <code>{name}</code>
              {problems[name] && (
                <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-400">
                  {problems[name] === "missing" ? "missing" : "not valid"}
                </span>
              )}
            </label>
            <p className="text-xs text-[var(--muted)]">{HINTS[name]}</p>
            <div className="mt-1 flex gap-2">
              <input
                id={name}
                value={values[name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
              />
              {name === "NEXTAUTH_SECRET" && (
                <button
                  type="button"
                  onClick={() => setValues((v) => ({ ...v, NEXTAUTH_SECRET: randomSecret() }))}
                  className="shrink-0 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                >
                  Generate
                </button>
              )}
            </div>
            {err && <p className="mt-1 text-xs text-red-400">{err}</p>}
          </div>
        );
      })}

      <div>
        <label htmlFor="LEXARR_WEBHOOK_SECRET" className="text-sm font-medium">
          <code>LEXARR_WEBHOOK_SECRET</code> <span className="text-xs text-[var(--muted)]">(recommended)</span>
        </label>
        <p className="text-xs text-[var(--muted)]">
          Lets Radarr, Sonarr and Lidarr tell Lexarr when a download finishes.
        </p>
        <div className="mt-1 flex gap-2">
          <input
            id="LEXARR_WEBHOOK_SECRET"
            value={webhook}
            onChange={(e) => setWebhook(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => setWebhook(randomSecret())}
            className="shrink-0 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
          >
            Generate
          </button>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Your .env block</h2>
          <button
            type="button"
            onClick={copy}
            disabled={!filled}
            className="rounded-md border border-[var(--border)] px-3 py-1 text-sm disabled:opacity-40"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre
          data-testid="env-block"
          className="mt-2 overflow-x-auto rounded-md border border-[var(--border)] p-3 text-xs"
        >
          {block}
        </pre>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Add these lines to the <code>.env</code> file your container reads (or its environment
          settings on Unraid), then restart the container. This page goes away on its own once
          everything is set.
        </p>
      </div>
    </div>
  );
}
