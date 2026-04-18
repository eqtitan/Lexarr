export type MediaType = "movie" | "tv" | "music" | "book";

export type MusicReleaseType = "album" | "single" | "ep" | "other";

export type BookFormat = "ebook" | "audiobook";

export type RequestStatusValue =
  | "pending"
  | "approved"
  | "downloading"
  | "available"
  | "denied"
  | "failed"
  | "stalled"
  | "cancelled";

export type PipelineEventType =
  | "submitted"
  | "approved"
  | "denied"
  | "sent_to_arr"
  | "downloading"
  | "available"
  | "failed"
  | "stalled"
  | "retried"
  | "cancelled";

export type LibraryStatusValue = "available" | "monitored" | "requested" | null;

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
  releaseType?: MusicReleaseType; // music: Album / Single / EP / Other
  /**
   * Music only — MusicBrainz "secondary-types" like "Live", "Remix",
   * "Compilation", "Soundtrack", "Demo", "Acoustic". Orthogonal to
   * releaseType: a "Live Album" is releaseType=album with secondaryTypes=["Live"].
   */
  secondaryTypes?: string[];
}

export interface RequestStatus {
  id: string;
  mediaType: MediaType;
  title: string;
  posterUrl?: string;
  status: RequestStatusValue;
  createdAt: string;
}

export interface ArrHealth {
  service: string;
  healthy: boolean;
  message?: string;
}
