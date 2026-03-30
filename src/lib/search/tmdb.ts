import type { SearchResult } from "@/types";

const BASE = "https://api.themoviedb.org/3";
const KEY = process.env.TMDB_API_KEY || "";

export async function search(query: string): Promise<SearchResult[]> {
  if (!KEY) return [];
  const res = await fetch(
    `${BASE}/search/multi?query=${encodeURIComponent(query)}&api_key=${KEY}&page=1&with_original_language=en`
  );
  if (!res.ok) return [];
  const data = await res.json();

  return (data.results || [])
    .filter((r: any) => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, 10)
    .map((r: any): SearchResult => ({
      id: String(r.id),
      mediaType: r.media_type === "movie" ? "movie" : "tv",
      title: r.title || r.name || "Unknown",
      year: (r.release_date || r.first_air_date || "").slice(0, 4),
      overview: r.overview?.slice(0, 200),
      posterUrl: r.poster_path ? `https://image.tmdb.org/t/p/w300${r.poster_path}` : undefined,
      rating: r.vote_average ? Math.round(r.vote_average * 10) / 10 : undefined,
    }));
}
