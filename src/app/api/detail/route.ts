import { NextRequest, NextResponse } from "next/server";
import * as whisparr from "@/lib/arr/whisparr";
import { detailCache } from "@/lib/cache";

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

  const cacheKey = `detail:${type}:${id}`;
  const cached = detailCache.get(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  try {
    let result: any;

    if (type === "movie") {
      const data = await tmdb(`/movie/${id}?append_to_response=credits`);
      result = {
        title: data.title,
        year: data.release_date?.slice(0, 4),
        overview: data.overview,
        posterUrl: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : undefined,
        backdropUrl: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : undefined,
        runtime: data.runtime,
        genres: data.genres?.map((g: any) => g.name),
        cast: data.credits?.cast?.slice(0, 8).map((c: any) => ({ name: c.name, character: c.character, photo: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : undefined })),
        rating: data.vote_average,
      };
    } else if (type === "tv") {
      const data = await tmdb(`/tv/${id}?append_to_response=credits`);
      result = {
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
      };
    } else if (type === "music") {
      const artistRes = await fetch(`${MB_BASE}/artist/${id}?inc=release-groups&fmt=json`, {
        headers: { "User-Agent": "Lexarr/1.0 (media-request-portal)" },
      });
      if (!artistRes.ok) throw new Error(`MusicBrainz artist ${id}: ${artistRes.status}`);
      const artist = await artistRes.json();
      const albums = (artist["release-groups"] || [])
        .filter((rg: any) => rg["primary-type"] === "Album")
        .map((rg: any) => ({ id: rg.id, title: rg.title, year: rg["first-release-date"]?.slice(0, 4) }))
        .slice(0, 20);
      result = {
        title: artist.name,
        overview: artist.disambiguation || undefined,
        genres: artist.genres?.map((g: any) => g.name),
        albums,
      };
    } else if (type === "book") {
      const workPath = id.startsWith("/") ? id : `/works/${id}`;
      const res = await fetch(`https://openlibrary.org${workPath}.json`);
      if (!res.ok) throw new Error(`OpenLibrary ${id}: ${res.status}`);
      const data = await res.json();
      const description = typeof data.description === "string"
        ? data.description
        : data.description?.value;
      const coverId = data.covers?.[0];
      result = {
        title: data.title,
        overview: description,
        posterUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : undefined,
      };
    } else if (type === "adult") {
      if (id.startsWith("prowlarr:")) {
        result = { isProwlarr: true };
      } else {
        const isSite = id.startsWith("site:");
        const foreignId = id.replace(/^(site|movie):/, "");

        if (isSite) {
          let existing = await whisparr.getSiteByForeignId(foreignId);
          if (!existing) {
            const lookupResults: any[] = await whisparr.lookup(foreignId).catch(() => []);
            const siteTitle = lookupResults.find(
              (s: any) => String(s.foreignId) === foreignId || String(s.tpdbId) === foreignId
            )?.title || foreignId;
            try {
              await whisparr.addSite(foreignId, siteTitle, false);
              existing = await whisparr.getSiteByForeignId(foreignId);
            } catch {
              // If add fails, return what we have
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

          result = {
            whisparrId: existing.id,
            seasons: existing.seasons?.length,
            episodes: mapped,
          };
        } else {
          const movies: any[] = await whisparr.lookupMovie(foreignId).catch(() => []);
          const movie = movies.find(
            (m: any) => String(m.foreignId) === foreignId || String(m.tpdbId) === foreignId
          ) || movies[0];
          if (!movie) {
            return NextResponse.json({});
          }
          result = {
            runtime: movie.runtime,
            studio: movie.studio,
            genres: movie.genres,
            cast: movie.actors?.slice(0, 8).map((a: any) => ({ name: a.name, character: a.character })),
            certifications: movie.certifications,
          };
        }
      }
    } else {
      return NextResponse.json({ error: "Unknown type" }, { status: 400 });
    }

    if (result) {
      // Don't cache adult site detail (has live episode data)
      if (type !== "adult" || id.startsWith("prowlarr:")) {
        detailCache.set(cacheKey, result);
      }
    }

    return NextResponse.json(result || {});
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
