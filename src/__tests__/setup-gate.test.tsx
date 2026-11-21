/**
 * The setup guide opens by itself for an admin on a new or reset install,
 * once per browser session, and never for anyone else or while already on it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

const replace = vi.fn();
let pathname = "/";
let session: { user: { role: string } } | null = { user: { role: "admin" } };
let setupInfo: { autoLaunch: boolean } | undefined = { autoLaunch: true };

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace }),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: session }) }));
vi.mock("@/lib/use-api", () => ({
  useApi: (url: string | null) => ({ data: url ? setupInfo : undefined }),
}));

import SetupGate from "@/components/setup/SetupGate";

describe("SetupGate", () => {
  beforeEach(() => {
    replace.mockReset();
    sessionStorage.clear();
    pathname = "/";
    session = { user: { role: "admin" } };
    setupInfo = { autoLaunch: true };
  });
  afterEach(cleanup);

  it("sends an admin on a new install to /setup", () => {
    render(<SetupGate />);
    expect(replace).toHaveBeenCalledWith("/setup");
  });

  it("does so once per browser session, not on every visit", () => {
    const first = render(<SetupGate />);
    first.unmount();
    render(<SetupGate />);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the guide shouldn't open by itself", () => {
    setupInfo = { autoLaunch: false };
    render(<SetupGate />);
    expect(replace).not.toHaveBeenCalled();
  });

  it("does nothing for a regular user (and never asks the admin-only API)", () => {
    session = { user: { role: "user" } };
    render(<SetupGate />);
    expect(replace).not.toHaveBeenCalled();
  });

  it.each(["/setup", "/login"])("does nothing while already on %s", (p) => {
    pathname = p;
    render(<SetupGate />);
    expect(replace).not.toHaveBeenCalled();
  });
});
