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
  health: () => Promise<any>;
}

/**
 * Full registry of all services Lexarr monitors.
 * To add a new service: add one entry to this array.
 */
export const SERVICE_REGISTRY: ServiceDefinition[] = [
  // ── Arr apps ──────────────────────────────────────────────────────
  { name: "Radarr",        category: "arr",      url: "http://192.168.1.100:7878", health: radarr.health },
  { name: "Sonarr",        category: "arr",      url: "http://192.168.1.100:8989", health: sonarr.health },
  { name: "Lidarr",        category: "arr",      url: "http://192.168.1.100:8686", health: lidarr.health },
  { name: "Prowlarr",      category: "arr",      url: "http://192.168.1.100:9696", health: prowlarr.health },
  { name: "Bazarr",        category: "arr",      url: "http://192.168.1.100:6767", health: bazarr.health },
  { name: "LazyLibrarian", category: "arr",      url: "http://192.168.1.100:5299", health: lazylibrarian.health },
  // ── Download clients ──────────────────────────────────────────────
  { name: "qBittorrent",   category: "download", url: "http://192.168.1.100:8080", health: qbittorrent.health },
  { name: "NZBGet",        category: "download", url: "http://192.168.1.100:6789", health: nzbget.health },
  // ── Media servers ─────────────────────────────────────────────────
  { name: "Jellyfin",      category: "media",    url: "http://192.168.1.100:8096", health: jellyfin.health },
];
