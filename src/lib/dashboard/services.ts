import * as radarr from "@/lib/arr/radarr";
import * as sonarr from "@/lib/arr/sonarr";
import * as lidarr from "@/lib/arr/lidarr";
import * as prowlarr from "@/lib/arr/prowlarr";
import * as qbittorrent from "@/lib/arr/qbittorrent";
import * as nzbget from "@/lib/arr/nzbget";
import * as bazarr from "@/lib/arr/bazarr";
import * as lazylibrarian from "@/lib/arr/lazylibrarian";
import * as jellyfin from "@/lib/arr/jellyfin";
import { serviceUrls } from "@/lib/arr/urls";

export type ServiceCategory = "arr" | "download" | "media" | "utility";

export interface ServiceDefinition {
  name: string;
  category: ServiceCategory;
  /** Where the service lives (ARR_HOST or its *_URL); read at call time. */
  readonly url: string;
  health: () => Promise<unknown>;
  /**
   * (M2-01/M2-02) Docker container name on the Unraid host. Optional for
   * back-compat — when omitted, callers default to `name.toLowerCase()`,
   * which matches the convention on this stack ("Radarr" → "radarr").
   * M2-02 populates this for every entry once verified against
   * `docker ps --format '{{.Names}}'`.
   */
  unraidContainerName?: string;
}

/**
 * Full registry of all services Lexarr monitors.
 * To add a new service: add one entry to this array.
 */
export const SERVICE_REGISTRY: ServiceDefinition[] = [
  // ── Arr apps ──────────────────────────────────────────────────────
  {
    name: "Radarr",
    category: "arr",
    get url() {
      return serviceUrls.radarr();
    },
    health: radarr.health,
    unraidContainerName: "radarr",
  },
  {
    name: "Sonarr",
    category: "arr",
    get url() {
      return serviceUrls.sonarr();
    },
    health: sonarr.health,
    unraidContainerName: "sonarr",
  },
  {
    name: "Lidarr",
    category: "arr",
    get url() {
      return serviceUrls.lidarr();
    },
    health: lidarr.health,
    unraidContainerName: "lidarr",
  },
  {
    name: "Prowlarr",
    category: "arr",
    get url() {
      return serviceUrls.prowlarr();
    },
    health: prowlarr.health,
    unraidContainerName: "prowlarr",
  },
  {
    name: "Bazarr",
    category: "arr",
    get url() {
      return serviceUrls.bazarr();
    },
    health: bazarr.health,
    unraidContainerName: "bazarr",
  },
  {
    name: "LazyLibrarian",
    category: "arr",
    get url() {
      return serviceUrls.lazylibrarian();
    },
    health: lazylibrarian.health,
    unraidContainerName: "lazylibrarian",
  },
  // ── Download clients ──────────────────────────────────────────────
  {
    name: "qBittorrent",
    category: "download",
    get url() {
      return serviceUrls.qbittorrent();
    },
    health: qbittorrent.health,
    unraidContainerName: "qbittorrent",
  },
  {
    name: "NZBGet",
    category: "download",
    get url() {
      return serviceUrls.nzbget();
    },
    health: nzbget.health,
    unraidContainerName: "nzbget",
  },
  // ── Media servers ─────────────────────────────────────────────────
  {
    name: "Jellyfin",
    category: "media",
    get url() {
      return serviceUrls.jellyfin();
    },
    health: jellyfin.health,
    unraidContainerName: "jellyfin",
  },
];
