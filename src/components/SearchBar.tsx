"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import type { MediaType } from "@/types";

const FILTERS: { value: MediaType | "all"; label: string; color: string }[] = [
  { value: "all", label: "All", color: "var(--accent)" },
  { value: "movie", label: "Movies", color: "var(--movie)" },
  { value: "tv", label: "TV", color: "var(--tv)" },
  { value: "music", label: "Music", color: "var(--music)" },
  { value: "book", label: "Books", color: "var(--book)" },
];

/** Music sub-filter. `album` is the default when Music is first selected. */
export type MusicSubFilter = "album" | "ep" | "single";
const MUSIC_SUB_FILTERS: { value: MusicSubFilter; label: string }[] = [
  { value: "album", label: "Albums" },
  { value: "ep", label: "EPs" },
  { value: "single", label: "Singles" },
];

export default function SearchBar({
  onSearch,
}: {
  onSearch: (
    query: string,
    filter: MediaType | null,
    sub: MusicSubFilter | null,
  ) => void;
  isAdmin?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<MediaType | "all">("all");
  const [activeSub, setActiveSub] = useState<MusicSubFilter>("album");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Refs + offset state for positioning the Music sub-chip row so its
  // horizontal center lines up with the Music chip's horizontal center.
  // Measured via getBoundingClientRect on each render of the Music
  // sub-row, and recomputed when the viewport resizes so it stays
  // aligned across window-size changes.
  const filterRowRef = useRef<HTMLDivElement>(null);
  const musicButtonRef = useRef<HTMLButtonElement>(null);
  const subRowRef = useRef<HTMLDivElement>(null);
  const [subOffsetPx, setSubOffsetPx] = useState(0);

  const runSearch = useCallback(
    (q: string, f: MediaType | "all", s: MusicSubFilter) => {
      onSearch(q, f === "all" ? null : f, f === "music" ? s : null);
    },
    [onSearch],
  );

  const handleChange = useCallback(
    (value: string) => {
      setQuery(value);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        runSearch(value, activeFilter, activeSub);
      }, 250);
    },
    [activeFilter, activeSub, runSearch],
  );

  const handleFilter = useCallback(
    (f: MediaType | "all") => {
      setActiveFilter(f);
      if (query.length >= 2) runSearch(query, f, activeSub);
    },
    [query, activeSub, runSearch],
  );

  const handleSub = useCallback(
    (s: MusicSubFilter) => {
      setActiveSub(s);
      if (query.length >= 2 && activeFilter === "music") {
        runSearch(query, activeFilter, s);
      }
    },
    [query, activeFilter, runSearch],
  );

  // When switching to Music, reset the sub back to the default `album`
  // so the user starts from a predictable place each time.
  useEffect(() => {
    if (activeFilter === "music") setActiveSub("album");
  }, [activeFilter]);

  // Position the sub-chip row centered under the Music button.
  // useLayoutEffect runs after DOM mutation but before paint, so the
  // user never sees a flash of unstyled misalignment. ResizeObserver
  // recomputes when the main chip row changes width (viewport resize,
  // font load). Clamped to 0 so narrow viewports don't push the row
  // off-screen — the row just sits flush-left instead.
  useLayoutEffect(() => {
    if (activeFilter !== "music") return;

    const recalc = () => {
      const musicEl = musicButtonRef.current;
      const filterRow = filterRowRef.current;
      const subRow = subRowRef.current;
      if (!musicEl || !filterRow || !subRow) return;

      const musicRect = musicEl.getBoundingClientRect();
      const rowRect = filterRow.getBoundingClientRect();
      const subWidth = subRow.offsetWidth;

      // X-center of Music button relative to the filter row's left edge.
      const musicCenter = musicRect.left + musicRect.width / 2 - rowRect.left;
      // Left offset that would center the sub-row directly under Music.
      const offset = musicCenter - subWidth / 2;
      setSubOffsetPx(Math.max(0, offset));
    };

    recalc();

    const ro = new ResizeObserver(recalc);
    if (filterRowRef.current) ro.observe(filterRowRef.current);
    return () => ro.disconnect();
  }, [activeFilter]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <svg
          className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[var(--muted)]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
          />
        </svg>
        <input
          type="text"
          placeholder="Search movies, TV shows, music, books..."
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full rounded-xl bg-[var(--card)] py-4 pl-12 pr-4 text-lg outline-none ring-1 ring-[var(--border)] transition-all placeholder:text-[var(--muted)] focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>
      <div
        ref={filterRowRef}
        className="flex gap-2 overflow-x-auto pb-1 -mb-1 scrollbar-none"
      >
        {FILTERS.map((f) => (
          <button
            key={f.value}
            ref={f.value === "music" ? musicButtonRef : undefined}
            onClick={() => handleFilter(f.value)}
            className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-all"
            style={{
              background: activeFilter === f.value ? f.color : "var(--card)",
              color: activeFilter === f.value ? "white" : "var(--muted)",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
      {/* Music sub-filter row — only visible when Music is active.
          Positioned so its horizontal center aligns with the Music
          chip's center (measured via useLayoutEffect above). No
          overflow clipping on this row — if the viewport can't fit
          the three chips, we'd rather wrap than hide them. */}
      {activeFilter === "music" && (
        <div style={{ paddingLeft: `${subOffsetPx}px` }}>
          <div
            ref={subRowRef}
            className="inline-flex flex-wrap gap-2"
          >
            {MUSIC_SUB_FILTERS.map((s) => (
              <button
                key={s.value}
                onClick={() => handleSub(s.value)}
                className="shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-all ring-1"
                style={{
                  background:
                    activeSub === s.value
                      ? "rgba(99,102,241,0.14)"
                      : "transparent",
                  color:
                    activeSub === s.value
                      ? "var(--accent)"
                      : "var(--muted)",
                  borderColor:
                    activeSub === s.value
                      ? "var(--accent)"
                      : "var(--border)",
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
