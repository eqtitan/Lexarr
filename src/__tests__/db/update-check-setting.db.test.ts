/**
 * The update-notice opt-in against a real SQLite DB: off until chosen,
 * and the choice survives being read back.
 */
import { useTestDb } from "../helpers/test-db";
import { describe, it, expect } from "vitest";
import { getUpdateCheckEnabled, setUpdateCheckEnabled } from "@/lib/settings";

useTestDb();

describe("updates.check setting", () => {
  it("is off until an admin turns it on", async () => {
    expect(await getUpdateCheckEnabled()).toBe(false);
  });

  it("persists on and off", async () => {
    await setUpdateCheckEnabled(true);
    expect(await getUpdateCheckEnabled()).toBe(true);
    await setUpdateCheckEnabled(false);
    expect(await getUpdateCheckEnabled()).toBe(false);
  });
});
