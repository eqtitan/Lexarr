-- Migration: add tracking columns to Request table
-- Run on Unraid: sqlite3 /path/to/lexarr.db < add_tracking_columns.sql

ALTER TABLE "Request" ADD COLUMN "torrentHash"   TEXT;
ALTER TABLE "Request" ADD COLUMN "lastCheckedAt" DATETIME;
ALTER TABLE "Request" ADD COLUMN "qaPassed"      BOOLEAN;
ALTER TABLE "Request" ADD COLUMN "qaCheckedAt"   DATETIME;
ALTER TABLE "Request" ADD COLUMN "source"        TEXT NOT NULL DEFAULT 'lexarr';

CREATE INDEX IF NOT EXISTS "Request_source_idx" ON "Request"("source");
