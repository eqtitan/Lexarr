"use client";

import { useRef, useState } from "react";
import type { SearchResult, LibraryStatusValue } from "@/types";
import { playExclusively } from "@/lib/preview-audio";

const typeColors: Record<string, string> = {
  movie: "var(--movie)",
  tv: "var(--tv)",
  music: "var(--music)",
  book: "var(--book)",
};

const typeLabels: Record<string, string> = {
  movie: "Movie",
  tv: "TV Show",
  music: "Album",
  book: "Book",
};

const musicReleaseLabels: Record<string, string> = {
  album: "Album",
  single: "Single",
  ep: "EP",
  other: "Release",
};

const statusBadge: Record<string, { label: string; bg: string }> = {
  available: { label: "In Library", bg: "var(--success)" },
  monitored: { label: "Monitored", bg: "var(--tv)" },
  requested: { label: "Requested", bg: "var(--warning)" },
};

export default function MediaCard({
  result,
  libraryStatus,
  onClick,
  onRequested,
}: {
  result: SearchResult;
  libraryStatus?: LibraryStatusValue;
  onClick?: () => void;
  /** Notify parent after a successful or already-exists request so sibling
   *  cards (and this one, after a detail-panel request) also reflect the
   *  new status without a page refresh. */
  onRequested?: (result: SearchResult) => void;
}) {
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(false);
  const [alreadyRequested, setAlreadyRequested] = useState(false);
  const [error, setError] = useState<string>();

  // ── Music preview (30s audio sample) ────────────────────────────
  // Lazy-loaded on first click — we never prefetch for the 15-card grid.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  // `unavailable` is permanent for this mount — neither iTunes nor
  // Deezer had a matching preview, so subsequent clicks shouldn't
  // re-fire the lookup.
  const [previewState, setPreviewState] = useState<
    "idle" | "loading" | "playing" | "unavailable"
  >("idle");

  async function handlePreview(e: React.MouseEvent) {
    e.stopPropagation();
    if (result.mediaType !== "music" || !result.artist) return;

    // Toggle off if we're currently playing this card
    if (previewState === "playing") {
      audioRef.current?.pause();
      setPreviewState("idle");
      return;
    }

    // Kick off the lookup on first click
    let url = previewUrlRef.current;
    if (!url) {
      setPreviewState("loading");
      try {
        const q = new URLSearchParams({
          mbid: result.id,
          artist: result.artist,
          title: result.title,
        });
        const res = await fetch(`/api/music-preview?${q}`);
        if (!res.ok) {
          setPreviewState("unavailable");
          return;
        }
        const data = await res.json();
        const found = data.preview?.url as string | undefined;
        if (!found) {
          setPreviewState("unavailable");
          return;
        }
        url = found;
        previewUrlRef.current = url;
      } catch {
        setPreviewState("unavailable");
        return;
      }
    }

    // Create the audio lazily so the DOM doesn't hold N idle <audio>s
    if (!audioRef.current) {
      const a = new Audio(url);
      a.preload = "none";
      // Pause fires on both user-click-pause AND peer-card takeover
      // (playExclusively). Either way we're no longer playing, so reset
      // unconditionally — simpler than trying to distinguish.
      a.addEventListener("ended", () => setPreviewState("idle"));
      a.addEventListener("pause", () => setPreviewState("idle"));
      audioRef.current = a;
    }

    try {
      await playExclusively(audioRef.current);
      setPreviewState("playing");
    } catch {
      // play() can reject on autoplay-blocked browsers, but we're in
      // direct click handler so that's unlikely; treat as transient.
      setPreviewState("idle");
    }
  }

  async function handleRequest(e: React.MouseEvent) {
    e.stopPropagation();
    setRequesting(true);
    setError(undefined);
    try {
      const res = await fetch("/api/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaType: result.mediaType,
          externalId: result.id,
          title: result.title,
          year: result.year,
          posterUrl: result.posterUrl,
          artist: result.artist,
          artistId: result.artistId,
          releaseType: result.releaseType,
        }),
      });
      if (res.status === 401) {
        setError("Sign in first");
        return;
      }
      if (res.status === 409) {
        setAlreadyRequested(true);
        onRequested?.(result);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Request failed");
      }
      setRequested(true);
      onRequested?.(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div
      className="group flex min-w-0 gap-4 rounded-xl bg-[var(--card)] p-3 ring-1 ring-[var(--border)] transition-all hover:bg-[var(--card-hover)] hover:ring-[var(--accent)]/30 hover:-translate-y-0.5 transition-transform duration-150"
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : undefined }}
    >
      {/* Poster */}
      <div className="relative h-36 w-24 shrink-0 overflow-hidden rounded-lg bg-[var(--border)]">
        {result.posterUrl ? (
          <img
            src={result.posterUrl}
            alt={result.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-[var(--muted)]">
            No Image
          </div>
        )}
        {/* Media type badge (top-left) */}
        <span
          className="absolute left-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white"
          style={{ background: typeColors[result.mediaType] }}
          title={
            result.mediaType === "music" && result.secondaryTypes?.length
              ? result.secondaryTypes.join(" / ")
              : undefined
          }
        >
          {result.mediaType === "music" && result.releaseType
            ? musicReleaseLabels[result.releaseType]
            : typeLabels[result.mediaType]}
        </span>
        {/* Music secondary-type badge (below primary — shows Live / Remix / etc) */}
        {result.mediaType === "music" &&
          result.secondaryTypes &&
          result.secondaryTypes.length > 0 && (
            <span
              className="absolute left-1 top-6 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase"
              style={{
                background: "rgba(0,0,0,0.7)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.35)",
              }}
              title={result.secondaryTypes.join(" / ")}
            >
              {result.secondaryTypes[0]}
            </span>
          )}
        {/* Library status badge (bottom-right) */}
        {libraryStatus && statusBadge[libraryStatus] && (
          <span
            className="absolute bottom-1 right-1 rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
            style={{ background: statusBadge[libraryStatus].bg }}
          >
            {statusBadge[libraryStatus].label}
          </span>
        )}
        {/* Music preview button (bottom-left) — 30s sample from iTunes/Deezer */}
        {result.mediaType === "music" && result.artist &&
          previewState !== "unavailable" && (
            <button
              type="button"
              onClick={handlePreview}
              disabled={previewState === "loading"}
              className="absolute bottom-1 left-1 flex h-6 w-6 items-center justify-center rounded-full text-white shadow-md transition-opacity hover:opacity-90 disabled:opacity-70"
              style={{ background: "rgba(0,0,0,0.72)" }}
              title={
                previewState === "loading"
                  ? "Loading preview…"
                  : previewState === "playing"
                    ? "Pause 30s preview"
                    : "Play 30s preview"
              }
              aria-label={
                previewState === "playing" ? "Pause preview" : "Play preview"
              }
            >
              {previewState === "loading" ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : previewState === "playing" ? (
                <svg
                  className="h-3 w-3"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg
                  className="ml-0.5 h-3 w-3"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
          )}
      </div>

      {/* Info */}
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div>
          <h3 className="truncate font-semibold leading-tight">
            {result.title}
            {result.year && (
              <span className="ml-2 text-sm font-normal text-[var(--muted)]">
                ({result.year})
              </span>
            )}
          </h3>
          {result.artist && (
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              {result.artist}
            </p>
          )}
          {result.overview && (
            <p className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">
              {result.overview}
            </p>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          {result.rating && (
            <span className="text-xs text-[var(--warning)]">
              ★ {result.rating}
            </span>
          )}
          <button
            onClick={handleRequest}
            disabled={
              requesting ||
              requested ||
              alreadyRequested ||
              libraryStatus === "available" ||
              libraryStatus === "monitored"
            }
            className="ml-auto rounded-lg px-4 py-1.5 text-sm font-medium transition-all disabled:opacity-60"
            style={{
              background:
                libraryStatus === "available"
                  ? "var(--success)"
                  : libraryStatus === "monitored"
                    ? "var(--tv)"
                    : requested
                      ? "var(--success)"
                      : alreadyRequested || libraryStatus === "requested"
                        ? "var(--warning)"
                        : error
                          ? "var(--danger)"
                          : "var(--accent)",
              color:
                alreadyRequested || libraryStatus === "requested"
                  ? "#000"
                  : "white",
            }}
          >
            {libraryStatus === "available"
              ? "In Library"
              : libraryStatus === "monitored"
                ? "Monitored"
                : requested
                  ? "Requested ✓"
                  : alreadyRequested || libraryStatus === "requested"
                    ? "Already Requested"
                    : requesting
                      ? "..."
                      : error
                        ? error
                        : "Request"}
          </button>
        </div>
      </div>
    </div>
  );
}
