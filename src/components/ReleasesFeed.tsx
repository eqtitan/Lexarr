"use client";

import { useEffect, useState } from "react";
import MediaCard from "@/components/MediaCard";
import type { SearchResult, LibraryStatusValue, MediaType } from "@/types";

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
  subtitle,
  icon,
  accentVar,
  items,
  libraryStatuses,
  onSelect,
  onRequested,
}: {
  label: string;
  subtitle?: string;
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
      {subtitle && <p className="-mt-1 text-xs text-[var(--muted)]">{subtitle}</p>}
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

interface DiscoverSection {
  id: string;
  title: string;
  subtitle: string;
  items: SearchResult[];
}

const SECTION_ICONS: Record<string, string> = {
  chart: "🔥",
  "your-artists": "🎤",
  "coming-soon": "📅",
  trending: "📈",
  "your-authors": "✍️",
};

interface DiscoverData {
  sections: DiscoverSection[];
  builtAt: string | null;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago" */
export function updatedAgo(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

async function loadDiscover(type: "music" | "book"): Promise<DiscoverData> {
  try {
    const res = await fetch(`/api/discover?type=${type}`);
    const json = res.ok ? await res.json() : {};
    return {
      sections: Array.isArray(json.sections) ? json.sections : [],
      builtAt: typeof json.builtAt === "string" ? json.builtAt : null,
    };
  } catch {
    return { sections: [], builtAt: null };
  }
}

/** Music / Books lists from /api/discover, fetched the first time the chip
 *  is picked and kept for the rest of the visit. */
function DiscoverFeed({
  type,
  isAdmin = false,
  libraryStatuses,
  onSelect,
  onRequested,
  onLoaded,
}: {
  type: "music" | "book";
  isAdmin?: boolean;
  libraryStatuses: Record<string, LibraryStatusValue>;
  onSelect: (r: SearchResult) => void;
  onRequested: (r: SearchResult) => void;
  onLoaded: (items: SearchResult[]) => void;
}) {
  const [byType, setByType] = useState<Partial<Record<"music" | "book", DiscoverData>>>({});
  const [refreshing, setRefreshing] = useState(false);
  const data = byType[type];
  const sections = data?.sections;

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    void (async () => {
      const got = await loadDiscover(type);
      if (cancelled) return;
      setByType((prev) => ({ ...prev, [type]: got }));
      const items = got.sections.flatMap((s) => s.items);
      if (items.length > 0) onLoaded(items);
    })();
    return () => {
      cancelled = true;
    };
    // Fetch once per type; onLoaded is a stable callback from the page.
  }, [type, data]);

  /** Admin: rebuild both lists now, then reload the one on screen. */
  const refresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/discover", { method: "POST" });
      const got = await loadDiscover(type);
      setByType({ [type]: got });
      const items = got.sections.flatMap((s) => s.items);
      if (items.length > 0) onLoaded(items);
    } finally {
      setRefreshing(false);
    }
  };

  const accentVar = type === "music" ? "var(--music)" : "var(--book)";

  if (!sections) {
    return (
      <div className="space-y-3" data-testid="discover-loading">
        <p className="text-center text-sm text-[var(--muted)]">
          {type === "music" ? "Loading popular albums…" : "Loading trending books…"}
        </p>
        <div className="grid gap-3 overflow-hidden sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 rounded-xl skeleton" />
          ))}
        </div>
      </div>
    );
  }

  const shown = sections.filter((s) => s.items.length > 0);
  const status = (data?.builtAt || isAdmin) && (
    <p className="flex items-center justify-center gap-2 text-xs text-[var(--muted)]" data-testid="discover-updated">
      {data?.builtAt && <span>Updated {updatedAgo(data.builtAt)}</span>}
      {isAdmin && (
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="rounded-md px-2 py-0.5 ring-1 ring-[var(--border)] hover:text-[var(--foreground)] disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh now"}
        </button>
      )}
    </p>
  );
  if (shown.length === 0) {
    return (
      <div className="space-y-3">
        <BrowseHint category={type} />
        {isAdmin && status}
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid={`discover-${type}`}>
      {status}
      {shown.map((s) => (
        <ReleaseRow
          key={s.id}
          label={s.title}
          subtitle={s.subtitle}
          icon={SECTION_ICONS[s.id] ?? "✨"}
          accentVar={accentVar}
          items={s.items}
          libraryStatuses={libraryStatuses}
          onSelect={onSelect}
          onRequested={onRequested}
        />
      ))}
    </div>
  );
}

function BrowseHint({ category }: { category: MediaType }) {
  const hint = BROWSE_HINTS[category];
  if (!hint) return null;
  return (
    <div
      className="rounded-xl p-6 text-center ring-1 ring-[var(--border)]"
      style={{ background: "var(--card)" }}
      data-testid="browse-hint"
    >
      <p className="text-2xl" aria-hidden>
        {hint.icon}
      </p>
      <h2 className="mt-2 text-sm font-bold uppercase tracking-wide" style={{ color: hint.accentVar }}>
        {hint.title}
      </h2>
      <p className="mt-1 text-sm text-[var(--muted)]">{hint.body}</p>
    </div>
  );
}

/** Shown on the Music / Books tabs when their discovery lists are empty
 *  (a source is down, or everything on them is already in the library). */
const BROWSE_HINTS: Partial<Record<MediaType, { icon: string; accentVar: string; title: string; body: string }>> = {
  music: {
    icon: "🎵",
    accentVar: "var(--music)",
    title: "Find music",
    body: "Search above for an artist, album, EP or single. Albums, EPs and Singles chips appear once you start typing.",
  },
  book: {
    icon: "📚",
    accentVar: "var(--book)",
    title: "Find books",
    body: "Search above for a title or an author.",
  },
};

export default function ReleasesFeed({
  category = null,
  isAdmin = false,
  libraryStatuses,
  onSelect,
  onRequested,
  onLoaded,
}: {
  /** The category chip picked in the search bar; null = All. */
  category?: MediaType | null;
  /** Shows the "Refresh now" button on the Music / Books lists. */
  isAdmin?: boolean;
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
    void (async () => {
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

  // Music and Books get their own lists (popular albums, trending books)
  // instead of the movie/TV feed.
  if (category === "music" || category === "book") {
    return (
      <DiscoverFeed
        type={category}
        isAdmin={isAdmin}
        libraryStatuses={libraryStatuses}
        onSelect={onSelect}
        onRequested={onRequested}
        onLoaded={onLoaded}
      />
    );
  }

  const showMovies = category === null || category === "movie";
  const showTv = category === null || category === "tv";

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

  const movies = showMovies ? (data?.movies ?? []) : [];
  const tv = showTv ? (data?.tv ?? []) : [];
  if (movies.length === 0 && tv.length === 0) {
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
        items={movies}
        libraryStatuses={libraryStatuses}
        onSelect={onSelect}
        onRequested={onRequested}
      />
      <ReleaseRow
        label="New TV Shows"
        icon="📺"
        accentVar="var(--tv)"
        items={tv}
        libraryStatuses={libraryStatuses}
        onSelect={onSelect}
        onRequested={onRequested}
      />
    </div>
  );
}
