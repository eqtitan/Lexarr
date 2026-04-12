"use client";

import { useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import SearchBar from "@/components/SearchBar";
import MediaCard from "@/components/MediaCard";
import DetailPanel from "@/components/DetailPanel";
import { useToast } from "@/components/Toast";
import type { SearchResult, MediaType } from "@/types";

export default function Home() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const { toast } = useToast();

  const handleSearch = useCallback(async (query: string, filter: MediaType | null) => {
    if (query.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams({ q: query });
      if (filter) params.set("type", filter);
      const res = await fetch(`/api/search?${params}`);
      const data = await res.json();
      setResults(data.results || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDetailRequest = useCallback(async () => {
    if (!selectedResult) return;
    setSelectedResult(null);
    try {
      const res = await fetch("/api/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaType: selectedResult.mediaType,
          externalId: selectedResult.id,
          title: selectedResult.title,
          year: selectedResult.year,
          posterUrl: selectedResult.posterUrl,
          artist: selectedResult.artist,
          artistId: selectedResult.artistId,
          downloadUrl: selectedResult.downloadUrl,
          protocol: selectedResult.protocol,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        toast("Already requested", "info");
      } else if (!res.ok) {
        toast(data.error || "Request failed", "error");
      } else {
        toast(`Requested: ${selectedResult.title}`, "success");
      }
    } catch {
      toast("Network error", "error");
    }
  }, [selectedResult, toast]);

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
          <p className="text-center text-sm text-[var(--muted)]">Searching...</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-4 rounded-xl p-3 ring-1 ring-[var(--border)]" style={{ background: "var(--card)" }}>
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
              onClick={() => setSelectedResult(r)}
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
          onClose={() => setSelectedResult(null)}
          onRequest={handleDetailRequest}
        />
      )}

    </div>
  );
}
