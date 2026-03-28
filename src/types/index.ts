export type MediaType = "movie" | "tv" | "music" | "book";

export interface SearchResult {
  id: string;
  mediaType: MediaType;
  title: string;
  year?: string;
  overview?: string;
  posterUrl?: string;
  rating?: number;
  artist?: string; // music: artist name, book: author
  artistId?: string; // music: MusicBrainz artist UUID for Lidarr
}

export interface RequestStatus {
  id: string;
  mediaType: MediaType;
  title: string;
  posterUrl?: string;
  status: "pending" | "approved" | "downloading" | "available" | "denied";
  createdAt: string;
}

export interface ArrHealth {
  service: string;
  healthy: boolean;
  message?: string;
}
