"use client";

import { useState } from "react";
import type { SearchResult, LibraryStatusValue } from "@/types";

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
        >
          {result.mediaType === "music" && result.releaseType
            ? musicReleaseLabels[result.releaseType]
            : typeLabels[result.mediaType]}
        </span>
        {/* Library status badge (bottom-right) */}
        {libraryStatus && statusBadge[libraryStatus] && (
          <span
            className="absolute bottom-1 right-1 rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
            style={{ background: statusBadge[libraryStatus].bg }}
          >
            {statusBadge[libraryStatus].label}
          </span>
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
