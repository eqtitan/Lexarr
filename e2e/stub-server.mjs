// Stub TMDB + *arr services for the end-to-end smoke tests.
//
// Lexarr is started with TMDB_API_BASE=http://127.0.0.1:9100 and
// ARR_HOST=http://127.0.0.1, so its TMDB calls land on port 9100 and its
// Radarr/Sonarr/Lidarr calls on their default ports (7878/8989/8686) here.
// Nothing reaches the internet. Radarr keeps in-memory state so a test can
// check that an approved request was really added, then simulate the
// download finishing:
//   GET  http://127.0.0.1:7878/__e2e/state            -> { movies }
//   POST http://127.0.0.1:7878/__e2e/import?tmdbId=N  -> marks it hasFile
import http from "node:http";

export const DUNE = {
  id: 438631,
  title: "Dune",
  year: 2021,
  overview: "Paul Atreides travels to the most dangerous planet in the universe.",
};

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function tmdb(req, res) {
  const url = new URL(req.url, "http://stub");
  if (url.pathname === "/search/multi") {
    const q = (url.searchParams.get("query") || "").toLowerCase();
    const hit = DUNE.title.toLowerCase().includes(q);
    return send(res, 200, {
      results: hit
        ? [
            {
              id: DUNE.id,
              media_type: "movie",
              title: DUNE.title,
              release_date: `${DUNE.year}-09-15`,
              overview: DUNE.overview,
              vote_average: 7.8,
            },
          ]
        : [],
    });
  }
  // New Releases feed on the home page (one movie, one show, dated inside
  // its 6-month window) so the category chips have something to filter.
  if (url.pathname === "/discover/movie" || url.pathname === "/discover/tv") {
    const recent = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const item =
      url.pathname === "/discover/movie"
        ? { id: 900001, title: "Stub New Movie", release_date: recent }
        : { id: 900002, name: "Stub New Show", first_air_date: recent };
    return send(res, 200, {
      page: 1,
      total_pages: 1,
      results: [{ ...item, poster_path: "/stub.jpg", overview: "", vote_average: 7 }],
    });
  }
  // Music / Books discovery sources (DISCOVER_STUB_BASE points here).
  if (url.pathname.startsWith("/apple/")) {
    return send(res, 200, { feed: { results: [{ artistName: "Stub Artist", name: "Stub Chart Album" }] } });
  }
  if (url.pathname === "/musicbrainz/ws/2/release-group") {
    return send(res, 200, {
      "release-groups": [
        {
          id: "00000000-0000-4000-8000-000000000001",
          title: "Stub Chart Album",
          "primary-type": "Album",
          "first-release-date": "2026-11-01",
          "artist-credit": [{ name: "Stub Artist", artist: { id: "00000000-0000-4000-8000-0000000000a1" } }],
        },
      ],
    });
  }
  if (url.pathname === "/openlibrary/trending/weekly.json") {
    return send(res, 200, { works: [{ key: "/works/OL1STUBW", title: "Stub Trending Book", author_name: ["Stub Author"] }] });
  }
  if (url.pathname === `/movie/${DUNE.id}`) {
    return send(res, 200, {
      id: DUNE.id,
      title: DUNE.title,
      overview: DUNE.overview,
      release_date: `${DUNE.year}-09-15`,
      runtime: 155,
      genres: [],
      vote_average: 7.8,
    });
  }
  return send(res, 200, { results: [] });
}

function radarr() {
  let movies = [];
  let nextId = 1;
  return async (req, res) => {
    const url = new URL(req.url, "http://stub");
    const p = url.pathname;

    if (p === "/__e2e/state") return send(res, 200, { movies });
    if (p === "/__e2e/import" && req.method === "POST") {
      const tmdbId = Number(url.searchParams.get("tmdbId"));
      movies = movies.map((m) => (m.tmdbId === tmdbId ? { ...m, hasFile: true } : m));
      return send(res, 200, { movies });
    }

    if (p === "/api/v3/movie/lookup") {
      return send(res, 200, [
        { title: DUNE.title, tmdbId: DUNE.id, year: DUNE.year, images: [], titleSlug: "dune-2021" },
      ]);
    }
    if (p === "/api/v3/qualityprofile") return send(res, 200, [{ id: 1, name: "HD-1080p" }]);
    if (p === "/api/v3/rootfolder") return send(res, 200, [{ id: 1, path: "/movies" }]);
    if (p === "/api/v3/movie" && req.method === "POST") {
      const body = await readBody(req);
      const movie = {
        id: nextId++,
        tmdbId: body.tmdbId ?? DUNE.id,
        title: body.title ?? DUNE.title,
        hasFile: false,
        monitored: true,
        status: "released",
      };
      movies.push(movie);
      return send(res, 201, movie);
    }
    if (p === "/api/v3/movie") {
      const tmdbId = url.searchParams.get("tmdbId");
      return send(res, 200, tmdbId ? movies.filter((m) => String(m.tmdbId) === tmdbId) : movies);
    }
    const one = p.match(/^\/api\/v3\/movie\/(\d+)$/);
    if (one) {
      const movie = movies.find((m) => m.id === Number(one[1]));
      return movie ? send(res, 200, movie) : send(res, 404, { message: "NotFound" });
    }
    return generic(req, res);
  };
}

// Sonarr/Lidarr (and any Radarr path the smoke flow doesn't care about):
// healthy and empty.
function generic(req, res) {
  const p = new URL(req.url, "http://stub").pathname;
  if (p.endsWith("/queue")) return send(res, 200, { records: [], totalRecords: 0 });
  if (p.endsWith("/system/status")) return send(res, 200, { version: "e2e" });
  return send(res, 200, req.method === "GET" ? [] : {});
}

const servers = [
  [9100, tmdb],
  [7878, radarr()],
  [8989, generic],
  [8686, generic],
];

for (const [port, handler] of servers) {
  http
    .createServer((req, res) => {
      Promise.resolve(handler(req, res)).catch((err) => send(res, 500, { error: String(err) }));
    })
    .listen(port, "127.0.0.1");
}
console.log(`e2e stub servers listening on ${servers.map(([p]) => p).join(", ")}`);
