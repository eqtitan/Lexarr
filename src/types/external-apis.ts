/**
 * Type definitions for external API responses.
 * Covers TMDB, MusicBrainz, and OpenLibrary.
 */

// ── TMDB ─────────────────────────────────────────────────────────────────────

export interface TmdbMovie {
  id: number;
  title: string;
  overview: string;
  release_date?: string;
  poster_path?: string;
  backdrop_path?: string;
  runtime?: number;
  vote_average?: number;
  genres?: TmdbGenre[];
  credits?: { cast?: TmdbCastMember[] };
}

export interface TmdbTvShow {
  id: number;
  name: string;
  overview: string;
  first_air_date?: string;
  poster_path?: string;
  backdrop_path?: string;
  number_of_seasons?: number;
  number_of_episodes?: number;
  status?: string;
  vote_average?: number;
  genres?: TmdbGenre[];
  networks?: { name: string }[];
  credits?: { cast?: TmdbCastMember[] };
}

export interface TmdbSearchResult {
  id: number;
  title?: string; // movies
  name?: string; // tv shows
  media_type?: string;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string;
  vote_average?: number;
}

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbCastMember {
  name: string;
  character: string;
  profile_path?: string;
}

// ── MusicBrainz ──────────────────────────────────────────────────────────────

export interface MusicBrainzArtist {
  id: string;
  name: string;
  disambiguation?: string;
  genres?: { name: string }[];
  "release-groups"?: MusicBrainzReleaseGroup[];
}

export interface MusicBrainzReleaseGroup {
  id: string;
  title: string;
  "primary-type"?: string;
  "first-release-date"?: string;
}

export interface MusicBrainzSearchResult {
  artists?: MusicBrainzArtist[];
}

// ── OpenLibrary ──────────────────────────────────────────────────────────────

export interface OpenLibraryWork {
  title: string;
  description?: string | { value: string };
  covers?: number[];
  subjects?: string[];
}

export interface OpenLibrarySearchDoc {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
}

export interface OpenLibrarySearchResult {
  docs: OpenLibrarySearchDoc[];
  numFound: number;
}

// ── Arr Service Responses ────────────────────────────────────────────────────

export interface ArrQueueRecord {
  id: number;
  movieId?: number;
  seriesId?: number;
  artistId?: number;
  title: string;
  status: string;
  size?: number;
  sizeleft?: number;
  timeleft?: string;
  indexer?: string;
  downloadClient?: string;
  quality?: { quality?: { name?: string } };
  protocol?: string;
  trackedDownloadState?: string;
  trackedDownloadStatus?: string;
  statusMessages?: { messages?: string[]; title?: string }[];
  added?: string;
}

export interface ArrQueueResponse {
  totalRecords: number;
  records: ArrQueueRecord[];
}

export interface ArrSystemStatus {
  version?: string;
  startTime?: string;
  runtimeName?: string;
  isDocker?: boolean;
  appName?: string;
}

export interface ArrDiskSpace {
  path: string;
  freeSpace: number;
  totalSpace: number;
}

export interface ArrHealthWarning {
  type?: string;
  message?: string;
  wikiUrl?: string;
}

export interface ArrHistoryRecord {
  id: number;
  eventType?: string;
  sourceTitle?: string;
  title?: string;
  date?: string;
  quality?: { quality?: { name?: string } };
}

export interface ArrHistoryResponse {
  records: ArrHistoryRecord[];
}

export interface ArrWantedRecord {
  id: number;
  title?: string;
  year?: number;
  seasonNumber?: number;
  monitored?: boolean;
  status?: string;
  series?: { title?: string };
  artist?: { artistName?: string };
}

export interface ArrWantedResponse {
  totalRecords: number;
  records: ArrWantedRecord[];
}

export interface ArrCalendarItem {
  id: number;
  title?: string;
  artistName?: string;
  airDateUtc?: string;
  inCinemas?: string;
  releaseDate?: string;
  physicalRelease?: string;
  monitored?: boolean;
}

export interface ArrBlocklistRecord {
  id: number;
  sourceTitle?: string;
  date?: string;
  indexer?: string;
}

export interface ArrBlocklistResponse {
  totalRecords: number;
  records: ArrBlocklistRecord[];
}

export interface ArrTask {
  name: string;
  interval?: number;
  lastExecution?: string;
  nextExecution?: string;
  lastDuration?: string;
}

export interface ArrDownloadClient {
  id: number;
  name: string;
  implementation: string;
  enable?: boolean;
  protocol: string;
}

export interface ArrRootFolder {
  id: number;
  path: string;
  freeSpace?: number;
  accessible?: boolean;
}

export interface ArrQualityProfile {
  id: number;
  name: string;
}

// Library item types per service
export interface ArrRadarrMovie {
  hasFile: boolean;
  sizeOnDisk: number;
}

export interface ArrSonarrSeries {
  statistics?: {
    episodeCount?: number;
    episodeFileCount?: number;
    sizeOnDisk?: number;
  };
}

export interface ArrLidarrArtist {
  statistics?: {
    albumCount?: number;
    trackFileCount?: number;
    sizeOnDisk?: number;
  };
}
