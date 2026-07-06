-- Partial unique index that closes the residual race P-03 left open: two
-- concurrent transactions could both pass `checkDuplicate` and both insert,
-- producing duplicate active requests for the same media.
--
-- Why partial: a denied/cancelled request must NOT block a re-request, so
-- the constraint applies only to rows in active states. SQLite supports
-- WHERE clauses on CREATE UNIQUE INDEX since 3.8 — Prisma's @@unique can't
-- model this on SQLite, hence raw SQL.
--
-- Drift note: `prisma migrate diff` against the schema will see this index
-- and want to add a corresponding @@unique. DO NOT add one — Prisma will
-- generate `CREATE UNIQUE INDEX ... ON ...(...)` without the WHERE clause,
-- which breaks the denial/re-request workflow. If you regenerate
-- migrations, drop the auto-generated dup of this index from the diff
-- before committing.
--
-- Dedupe key for non-book media is (externalId, mediaType). For books the
-- same OpenLibrary work is legitimately requested as ebook AND audiobook,
-- so format is part of the key. NULL bookFormat (legacy pre-0.17 rows) is
-- treated as 'ebook' to match the app-level checkDuplicate logic.
CREATE UNIQUE INDEX "Request_active_dedupe_idx"
  ON "Request" ("externalId", "mediaType", COALESCE("bookFormat", 'ebook'))
  WHERE "status" NOT IN ('denied', 'cancelled');
