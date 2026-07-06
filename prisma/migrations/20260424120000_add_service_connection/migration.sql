-- P-06: ServiceConnection — DB-backed BYO service config with encrypted secrets at rest.
-- The column `config` is stored as TEXT (JSON-encoded) because the sqlite connector
-- does not support Prisma's native Json type. Callers JSON.parse on read / stringify
-- on write — same pattern as AppSetting.value and PipelineEvent.detail.
-- The column `encryptedSecret` holds base64( iv(12) || authTag(16) || ciphertext )
-- produced by src/lib/crypto.ts (AES-256-GCM).

-- CreateTable
CREATE TABLE "ServiceConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "config" TEXT NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ServiceConnection_enabled_idx" ON "ServiceConnection"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceConnection_category_kind_name_key" ON "ServiceConnection"("category", "kind", "name");
