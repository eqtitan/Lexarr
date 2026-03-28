import type { SearchResult } from "@/types";

const BASE = "https://openlibrary.org";

export async function search(query: string): Promise<SearchResult[]> {
  const res = await fetch(
    `${BASE}/search.json?q=${encodeURIComponent(query)}&limit=10`
  );
  if (!res.ok) return [];
  const data = await res.json();

  return (data.docs || []).slice(0, 10).map((doc: any): SearchResult => ({
    id: doc.key, // e.g. "/works/OL123W"
    mediaType: "book",
    title: doc.title || "Unknown",
    year: doc.first_publish_year ? String(doc.first_publish_year) : undefined,
    overview: doc.subtitle || (doc.subject ? doc.subject.slice(0, 3).join(", ") : undefined),
    posterUrl: doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
      : undefined,
    artist: doc.author_name?.join(", "),
  }));
}
