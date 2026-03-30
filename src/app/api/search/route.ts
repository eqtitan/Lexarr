import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { search as tmdbSearch } from "@/lib/search/tmdb";
import { search as musicSearch } from "@/lib/search/musicbrainz";
import { search as bookSearch } from "@/lib/search/openlib";
import * as whisparr from "@/lib/arr/whisparr";
import * as prowlarr from "@/lib/arr/prowlarr";
import type { SearchResult, MediaType } from "@/types";

async function whisparrSearch(query: string): Promise<SearchResult[]> {
  // 1. Try Whisparr series/site lookup (TPDB)
  const sites: any[] = await whisparr.lookup(query).catch(() => []);
  if (sites.length > 0) {
    return sites.slice(0, 20).map((s) => ({
      id: `site:${String(s.foreignId ?? s.tpdbId ?? s.id)}`,
      mediaType: "adult" as MediaType,
      subType: "site" as const,
      title: s.title,
      year: s.year ? String(s.year) : undefined,
      overview: s.overview,
      posterUrl:
        s.images?.find((i: any) => i.coverType === "poster")?.remoteUrl ??
        s.remotePoster,
    }));
  }

  // 2. Fall back to Prowlarr indexer search (for content not in TPDB)
  const prowlarrResults = await prowlarr.searchAdult(query).catch(() => []);
  if (prowlarrResults.length === 0) return [];

  // De-duplicate by normalized title and pick best quality per unique title
  const seen = new Set<string>();
  const deduped: prowlarr.ProwlarrResult[] = [];
  for (const r of prowlarrResults) {
    const normalized = r.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      deduped.push(r);
    }
  }

  return deduped.slice(0, 20).map((r) => ({
    id: `prowlarr:${encodeURIComponent(r.guid)}`,
    mediaType: "adult" as MediaType,
    subType: "prowlarr" as const,
    title: r.title,
    year: r.title.match(/\b(19|20)\d{2}\b/)?.[0],
    overview: `${r.indexer} · ${r.protocol === "torrent" ? `${r.seeders ?? 0} seeders` : "usenet"} · ${Math.round(r.size / 1024 / 1024 / 1024 * 10) / 10} GB`,
    posterUrl: undefined,
    size: r.size,
    seeders: r.seeders,
    protocol: r.protocol,
    downloadUrl: r.downloadUrl,
    indexer: r.indexer,
  }));
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  const filter = req.nextUrl.searchParams.get("type") as MediaType | null;

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  // Adult search is admin-only
  if (filter === "adult") {
    const session = await auth();
    if (!session || (session.user as any)?.role !== "admin") {
      return NextResponse.json({ results: [] });
    }
    const results = await whisparrSearch(query).catch(() => []);
    return NextResponse.json({ results });
  }

  const searches: Promise<SearchResult[]>[] = [];

  if (!filter || filter === "movie" || filter === "tv") {
    searches.push(tmdbSearch(query).catch(() => []));
  }
  if (!filter || filter === "music") {
    searches.push(musicSearch(query).catch(() => []));
  }
  if (!filter || filter === "book") {
    searches.push(bookSearch(query).catch(() => []));
  }

  const resultArrays = await Promise.all(searches);
  const results = resultArrays.flat();

  return NextResponse.json({ results });
}
