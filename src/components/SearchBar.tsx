"use client";

import { useState, useCallback, useRef } from "react";
import type { MediaType } from "@/types";

const filters: { value: MediaType | "all"; label: string; color: string }[] = [
  { value: "all", label: "All", color: "var(--accent)" },
  { value: "movie", label: "Movies", color: "var(--movie)" },
  { value: "tv", label: "TV", color: "var(--tv)" },
  { value: "music", label: "Music", color: "var(--music)" },
  { value: "book", label: "Books", color: "var(--book)" },
];

export default function SearchBar({
  onSearch,
}: {
  onSearch: (query: string, filter: MediaType | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<MediaType | "all">("all");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleChange = useCallback(
    (value: string) => {
      setQuery(value);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onSearch(value, activeFilter === "all" ? null : activeFilter);
      }, 350);
    },
    [activeFilter, onSearch]
  );

  const handleFilter = useCallback(
    (f: MediaType | "all") => {
      setActiveFilter(f);
      if (query.length >= 2) {
        onSearch(query, f === "all" ? null : f);
      }
    },
    [query, onSearch]
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
      <div className="flex gap-2">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => handleFilter(f.value)}
            className="rounded-lg px-3 py-1.5 text-sm font-medium transition-all"
            style={{
              background:
                activeFilter === f.value ? f.color : "var(--card)",
              color: activeFilter === f.value ? "white" : "var(--muted)",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}
