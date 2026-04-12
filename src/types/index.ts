export type MediaType = "movie" | "tv" | "music" | "book";

export type RequestStatusValue =
  | "pending"
  | "approved"
  | "downloading"
  | "available"
  | "denied"
  | "failed"
  | "stalled";

export type PipelineEventType =
  | "submitted"
  | "approved"
  | "denied"
  | "sent_to_arr"
  | "downloading"
  | "available"
  | "failed"
  | "stalled"
  | "retried";

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
  status: RequestStatusValue;
  createdAt: string;
}

export interface ArrHealth {
  service: string;
  healthy: boolean;
  message?: string;
}
