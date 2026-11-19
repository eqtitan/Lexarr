/**
 * Where each service lives. The *arr apps always sit on ARR_HOST at their
 * standard ports; the others have their own *_URL override and otherwise
 * default to ARR_HOST at their standard port too. Used by the API clients
 * and by the admin dashboard's links, so both always agree.
 */
import { env } from "@/lib/env";

const host = () => (env().ARR_HOST ?? "").replace(/\/+$/, "");
const on = (port: number | string) => `${host()}:${port}`;

export const serviceUrls = {
  radarr: () => on(7878),
  sonarr: () => on(8989),
  lidarr: () => on(8686),
  prowlarr: () => on(9696),
  lazylibrarian: () => on(env().LAZYLIBRARIAN_PORT || 5299),
  bazarr: () => env().BAZARR_URL || on(6767),
  qbittorrent: () => env().QBITTORRENT_URL || on(8080),
  nzbget: () => env().NZBGET_URL || on(6789),
  jellyfin: () => env().JELLYFIN_URL || on(8096),
};
