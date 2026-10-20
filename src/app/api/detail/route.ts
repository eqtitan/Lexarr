import { NextRequest, NextResponse } from "next/server";
import { detailCache } from "@/lib/cache";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import type {
  TmdbMovie,
  TmdbTvShow,
  TmdbCastMember,
  TmdbGenre,
  MusicBrainzReleaseGroup,
  OpenLibraryWork,
} from "@/types/external-apis";

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_KEY = process.env.TMDB_API_KEY;
const MB_BASE = "https://musicbrainz.org/ws/2";

async function tmdb<T>(path: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(
    `${TMDB_BASE}${path}${sep}api_key=${TMDB_KEY}&language=en-US`,
  );
  if (!res.ok) throw new Error(`TMDB ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function GET(req: NextRequest) {
  // Same budget as /api/search — this is the other unauthenticated,
  // publicly-reachable "browse" endpoint, and was previously missing a
  // rate limit entirely (unbounded TMDB-key spend / MusicBrainz IP-ban risk).
  const ip = getClientIp(req.headers);
  const rateCheck = await checkRateLimit(`detail:${ip}`, RATE_LIMITS.search);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.ceil((rateCheck.resetAt - Date.now()) / 1000),
          ),
        },
      },
    );
  }

  const type = req.nextUrl.searchParams.get("type");
  const id = req.nextUrl.searchParams.get("id");

  if (!type || !id) {
    return NextResponse.json({ error: "Missing type or id" }, { status: 400 });
  }

  // Validate type and id format per media type
  const validTypes = ["movie", "tv", "music", "book"];
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }
  if ((type === "movie" || type === "tv") && !/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  if (type === "music" && !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid music id" }, { status: 400 });
  }
  if (type === "book" && !/^(\/works\/)?OL\d+W$/.test(id)) {
    return NextResponse.json({ error: "Invalid book id" }, { status: 400 });
  }

  const cacheKey = `detail:${type}:${id}`;
  const cached = detailCache.get(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  try {
    let result: Record<string, unknown> | undefined;

    if (type === "movie") {
      const data = await tmdb<TmdbMovie>(
        `/movie/${id}?append_to_response=credits`,
      );
      result = {
        title: data.title,
        year: data.release_date?.slice(0, 4),
        overview: data.overview,
        posterUrl: data.poster_path
          ? `https://image.tmdb.org/t/p/w500${data.poster_path}`
          : undefined,
        backdropUrl: data.backdrop_path
          ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}`
          : undefined,
        runtime: data.runtime,
        genres: data.genres?.map((g: TmdbGenre) => g.name),
        cast: data.credits?.cast
          ?.slice(0, 8)
          .map((c: TmdbCastMember) => ({
            name: c.name,
            character: c.character,
            photo: c.profile_path
              ? `https://image.tmdb.org/t/p/w185${c.profile_path}`
              : undefined,
          })),
        rating: data.vote_average,
      };
    } else if (type === "tv") {
      const data = await tmdb<TmdbTvShow>(
        `/tv/${id}?append_to_response=credits`,
      );
      result = {
        title: data.name,
        year: data.first_air_date?.slice(0, 4),
        overview: data.overview,
        posterUrl: data.poster_path
          ? `https://image.tmdb.org/t/p/w500${data.poster_path}`
          : undefined,
        backdropUrl: data.backdrop_path
          ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}`
          : undefined,
        seasons: data.number_of_seasons,
        episodes: data.number_of_episodes,
        network: data.networks?.[0]?.name,
        genres: data.genres?.map((g: TmdbGenre) => g.name),
        cast: data.credits?.cast
          ?.slice(0, 8)
          .map((c: TmdbCastMember) => ({
            name: c.name,
            character: c.character,
            photo: c.profile_path
              ? `https://image.tmdb.org/t/p/w185${c.profile_path}`
              : undefined,
          })),
        status: data.status,
        rating: data.vote_average,
      };
    } else if (type === "music") {
      // Music search results are release-groups (albums / singles /
      // EPs) — the id passed here is a release-group MBID. Fetch the
      // release-group with artist-credits so the detail panel can show
      // `Title · Artist · Year · Type` without a second round-trip.
      const rgRes = await fetch(
        `${MB_BASE}/release-group/${id}?inc=artist-credits&fmt=json`,
        {
          headers: { "User-Agent": "Lexarr/1.0 (media-request-portal)" },
        },
      );
      if (!rgRes.ok) {
        throw new Error(`MusicBrainz release-group ${id}: ${rgRes.status}`);
      }
      const rg: MusicBrainzReleaseGroup = await rgRes.json();
      const artistCredit = rg["artist-credit"]?.[0];
      const artistName = artistCredit?.name || "Unknown Artist";
      const primary = rg["primary-type"] || "Release";
      const secondary = rg["secondary-types"] || [];
      const typeLabel =
        secondary.length > 0
          ? `${secondary.join(" ")} ${primary}`.trim()
          : primary;

      result = {
        title: rg.title,
        year: rg["first-release-date"]?.slice(0, 4),
        overview: `${typeLabel} by ${artistName}`,
        artist: artistName,
        // MB doesn't host art — Cover Art Archive keys on release-group id.
        posterUrl: `https://coverartarchive.org/release-group/${rg.id}/front-500`,
        releaseType: primary.toLowerCase(),
        secondaryTypes: secondary,
      };
    } else if (type === "book") {
      const workPath = id.startsWith("/") ? id : `/works/${id}`;
      const res = await fetch(`https://openlibrary.org${workPath}.json`);
      if (!res.ok) throw new Error(`OpenLibrary ${id}: ${res.status}`);
      const data: OpenLibraryWork = await res.json();
      const description =
        typeof data.description === "string"
          ? data.description
          : data.description?.value;
      const coverId = data.covers?.[0];
      result = {
        title: data.title,
        overview: description,
        posterUrl: coverId
          ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
          : undefined,
      };
    } else {
      return NextResponse.json({ error: "Unknown type" }, { status: 400 });
    }

    if (result) {
      detailCache.set(cacheKey, result);
    }

    return NextResponse.json(result || {});
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
