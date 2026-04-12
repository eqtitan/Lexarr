"use client";

import { useEffect, useState, useCallback } from "react";
import type { SearchResult } from "@/types";

interface CastMember {
  name: string;
  character?: string;
  photo?: string;
}

interface Album {
  id: string;
  title: string;
  year?: string;
}

interface DetailData {
  // Common
  overview?: string;
  posterUrl?: string;
  backdropUrl?: string;
  genres?: string[];
  rating?: number;
  // Movie/TV
  runtime?: number;
  cast?: CastMember[];
  // TV
  seasons?: number;
  episodes?: number;
  network?: string;
  status?: string;
  // Music
  albums?: Album[];
}

export default function DetailPanel({
  result,
  onClose,
  onRequest,
}: {
  result: SearchResult;
  onClose: () => void;
  onRequest: () => void;
}) {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setDetail(null);
    try {
      // Music detail needs the artist UUID, not the album/release ID
      const rawId = result.mediaType === "music" && result.artistId
        ? result.artistId
        : result.id;
      const res = await fetch(`/api/detail?type=${result.mediaType}&id=${encodeURIComponent(rawId)}`);
      if (res.ok) {
        setDetail(await res.json());
      }
    } catch {}
    setLoading(false);
  }, [result.id, result.mediaType]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const mediaTypeColor: Record<string, string> = {
    movie: "var(--movie)",
    tv: "var(--tv)",
    music: "var(--music)",
    book: "var(--book)",
  };

  const mediaTypeLabel: Record<string, string> = {
    movie: "Movie",
    tv: "TV Show",
    music: "Artist",
    book: "Book",
  };

  const accentColor = mediaTypeColor[result.mediaType] || "var(--accent)";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col bg-[var(--background)] shadow-2xl overflow-hidden animate-slide-in-right">
        {/* Header */}
        <div className="relative flex-shrink-0">
          {detail?.backdropUrl && (
            <img
              src={detail.backdropUrl}
              alt=""
              className="h-40 w-full object-cover opacity-40"
            />
          )}
          <div className={`absolute inset-0 bg-gradient-to-b from-transparent to-[var(--background)] ${detail?.backdropUrl ? "" : "hidden"}`} />
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Title block */}
          <div className="flex gap-4">
            {result.posterUrl && (
              <img
                src={result.posterUrl}
                alt={result.title}
                className="h-32 flex-shrink-0 rounded-xl object-cover shadow-lg"
                style={{ width: "5.5rem" }}
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="rounded px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider"
                  style={{ background: accentColor }}
                >
                  {mediaTypeLabel[result.mediaType]}
                </span>
                {result.year && (
                  <span className="text-xs text-[var(--muted)]">{result.year}</span>
                )}
                {detail?.rating != null && (
                  <span className="text-xs text-yellow-400">★ {(detail.rating as number).toFixed(1)}</span>
                )}
              </div>
              <h2 className="text-xl font-bold leading-tight">{result.title}</h2>
              {result.artist && (
                <p className="text-sm text-[var(--muted)] mt-0.5">{result.artist}</p>
              )}
              {detail?.network && (
                <p className="text-xs text-[var(--muted)] mt-0.5">{detail.network}</p>
              )}
              {(detail?.seasons != null || detail?.runtime != null) && (
                <p className="text-xs text-[var(--muted)] mt-1">
                  {detail.runtime != null && `${detail.runtime} min`}
                  {detail.seasons != null && typeof detail.seasons === "number" && `${detail.seasons} season${detail.seasons !== 1 ? "s" : ""}`}
                </p>
              )}
            </div>
          </div>

          {/* Genres */}
          {detail?.genres && detail.genres.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {detail.genres.map((g) => (
                <span key={g} className="rounded-full bg-[var(--card)] px-3 py-1 text-xs text-[var(--muted)]">
                  {g}
                </span>
              ))}
            </div>
          )}

          {/* Overview */}
          {(result.overview || detail?.overview) && (
            <p className="text-sm leading-relaxed text-[var(--muted)]">
              {result.overview || detail?.overview}
            </p>
          )}

          {/* Cast */}
          {detail?.cast && detail.cast.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">Cast</h3>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {detail.cast.map((c, i) => (
                  <div key={i} className="flex-shrink-0 w-16 text-center">
                    {c.photo ? (
                      <img src={c.photo} alt={c.name} className="mx-auto mb-1 h-14 w-14 rounded-full object-cover" />
                    ) : (
                      <div
                        className="mx-auto mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--card)] text-lg font-bold"
                        style={{ color: accentColor }}
                      >
                        {c.name[0]}
                      </div>
                    )}
                    <p className="text-[10px] font-medium leading-tight">{c.name}</p>
                    {c.character && <p className="text-[10px] text-[var(--muted)] leading-tight">{c.character}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Albums (music) */}
          {detail?.albums && detail.albums.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">Albums</h3>
              <div className="space-y-1">
                {detail.albums.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded-lg bg-[var(--card)] px-3 py-2">
                    <span className="text-sm">{a.title}</span>
                    {a.year && <span className="text-xs text-[var(--muted)]">{a.year}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TV info */}
          {result.mediaType === "tv" && typeof detail?.seasons === "number" && (
            <div className="flex gap-4">
              <div className="rounded-xl bg-[var(--card)] px-4 py-3 text-center flex-1">
                <p className="text-2xl font-bold" style={{ color: accentColor }}>{detail.seasons}</p>
                <p className="text-xs text-[var(--muted)]">Seasons</p>
              </div>
              {typeof detail.episodes === "number" && (
                <div className="rounded-xl bg-[var(--card)] px-4 py-3 text-center flex-1">
                  <p className="text-2xl font-bold" style={{ color: accentColor }}>{detail.episodes}</p>
                  <p className="text-xs text-[var(--muted)]">Episodes</p>
                </div>
              )}
              {detail.status && (
                <div className="rounded-xl bg-[var(--card)] px-4 py-3 text-center flex-1">
                  <p className="text-sm font-bold" style={{ color: accentColor }}>{detail.status}</p>
                  <p className="text-xs text-[var(--muted)]">Status</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Request button footer */}
        <div className="flex-shrink-0 border-t border-[var(--border)] p-4">
          <button
            onClick={onRequest}
            className="w-full rounded-xl py-3 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98]"
            style={{ background: accentColor }}
          >
            Request {result.title}
          </button>
        </div>
      </div>
    </>
  );
}
