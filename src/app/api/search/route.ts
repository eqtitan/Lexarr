import { NextRequest, NextResponse } from "next/server";
import { search as tmdbSearch } from "@/lib/search/tmdb";
import { search as musicSearch } from "@/lib/search/musicbrainz";
import { search as bookSearch } from "@/lib/search/openlib";
import type { SearchResult, MediaType } from "@/types";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  const filter = req.nextUrl.searchParams.get("type") as MediaType | null;

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] });
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
