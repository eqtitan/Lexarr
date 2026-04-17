import { describe, it, expect } from "vitest";
import { APP_VERSION, getChannel } from "@/lib/version";

describe("version", () => {
  it("APP_VERSION is a SemVer-ish string from package.json", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  describe("getChannel()", () => {
    it("returns 'beta' for 0.x versions", () => {
      expect(getChannel("0.1.0")).toBe("beta");
      expect(getChannel("0.7.0")).toBe("beta");
      expect(getChannel("0.99.99")).toBe("beta");
    });

    it("returns 'stable' for 1.x+ with no pre-release tag", () => {
      expect(getChannel("1.0.0")).toBe("stable");
      expect(getChannel("2.3.4")).toBe("stable");
    });

    it("returns 'alpha' for -alpha pre-release", () => {
      expect(getChannel("1.0.0-alpha")).toBe("alpha");
      expect(getChannel("1.0.0-alpha.3")).toBe("alpha");
      expect(getChannel("0.8.0-alpha.1")).toBe("alpha");
    });

    it("returns 'rc' for -rc pre-release", () => {
      expect(getChannel("1.0.0-rc")).toBe("rc");
      expect(getChannel("1.0.0-rc.2")).toBe("rc");
    });

    it("uses APP_VERSION when no argument is passed", () => {
      // Smoke test: must be one of the four channels
      const ch = getChannel();
      expect(["alpha", "beta", "rc", "stable"]).toContain(ch);
    });
  });
});
