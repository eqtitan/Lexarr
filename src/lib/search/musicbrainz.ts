import type { SearchResult } from "@/types";

const BASE = "https://musicbrainz.org/ws/2";

export async function search(query: string): Promise<SearchResult[]> {
  const res = await fetch(
    `${BASE}/release-group?query=${encodeURIComponent(query)}&fmt=json&limit=10`,
    { headers: { "User-Agent": "Lexarr/1.0 (media-request-portal)" } }
  );
  if (!res.ok) return [];
  const data = await res.json();

  return (data["release-groups"] || []).map((rg: any): SearchResult => {
    const artistCredit = rg["artist-credit"]?.[0];
    const artist = artistCredit?.name || "Unknown Artist";
    const artistId = artistCredit?.artist?.id; // MusicBrainz artist UUID
    const coverId = rg.id;
    return {
      id: rg.id,
      mediaType: "music",
      title: rg.title || "Unknown",
      year: rg["first-release-date"]?.slice(0, 4),
      overview: `${rg["primary-type"] || "Release"} by ${artist}`,
      posterUrl: `https://coverartarchive.org/release-group/${coverId}/front-250`,
      artist,
      artistId,
    };
  });
}
