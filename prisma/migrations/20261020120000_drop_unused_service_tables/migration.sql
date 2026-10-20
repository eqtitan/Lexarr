-- P-06 removal (decided 2026-10-20): ServiceConnection (encrypted
-- per-service config, never wired to any client) and ServiceConfig (legacy,
-- unused) are dropped. Both were empty on the reference deployment; config
-- comes from the environment (src/lib/env.ts).

-- DropTable
DROP TABLE "ServiceConnection";

-- DropTable
DROP TABLE "ServiceConfig";
