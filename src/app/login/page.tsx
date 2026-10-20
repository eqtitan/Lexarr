"use client";

import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type AuthMode = "login" | "register" | "jellyfin";

interface AuthConfig {
  plexEnabled: boolean;
  jellyfinEnabled: boolean;
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [plexLoading, setPlexLoading] = useState(false);
  const [authConfig, setAuthConfig] = useState<AuthConfig>({
    plexEnabled: false,
    jellyfinEnabled: true,
  });

  // Fetch feature flags so we only render the Plex button when it's enabled
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c) =>
        setAuthConfig({
          plexEnabled: !!c.plexEnabled,
          jellyfinEnabled: c.jellyfinEnabled !== false,
        }),
      )
      .catch(() => {
        // Network failure → fall back to defaults (Plex off, Jellyfin on)
      });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (mode === "register") {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Registration failed");
          return;
        }
        // Auto-login after register
        await signIn("credentials", {
          username: email || name,
          password,
          redirect: false,
        });
        router.push("/");
      } else if (mode === "jellyfin") {
        const result = await signIn("jellyfin", {
          username: name,
          password,
          redirect: false,
        });
        if (result?.error) {
          setError("Invalid Jellyfin credentials");
          return;
        }
        router.push("/");
      } else {
        const result = await signIn("credentials", {
          username: name || email,
          password,
          redirect: false,
        });
        if (result?.error) {
          setError("Invalid credentials");
          return;
        }
        router.push("/");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handlePlexLogin() {
    setPlexLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/plex", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        // 503 from Plex → their side. Otherwise generic.
        setError(
          res.status === 502 || res.status === 503
            ? "Plex is currently unavailable. Try again later or sign in another way."
            : "Failed to start Plex login",
        );
        return;
      }
      // Open Plex auth in new window
      const authWindow = window.open(
        data.authUrl,
        "plex-auth",
        "width=600,height=700",
      );

      // Poll for completion. The pin id is tracked server-side via the
      // httpOnly cookie the POST above set — nothing to pass here.
      const pollPin = async () => {
        try {
          const check = await fetch("/api/auth/plex");
          const checkData = await check.json();
          if (checkData.authenticated && checkData.plexToken) {
            clearInterval(interval);
            authWindow?.close();
            // Create a real NextAuth session with the Plex token
            const result = await signIn("plex", {
              plexToken: checkData.plexToken,
              redirect: false,
            });
            if (result?.error) {
              setError("Plex authentication failed");
            } else {
              router.push("/");
            }
          }
        } catch {
          // Transient network error: keep polling until the 5-minute cap.
        }
      };
      const interval = setInterval(() => void pollPin(), 2000);

      // Stop polling after 5 minutes
      setTimeout(() => clearInterval(interval), 300000);
    } finally {
      setPlexLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm pt-12">
      <h1 className="mb-1 text-center text-2xl font-bold">
        <span className="text-[var(--accent)]">Lex</span>arr
      </h1>
      <p className="mb-8 text-center text-sm text-[var(--muted)]">
        Sign in to request media
      </p>

      {/* Plex SSO button — shown only when enabled via AUTH_PLEX_ENABLED */}
      {authConfig.plexEnabled && (
        <>
          <button
            onClick={handlePlexLogin}
            disabled={plexLoading}
            className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#e5a00d] py-3 font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {plexLoading ? "Opening Plex..." : "Sign in with Plex"}
          </button>

          <div className="mb-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-[var(--border)]" />
            <span className="text-xs text-[var(--muted)]">or</span>
            <div className="h-px flex-1 bg-[var(--border)]" />
          </div>
        </>
      )}

      {/* Mode tabs — Jellyfin hidden when disabled */}
      <div className="mb-4 flex rounded-lg bg-[var(--card)] p-1">
        {(
          ["login", "register", ...(authConfig.jellyfinEnabled ? ["jellyfin" as const] : [])] as AuthMode[]
        ).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setError("");
            }}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
              mode === m
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="text"
          placeholder={mode === "jellyfin" ? "Jellyfin Username" : "Username"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg bg-[var(--card)] px-4 py-3 outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
          required
        />
        {mode === "register" && (
          <input
            type="email"
            placeholder="Email (optional)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg bg-[var(--card)] px-4 py-3 outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
          />
        )}
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg bg-[var(--card)] px-4 py-3 outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
          required
        />

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-[var(--accent)] py-3 font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading
            ? "..."
            : mode === "register"
              ? "Create Account"
              : mode === "jellyfin"
                ? "Sign in with Jellyfin"
                : "Sign In"}
        </button>
      </form>
    </div>
  );
}
