"use client";

import { useState, useCallback, useRef } from "react";
import type { MediaType, MusicReleaseType } from "@/types";

const FILTERS: { value: MediaType | "all"; label: string; color: string }[] = [
  { value: "all", label: "All", color: "var(--accent)" },
  { value: "movie", label: "Movies", color: "var(--movie)" },
  { value: "tv", label: "TV", color: "var(--tv)" },
  { value: "music", label: "Music", color: "var(--music)" },
  { value: "book", label: "Books", color: "var(--book)" },
];

const MUSIC_SUBFILTERS: { value: MusicReleaseType | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "album", label: "Albums" },
  { value: "single", label: "Singles" },
  { value: "ep", label: "EPs" },
];

export default function SearchBar({
  onSearch,
}: {
  onSearch: (
    query: string,
    filter: MediaType | null,
    releaseType: MusicReleaseType | null,
  ) => void;
  isAdmin?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<MediaType | "all">("all");
  const [activeSubFilter, setActiveSubFilter] = useState<MusicReleaseType | "all">("all");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const runSearch = useCallback(
    (q: string, f: MediaType | "all", sf: MusicReleaseType | "all") => {
      onSearch(
        q,
        f === "all" ? null : f,
        f === "music" && sf !== "all" ? sf : null,
      );
    },
    [onSearch],
  );

  const handleChange = useCallback(
    (value: string) => {
      setQuery(value);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        runSearch(value, activeFilter, activeSubFilter);
      }, 250);
    },
    [activeFilter, activeSubFilter, runSearch],
  );

  const handleFilter = useCallback(
    (f: MediaType | "all") => {
      setActiveFilter(f);
      // Reset subfilter when switching away from music
      const nextSub = f === "music" ? activeSubFilter : "all";
      setActiveSubFilter(nextSub);
      if (query.length >= 2) {
        runSearch(query, f, nextSub);
      }
    },
    [query, activeSubFilter, runSearch],
  );

  const handleSubFilter = useCallback(
    (sf: MusicReleaseType | "all") => {
      setActiveSubFilter(sf);
      if (query.length >= 2) {
        runSearch(query, activeFilter, sf);
      }
    },
    [query, activeFilter, runSearch],
  );

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
      {activeFilter === "music" && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mb-1 scrollbar-none">
          {MUSIC_SUBFILTERS.map((sf) => (
            <button
              key={sf.value}
              onClick={() => handleSubFilter(sf.value)}
              className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ring-1"
              style={{
                background:
                  activeSubFilter === sf.value ? "var(--music)" : "transparent",
                color:
                  activeSubFilter === sf.value ? "white" : "var(--muted)",
                borderColor: "var(--border)",
              }}
            >
              {sf.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
