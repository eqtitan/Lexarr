/**
 * Orphan cleanup — identifies completed torrent downloads that *arr never
 * imported, cross-references them with qBittorrent and Sonarr/Radarr, and
 * produces a safety classification for the admin dashboard.
 *
 * Data source: /stack-health/orphan-state.txt (written by stack-healthcheck.sh)
 * Line format: category|folderName|unixTimestamp|scanCount
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { OrphanItem } from "@/types/dashboard";
import { getAllTorrents } from "./qbittorrent";
import { parse as sonarrParse } from "./sonarr";
import { parse as radarrParse } from "./radarr";

const HEALTH_DIR = process.env.STACK_HEALTH_DIR || "/stack-health";
const ORPHAN_STATE_FILE = join(HEALTH_DIR, "orphan-state.txt");

type OrphanCategory = "tv" | "movies" | "music" | "books";

interface ParsedLine {
  category: OrphanCategory;
  folderName: string;
  unixTs: number;
  scanCount: number;
}

export function parseOrphanStateLine(line: string): ParsedLine | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const parts = trimmed.split("|");
  if (parts.length < 4) return null;
  const [cat, folderName, tsStr, countStr] = parts;
  const validCategories: OrphanCategory[] = ["tv", "movies", "music", "books"];
  if (!validCategories.includes(cat as OrphanCategory)) return null;
  const unixTs = parseInt(tsStr, 10);
  const scanCount = parseInt(countStr, 10);
  if (isNaN(unixTs) || isNaN(scanCount) || !folderName) return null;
  return { category: cat as OrphanCategory, folderName, unixTs, scanCount };
}

async function readOrphanStateLines(): Promise<ParsedLine[]> {
  try {
    const raw = await fs.readFile(ORPHAN_STATE_FILE, "utf-8");
    return raw
      .split("\n")
      .map(parseOrphanStateLine)
      .filter((l): l is ParsedLine => l !== null);
  } catch {
    return [];
  }
}

/** Loosely match a qBit torrent name to an orphan folder name.
 *  Handles the common case where the folder uses dots as word separators
 *  (e.g. "Rick.and.Morty.S04E08") while qBit stores the display name with
 *  spaces ("Rick and Morty S04E08"). */
function matchTorrent(folderName: string, torrentName: string): boolean {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[._]/g, " ").replace(/\s+/g, " ").trim();
  const a = normalize(folderName);
  const b = normalize(torrentName);
  if (a === b) return true;
  const prefix = Math.min(a.length, b.length, 40);
  return a.slice(0, prefix) === b.slice(0, prefix);
}

async function checkArrHasFile(
  category: OrphanCategory,
  folderName: string,
): Promise<boolean | null> {
  if (category === "tv") {
    try {
      const result = await sonarrParse(folderName);
      if (!result?.episodes?.length) return null;
      return result.episodes[0].hasFile === true;
    } catch {
      return null;
    }
  }
  if (category === "movies") {
    try {
      const result = await radarrParse(folderName);
      if (!result?.movie) return null;
      return result.movie.hasFile === true;
    } catch {
      return null;
    }
  }
  // Music/books: Lidarr parse is unreliable for orphan folder names
  return null;
}

export async function listOrphans(): Promise<OrphanItem[]> {
  const lines = await readOrphanStateLines();
  if (lines.length === 0) return [];

  // Fetch all qBit torrents once (single round-trip for all orphans)
  const allTorrents = await getAllTorrents();

  const now = Date.now();

  const items = await Promise.all(
    lines.map(async (line): Promise<OrphanItem> => {
      const { category, folderName, unixTs, scanCount } = line;
      const daysStuck = Math.floor((now / 1000 - unixTs) / 86400);

      // Match to qBit torrent
      const torrent = allTorrents.find((t) =>
        matchTorrent(folderName, t.name),
      );

      const arrHasFile = await checkArrHasFile(category, folderName);

      return {
        folderName,
        category,
        daysStuck,
        scanCount,
        qbHash: torrent?.hash ?? null,
        qbState: torrent?.state ?? null,
        arrHasFile,
        safeToRemove: arrHasFile === true,
      };
    }),
  );

  return items;
}
