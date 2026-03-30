import { NextRequest, NextResponse } from "next/server";
import * as whisparr from "@/lib/arr/whisparr";

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_KEY = process.env.TMDB_API_KEY;
const MB_BASE = "https://musicbrainz.org/ws/2";

async function tmdb(path: string) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${TMDB_BASE}${path}${sep}api_key=${TMDB_KEY}&language=en-US`);
  if (!res.ok) throw new Error(`TMDB ${path}: ${res.status}`);
  return res.json();
}

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type");
  const id = req.nextUrl.searchParams.get("id");

  if (!type || !id) {
    return NextResponse.json({ error: "Missing type or id" }, { status: 400 });
  }

  try {
    if (type === "movie") {
      const data = await tmdb(`/movie/${id}?append_to_response=credits`);
      return NextResponse.json({
        title: data.title,
        year: data.release_date?.slice(0, 4),
        overview: data.overview,
        posterUrl: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : undefined,
        backdropUrl: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : undefined,
        runtime: data.runtime,
        genres: data.genres?.map((g: any) => g.name),
        cast: data.credits?.cast?.slice(0, 8).map((c: any) => ({ name: c.name, character: c.character, photo: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : undefined })),
        rating: data.vote_average,
      });
    }

    if (type === "tv") {
      const data = await tmdb(`/tv/${id}?append_to_response=credits`);
      return NextResponse.json({
        title: data.name,
        year: data.first_air_date?.slice(0, 4),
        overview: data.overview,
        posterUrl: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : undefined,
        backdropUrl: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : undefined,
        seasons: data.number_of_seasons,
        episodes: data.number_of_episodes,
        network: data.networks?.[0]?.name,
        genres: data.genres?.map((g: any) => g.name),
        cast: data.credits?.cast?.slice(0, 8).map((c: any) => ({ name: c.name, character: c.character, photo: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : undefined })),
        status: data.status,
        rating: data.vote_average,
      });
    }

    if (type === "music") {
      // id is MusicBrainz artist UUID
      const artistRes = await fetch(`${MB_BASE}/artist/${id}?inc=release-groups&fmt=json`, {
        headers: { "User-Agent": "Lexarr/1.0 (media-request-portal)" },
      });
      if (!artistRes.ok) throw new Error(`MusicBrainz artist ${id}: ${artistRes.status}`);
      const artist = await artistRes.json();
      const albums = (artist["release-groups"] || [])
        .filter((rg: any) => rg["primary-type"] === "Album")
        .map((rg: any) => ({ id: rg.id, title: rg.title, year: rg["first-release-date"]?.slice(0, 4) }))
        .slice(0, 20);
      return NextResponse.json({
        title: artist.name,
        overview: artist.disambiguation || undefined,
        genres: artist.genres?.map((g: any) => g.name),
        albums,
      });
    }

    if (type === "book") {
      // id may be "/works/OL12345W" or just "OL12345W"
      const workPath = id.startsWith("/") ? id : `/works/${id}`;
      const res = await fetch(`https://openlibrary.org${workPath}.json`);
      if (!res.ok) throw new Error(`OpenLibrary ${id}: ${res.status}`);
      const data = await res.json();
      const description = typeof data.description === "string"
        ? data.description
        : data.description?.value;
      const coverId = data.covers?.[0];
      return NextResponse.json({
        title: data.title,
        overview: description,
        posterUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : undefined,
      });
    }

    if (type === "adult") {
      if (id.startsWith("prowlarr:")) {
        // Prowlarr results have no additional metadata beyond what was in the search result
        return NextResponse.json({ isProwlarr: true });
      }

      const isSite = id.startsWith("site:");
      const foreignId = id.replace(/^(site|movie):/, "");

      if (isSite) {
        // 1. Check if already in Whisparr
        let existing = await whisparr.getSiteByForeignId(foreignId);
        // 2. If not, silently add unmonitored so we can get episodes
        if (!existing) {
          // Need the title — look it up first
          const lookupResults: any[] = await whisparr.lookup(foreignId).catch(() => []);
          // lookup by foreignId might not work, but we have it from the search result
          // We'll do a broad lookup and find the match
          const siteTitle = lookupResults.find(
            (s: any) => String(s.foreignId) === foreignId || String(s.tpdbId) === foreignId
          )?.title || foreignId;
          try {
            await whisparr.addSite(foreignId, siteTitle, false);
            existing = await whisparr.getSiteByForeignId(foreignId);
          } catch {
            // If add fails, return what we have from the search result
          }
        }

        if (!existing) {
          return NextResponse.json({ episodes: [], seasons: [] });
        }

        const episodes: any[] = await whisparr.getEpisodes(existing.id).catch(() => []);
        const mapped = episodes.map((e: any) => ({
          id: e.id,
          title: e.title,
          airDate: e.airDate,
          season: e.seasonNumber,
          episode: e.episodeNumber,
          overview: e.overview,
          hasFile: e.hasFile,
        }));

        return NextResponse.json({
          whisparrId: existing.id,
          seasons: existing.seasons?.length,
          episodes: mapped,
        });
      } else {
        // Movie — return from lookup
        const movies: any[] = await whisparr.lookupMovie(foreignId).catch(() => []);
        const movie = movies.find(
          (m: any) => String(m.foreignId) === foreignId || String(m.tpdbId) === foreignId
        ) || movies[0];
        if (!movie) return NextResponse.json({});
        return NextResponse.json({
          runtime: movie.runtime,
          studio: movie.studio,
          genres: movie.genres,
          cast: movie.actors?.slice(0, 8).map((a: any) => ({ name: a.name, character: a.character })),
          certifications: movie.certifications,
        });
      }
    }

    return NextResponse.json({ error: "Unknown type" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
