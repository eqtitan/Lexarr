import type { SearchResult, MusicReleaseType } from "@/types";

const BASE = "https://musicbrainz.org/ws/2";

function normalizeType(mbType?: string): MusicReleaseType | undefined {
  if (!mbType) return undefined;
  const t = mbType.toLowerCase();
  if (t === "album") return "album";
  if (t === "single") return "single";
  if (t === "ep") return "ep";
  return "other";
}

export async function search(
  query: string,
  releaseType?: MusicReleaseType,
): Promise<SearchResult[]> {
  let mbQuery = query;
  if (releaseType && releaseType !== "other") {
    mbQuery = `${query} AND primarytype:${releaseType}`;
  }
  const res = await fetch(
    `${BASE}/release-group?query=${encodeURIComponent(mbQuery)}&fmt=json&limit=10`,
    { headers: { "User-Agent": "Lexarr/1.0 (media-request-portal)" } },
  );
  if (!res.ok) return [];
  const data = await res.json();

  interface MbReleaseGroup {
    id: string;
    title: string;
    "first-release-date"?: string;
    "primary-type"?: string;
    "artist-credit"?: { name: string; artist?: { id: string } }[];
  }

  return (data["release-groups"] || []).map((rg: MbReleaseGroup): SearchResult => {
    const artistCredit = rg["artist-credit"]?.[0];
    const artist = artistCredit?.name || "Unknown Artist";
    const artistId = artistCredit?.artist?.id;
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
      releaseType: normalizeType(rg["primary-type"]),
    };
  });
}
