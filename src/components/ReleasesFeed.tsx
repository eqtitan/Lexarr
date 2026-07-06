"use client";

import { useEffect, useState } from "react";
import MediaCard from "@/components/MediaCard";
import type { SearchResult, LibraryStatusValue } from "@/types";

interface ReleasesResponse {
  movies: SearchResult[];
  tv: SearchResult[];
}

/** Wrapping grid of release cards, color-tagged per category so Movies and
 *  TV Shows read as visually distinct sections rather than one
 *  undifferentiated grid — the "creative separation" the feed needs. Every
 *  item in the category flows onto the page (same grid pattern as the
 *  search-results grid), so nothing is hidden behind a carousel scroll. */
function ReleaseRow({
  label,
  icon,
  accentVar,
  items,
  libraryStatuses,
  onSelect,
  onRequested,
}: {
  label: string;
  icon: string;
  accentVar: string;
  items: SearchResult[];
  libraryStatuses: Record<string, LibraryStatusValue>;
  onSelect: (r: SearchResult) => void;
  onRequested: (r: SearchResult) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <h2
        className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide"
        style={{ color: accentVar }}
      >
        <span aria-hidden>{icon}</span>
        {label}
      </h2>
      <div className="grid gap-3 overflow-hidden sm:grid-cols-2">
        {items.map((r) => (
          <MediaCard
            key={`${r.mediaType}-${r.id}`}
            result={r}
            libraryStatus={libraryStatuses[`${r.mediaType}:${r.id}`]}
            onClick={() => onSelect(r)}
            onRequested={onRequested}
          />
        ))}
      </div>
    </div>
  );
}

export default function ReleasesFeed({
  libraryStatuses,
  onSelect,
  onRequested,
  onLoaded,
}: {
  libraryStatuses: Record<string, LibraryStatusValue>;
  onSelect: (r: SearchResult) => void;
  onRequested: (r: SearchResult) => void;
  /** Fires once with the flattened result list so the parent can fetch
   *  library statuses for the whole feed, same as it does for search. */
  onLoaded: (items: SearchResult[]) => void;
}) {
  const [data, setData] = useState<ReleasesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/releases");
        const json = await res.json();
        if (cancelled) return;
        const payload: ReleasesResponse = {
          movies: json.movies || [],
          tv: json.tv || [],
        };
        setData(payload);
        onLoaded([...payload.movies, ...payload.tv]);
      } catch {
        if (!cancelled) setData({ movies: [], tv: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        <p className="text-center text-sm text-[var(--muted)]">
          Loading new releases…
        </p>
        <div className="grid gap-3 overflow-hidden sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 rounded-xl skeleton" />
          ))}
        </div>
      </div>
    );
  }

  if (!data || (data.movies.length === 0 && data.tv.length === 0)) {
    return null;
  }

  return (
    <div className="space-y-6">
      <p className="text-center text-xs text-[var(--muted)]">
        New in the US over the last 6 months — tap anything for details or an
        instant request
      </p>
      <ReleaseRow
        label="New Movies"
        icon="🎬"
        accentVar="var(--movie)"
        items={data.movies}
        libraryStatuses={libraryStatuses}
        onSelect={onSelect}
        onRequested={onRequested}
      />
      <ReleaseRow
        label="New TV Shows"
        icon="📺"
        accentVar="var(--tv)"
        items={data.tv}
        libraryStatuses={libraryStatuses}
        onSelect={onSelect}
        onRequested={onRequested}
      />
    </div>
  );
}
