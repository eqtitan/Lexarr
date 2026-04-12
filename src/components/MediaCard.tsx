"use client";

import { useState } from "react";
import type { SearchResult } from "@/types";

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

export default function MediaCard({
  result,
  onClick,
}: {
  result: SearchResult;
  onClick?: () => void;
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
        }),
      });
      if (res.status === 409) {
        setAlreadyRequested(true);
        return;
      }
      if (!res.ok) throw new Error("Request failed");
      setRequested(true);
    } catch (err: any) {
      setError(err.message);
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
          {typeLabels[result.mediaType]}
        </span>
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
            <p className="mt-0.5 text-sm text-[var(--muted)]">{result.artist}</p>
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
            disabled={requesting || requested || alreadyRequested}
            className="ml-auto rounded-lg px-4 py-1.5 text-sm font-medium transition-all disabled:opacity-60"
            style={{
              background: requested
                ? "var(--success)"
                : alreadyRequested
                ? "var(--warning)"
                : error
                ? "var(--danger)"
                : "var(--accent)",
              color: alreadyRequested ? "#000" : "white",
            }}
          >
            {requested
              ? "Requested ✓"
              : alreadyRequested
              ? "Already Requested"
              : requesting
              ? "..."
              : error
              ? "Failed"
              : "Request"}
          </button>
        </div>
      </div>
    </div>
  );
}
