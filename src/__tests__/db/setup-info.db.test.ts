/**
 * When the first-run setup guide opens by itself, against a real SQLite DB:
 * only on a new or reset install (never finished or skipped, and no
 * requests yet), so an install that upgrades is never interrupted.
 */
import { useTestDb, testPrisma } from "../helpers/test-db";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getSetupInfo } from "@/lib/setup";
import { getSetupStatus, setSetupStatus } from "@/lib/settings";

useTestDb();

async function seedRequest() {
  const prisma = await testPrisma();
  const user = await prisma.user.create({ data: { name: "someone" } });
  await prisma.request.create({
    data: { userId: user.id, mediaType: "movie", externalId: "1", title: "A Movie" },
  });
}

describe("setup guide state", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.LEXARR_WEBHOOK_SECRET;
    delete process.env.REGISTRATION_OPEN;
    delete process.env.AUTH_PLEX_ENABLED;
    delete process.env.AUTH_JELLYFIN_ENABLED;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("is pending, and opens by itself, on a fresh database", async () => {
    expect(await getSetupStatus()).toBe("pending");
    expect(await getSetupInfo()).toMatchObject({ status: "pending", autoLaunch: true });
  });

  it("does not open by itself once any request exists (an existing install)", async () => {
    await seedRequest();
    expect(await getSetupInfo()).toMatchObject({ status: "pending", autoLaunch: false });
  });

  it.each(["completed", "skipped"] as const)("does not open by itself once %s", async (status) => {
    await setSetupStatus(status);
    expect(await getSetupStatus()).toBe(status);
    expect(await getSetupInfo()).toMatchObject({ status, autoLaunch: false });
  });

  it("returns whether the webhook secret is set, never its value", async () => {
    process.env.LEXARR_WEBHOOK_SECRET = "s3cret-value";
    const info = await getSetupInfo();
    expect(info.webhookSecretSet).toBe(true);
    expect(JSON.stringify(info)).not.toContain("s3cret-value");
  });

  it("reports the sign-in options from the environment", async () => {
    expect(await getSetupInfo()).toMatchObject({ registrationOpen: false, plexEnabled: false, jellyfinEnabled: true });
    process.env.REGISTRATION_OPEN = "true";
    process.env.AUTH_PLEX_ENABLED = "true";
    process.env.AUTH_JELLYFIN_ENABLED = "false";
    expect(await getSetupInfo()).toMatchObject({ registrationOpen: true, plexEnabled: true, jellyfinEnabled: false });
  });
});
