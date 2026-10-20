-- Session revocation: User.sessionVersion is copied into the JWT at sign-in
-- and compared on every request; bumping it (password reset, role change)
-- signs out every existing session for that user. Default 0 matches tokens
-- issued before this column existed, so deploying it logs nobody out.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
