-- Add bookFormat column to Request so book requests can specify eBook vs Audiobook.
-- Null on existing rows means "unknown / legacy ebook" — handled as "ebook" in app code.
ALTER TABLE "Request" ADD COLUMN "bookFormat" TEXT;
