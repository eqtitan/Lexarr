"use client";

import { useState, useCallback, useRef, useEffect } from "react";
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
      {/* Chip row group — main chips + optional music sub-row.
          Uses space-y-2 internally so the gap between main + sub row
          matches the horizontal gap-2 between main chips (visual
          consistency — user requested). Outer space-y-3 keeps the
          search-input → chip-group gap unchanged at 12px. */}
      <div className="space-y-2">
      <div className="flex gap-2 overflow-x-auto pb-1 -mb-1 scrollbar-none">
        {FILTERS.map((f) => (
          <button
            key={f.value}
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
          Left-aligned to match the rhythm of the main chip row: same
          gap-2 between chips, same starting edge, same flex behavior.
          The vertical space-y-2 wrapper gives us the 8px gap from the
          main row. No centering, no anchoring — just a clean second
          row of chips in the same visual language. */}
      {activeFilter === "music" && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mb-1 scrollbar-none">
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
      )}
      </div>
    </div>
  );
}
