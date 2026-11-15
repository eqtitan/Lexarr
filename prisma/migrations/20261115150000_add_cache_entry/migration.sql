-- Lookups worth keeping across restarts (MusicBrainz chart matches cost a
-- second each at MusicBrainz's rate limit, ~30s for a cold chart). Key is
-- namespaced ("mb:album:..."), value is JSON, rows past expiresAt are
-- ignored on read and swept on write by src/lib/persistent-cache.ts.
CREATE TABLE "CacheEntry" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL
);
CREATE INDEX "CacheEntry_expiresAt_idx" ON "CacheEntry"("expiresAt");
