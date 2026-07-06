import * as radarr from "@/lib/arr/radarr";
import * as sonarr from "@/lib/arr/sonarr";
import * as lidarr from "@/lib/arr/lidarr";
import * as prowlarr from "@/lib/arr/prowlarr";
import * as qbittorrent from "@/lib/arr/qbittorrent";
import * as nzbget from "@/lib/arr/nzbget";
import * as bazarr from "@/lib/arr/bazarr";
import * as lazylibrarian from "@/lib/arr/lazylibrarian";
import * as jellyfin from "@/lib/arr/jellyfin";

export type ServiceCategory = "arr" | "download" | "media" | "utility";

export interface ServiceDefinition {
  name: string;
  category: ServiceCategory;
  url: string;
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
    url: "http://your-server-ip:7878",
    health: radarr.health,
    unraidContainerName: "radarr",
  },
  {
    name: "Sonarr",
    category: "arr",
    url: "http://your-server-ip:8989",
    health: sonarr.health,
    unraidContainerName: "sonarr",
  },
  {
    name: "Lidarr",
    category: "arr",
    url: "http://your-server-ip:8686",
    health: lidarr.health,
    unraidContainerName: "lidarr",
  },
  {
    name: "Prowlarr",
    category: "arr",
    url: "http://your-server-ip:9696",
    health: prowlarr.health,
    unraidContainerName: "prowlarr",
  },
  {
    name: "Bazarr",
    category: "arr",
    url: "http://your-server-ip:6767",
    health: bazarr.health,
    unraidContainerName: "bazarr",
  },
  {
    name: "LazyLibrarian",
    category: "arr",
    url: "http://your-server-ip:5299",
    health: lazylibrarian.health,
    unraidContainerName: "lazylibrarian",
  },
  // ── Download clients ──────────────────────────────────────────────
  {
    name: "qBittorrent",
    category: "download",
    url: "http://your-server-ip:8080",
    health: qbittorrent.health,
    unraidContainerName: "qbittorrent",
  },
  {
    name: "NZBGet",
    category: "download",
    url: "http://your-server-ip:6789",
    health: nzbget.health,
    unraidContainerName: "nzbget",
  },
  // ── Media servers ─────────────────────────────────────────────────
  {
    name: "Jellyfin",
    category: "media",
    url: "http://your-server-ip:8096",
    health: jellyfin.health,
    unraidContainerName: "jellyfin",
  },
];
