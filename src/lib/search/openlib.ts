import type { SearchResult } from "@/types";
import { log } from "@/lib/log";

const BASE = "https://openlibrary.org";

/**
 * Fallback: try Google Books API for a cover image.
 * Free, no API key required, limited to thumbnail quality.
 */
async function googleBooksCover(title: string, author?: string): Promise<string | undefined> {
  try {
    const q = author ? `${title}+inauthor:${author}` : title;
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=1&fields=items(volumeInfo/imageLinks)`,
    );
    if (!res.ok) return undefined;
    const data = await res.json();
    const links = data.items?.[0]?.volumeInfo?.imageLinks;
    return links?.thumbnail || links?.smallThumbnail || undefined;
  } catch (err) {
    log.debug("openlib: Google Books cover lookup failed", { err });
    return undefined;
  }
}

export async function search(query: string): Promise<SearchResult[]> {
  const res = await fetch(
    `${BASE}/search.json?q=${encodeURIComponent(query)}&limit=10`,
  );
  if (!res.ok) return [];
  const data = await res.json();

  interface OlDoc {
    key: string;
    title?: string;
    first_publish_year?: number;
    subtitle?: string;
    subject?: string[];
    author_name?: string[];
    cover_i?: number;
  }

  const docs: OlDoc[] = (data.docs || []).slice(0, 10);
  const results: SearchResult[] = docs.map((doc) => ({
    id: doc.key,
    mediaType: "book" as const,
    title: doc.title || "Unknown",
    year: doc.first_publish_year ? String(doc.first_publish_year) : undefined,
    overview:
      doc.subtitle ||
      (doc.subject ? doc.subject.slice(0, 3).join(", ") : undefined),
    posterUrl: doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
      : undefined,
    artist: doc.author_name?.join(", "),
  }));

  // Fill missing covers from Google Books (fire in parallel, don't block)
  const noCover = results.filter((r) => !r.posterUrl);
  if (noCover.length > 0) {
    const covers = await Promise.all(
      noCover.map((r) => googleBooksCover(r.title, r.artist)),
    );
    noCover.forEach((r, i) => {
      if (covers[i]) r.posterUrl = covers[i];
    });
  }

  return results;
}
