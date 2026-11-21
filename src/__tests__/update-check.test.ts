import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { updateCheckCache } from "@/lib/cache";

vi.mock("@/lib/version", () => ({ APP_VERSION: "0.31.0" }));

import { compareVersions, getUpdateStatus } from "@/lib/update-check";

function release(tag: string, htmlUrl?: string) {
  return new Response(
    JSON.stringify({ tag_name: tag, html_url: htmlUrl ?? `https://github.com/eqtitan/Lexarr/releases/tag/${tag}` }),
    { status: 200 },
  );
}

describe("compareVersions", () => {
  it("orders by major, minor, then patch", () => {
    expect(compareVersions("0.32.0", "0.31.0")).toBeGreaterThan(0);
    expect(compareVersions("0.31.1", "0.31.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.9.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("v0.31.0", "0.31.0")).toBe(0);
  });

  it("sorts a pre-release below its release and compares pre-release parts", () => {
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-rc.2", "1.0.0-rc.10")).toBeLessThan(0);
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
    expect(compareVersions("1.0.0-rc", "1.0.0-rc.1")).toBeLessThan(0);
  });

  it("ignores build metadata and returns null for non-SemVer input", () => {
    expect(compareVersions("1.0.0+abc", "1.0.0+def")).toBe(0);
    expect(compareVersions("latest", "0.31.0")).toBeNull();
    expect(compareVersions("0.31", "0.31.0")).toBeNull();
  });
});

describe("getUpdateStatus", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    updateCheckCache.delete("latest-release");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.LEXARR_UPDATE_CHECK;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LEXARR_UPDATE_CHECK;
  });

  it("reports an update when GitHub's latest release is newer", async () => {
    fetchMock.mockResolvedValue(release("v0.32.0"));
    const s = await getUpdateStatus();
    expect(s).toMatchObject({
      enabled: true,
      current: "0.31.0",
      latest: "0.32.0",
      updateAvailable: true,
      url: "https://github.com/eqtitan/Lexarr/releases/tag/v0.32.0",
    });
    expect(s.checkedAt).toEqual(expect.any(String));
  });

  it("reports no update when current or ahead of the latest release", async () => {
    fetchMock.mockResolvedValue(release("v0.31.0"));
    expect((await getUpdateStatus()).updateAvailable).toBe(false);
    updateCheckCache.delete("latest-release");
    fetchMock.mockResolvedValue(release("v0.30.3"));
    expect((await getUpdateStatus()).updateAvailable).toBe(false);
  });

  it("asks GitHub once and serves the cache afterwards", async () => {
    fetchMock.mockResolvedValue(release("v0.32.0"));
    await getUpdateStatus();
    await getUpdateStatus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/eqtitan/Lexarr/releases/latest");
    expect((init as RequestInit).headers).toMatchObject({ "User-Agent": "Lexarr/0.31.0" });
  });

  it("makes no request at all when LEXARR_UPDATE_CHECK=false", async () => {
    process.env.LEXARR_UPDATE_CHECK = "false";
    const s = await getUpdateStatus();
    expect(s).toMatchObject({ enabled: false, updateAvailable: false, latest: null, checkedAt: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats an empty LEXARR_UPDATE_CHECK (untouched .env.example line) as on", async () => {
    process.env.LEXARR_UPDATE_CHECK = "";
    fetchMock.mockResolvedValue(release("v0.32.0"));
    expect((await getUpdateStatus()).updateAvailable).toBe(true);
  });

  it("never links outside the project's releases page", async () => {
    fetchMock.mockResolvedValue(release("v0.32.0", "https://evil.example/download"));
    expect((await getUpdateStatus()).url).toBe("https://github.com/eqtitan/Lexarr/releases");
  });

  it.each([
    ["a network error", () => fetchMock.mockRejectedValue(new Error("offline"))],
    ["an HTTP error", () => fetchMock.mockResolvedValue(new Response("rate limited", { status: 403 }))],
    ["an unrecognised tag", () => fetchMock.mockResolvedValue(release("nightly"))],
    ["a malformed body", () => fetchMock.mockResolvedValue(new Response("not json", { status: 200 }))],
  ])("says no update, without throwing, after %s", async (_name, arrange) => {
    arrange();
    const s = await getUpdateStatus();
    expect(s).toMatchObject({ enabled: true, updateAvailable: false, latest: null });
  });

  it("remembers a failure so a down GitHub isn't hit on every call", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await getUpdateStatus();
    await getUpdateStatus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
