-- Add releaseType column to Request for narrow music-monitoring (singles/EPs)
ALTER TABLE "Request" ADD COLUMN "releaseType" TEXT;
