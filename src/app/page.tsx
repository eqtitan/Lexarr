"use client";

// Dynamic rendering is forced at the root layout — see src/app/layout.tsx.
// Route-segment config in a "use client" file is silently ignored by Next.js.

import { useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import SearchBar from "@/components/SearchBar";
import MediaCard from "@/components/MediaCard";
import DetailPanel from "@/components/DetailPanel";
import { useToast } from "@/components/Toast";
import type {
  SearchResult,
  MediaType,
  LibraryStatusValue,
} from "@/types";

export default function Home() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(
    null,
  );
  const [libraryStatuses, setLibraryStatuses] = useState<
    Record<string, LibraryStatusValue>
  >({});
  const { toast } = useToast();

  const handleSearch = useCallback(
    async (
      query: string,
      filter: MediaType | null,
      sub: "album" | "ep" | "single" | null,
    ) => {
      if (query.length < 2) {
        setResults([]);
        setSearched(false);
        setLibraryStatuses({});
        return;
      }
      setLoading(true);
      setSearched(true);
      setLibraryStatuses({});
      try {
        const params = new URLSearchParams({ q: query });
        if (filter) params.set("type", filter);
        if (sub) params.set("sub", sub);
        const res = await fetch(`/api/search?${params}`);
        const data = await res.json();
        const searchResults: SearchResult[] = data.results || [];
        setResults(searchResults);

        // Fetch library statuses asynchronously (don't block search rendering)
        if (searchResults.length > 0) {
          fetchLibraryStatuses(searchResults);
        }
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const fetchLibraryStatuses = useCallback(
    async (searchResults: SearchResult[]) => {
      try {
        const items = searchResults.map((r) => ({
          id: r.id,
          mediaType: r.mediaType,
          artistId: r.artistId,
          releaseType: r.releaseType,
        }));
        const res = await fetch("/api/library-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });
        if (res.ok) {
          const data = await res.json();
          setLibraryStatuses(data.statuses || {});
        }
      } catch {
        // Library status is enhancement, not critical
      }
    },
    [],
  );

  /** After any successful or already-requested POST, mark the item in
   *  libraryStatuses so the affected card (and any sibling with the same
   *  key) re-renders its button without a page refresh. */
  const markRequested = useCallback((r: SearchResult) => {
    setLibraryStatuses((prev) => ({
      ...prev,
      [`${r.mediaType}:${r.id}`]: "requested",
    }));
  }, []);

  const handleDetailRequest = useCallback(async (opts: { qualityProfileId?: number; bookFormat?: "ebook" | "audiobook" }) => {
    if (!selectedResult) return;
    const target = selectedResult;
    setSelectedResult(null);
    try {
      const res = await fetch("/api/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaType: target.mediaType,
          externalId: target.id,
          title: target.title,
          year: target.year,
          posterUrl: target.posterUrl,
          artist: target.artist,
          artistId: target.artistId,
          qualityProfileId: opts.qualityProfileId,
          releaseType: target.releaseType,
          bookFormat: opts.bookFormat,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        markRequested(target);
        toast("Already requested", "info");
      } else if (!res.ok) {
        toast(data.error || "Request failed", "error");
      } else {
        markRequested(target);
        toast(`Requested: ${target.title}`, "success");
      }
    } catch {
      toast("Network error", "error");
    }
  }, [selectedResult, toast, markRequested]);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold">
          <span className="text-[var(--accent)]">Lex</span>arr
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Search and request movies, TV, music, and books
        </p>
      </div>

      <SearchBar onSearch={handleSearch} isAdmin={isAdmin} />

      {loading && (
        <div className="space-y-3">
          <p className="text-center text-sm text-[var(--muted)]">
            Searching...
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="flex gap-4 rounded-xl p-3 ring-1 ring-[var(--border)]"
                style={{ background: "var(--card)" }}
              >
                <div className="skeleton h-36 w-24 shrink-0 rounded-lg" />
                <div className="flex flex-1 flex-col gap-2 py-1">
                  <div className="skeleton h-4 w-3/4 rounded" />
                  <div className="skeleton h-3 w-1/2 rounded" />
                  <div className="skeleton mt-auto h-8 w-24 rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="grid gap-3 overflow-hidden sm:grid-cols-2">
          {results.map((r) => (
            <MediaCard
              key={`${r.mediaType}-${r.id}`}
              result={r}
              libraryStatus={libraryStatuses[`${r.mediaType}:${r.id}`]}
              onClick={() => setSelectedResult(r)}
              onRequested={markRequested}
            />
          ))}
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <p className="py-12 text-center text-[var(--muted)]">
          No results found. Try a different search term.
        </p>
      )}

      {!searched && (
        <div className="py-16 text-center text-[var(--muted)]">
          <div className="mx-auto mb-4 flex justify-center gap-4 text-3xl">
            <span>🎬</span>
            <span>📺</span>
            <span>🎵</span>
            <span>📚</span>
          </div>
          <p>Search for anything across your media stack</p>
        </div>
      )}

      {selectedResult && (
        <DetailPanel
          result={selectedResult}
          libraryStatus={libraryStatuses[`${selectedResult.mediaType}:${selectedResult.id}`]}
          onClose={() => setSelectedResult(null)}
          onRequest={handleDetailRequest}
        />
      )}
    </div>
  );
}
