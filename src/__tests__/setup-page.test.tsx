/**
 * /setup is for admins: anyone else is sent home and never sees the guide.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const replace = vi.fn();
let sessionState: { data: { user: { role: string } } | null; status: string };

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("next-auth/react", () => ({ useSession: () => sessionState }));
vi.mock("@/components/setup/SetupGuide", () => ({ default: () => <div>the setup guide</div> }));

import SetupPage from "@/app/setup/page";

describe("/setup page", () => {
  beforeEach(() => replace.mockReset());
  afterEach(cleanup);

  it("shows the guide to an admin", () => {
    sessionState = { data: { user: { role: "admin" } }, status: "authenticated" };
    render(<SetupPage />);
    expect(screen.getByText("the setup guide")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("sends a regular user home without showing the guide", () => {
    sessionState = { data: { user: { role: "user" } }, status: "authenticated" };
    render(<SetupPage />);
    expect(screen.queryByText("the setup guide")).toBeNull();
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("waits for the session before deciding", () => {
    sessionState = { data: null, status: "loading" };
    render(<SetupPage />);
    expect(screen.queryByText("the setup guide")).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });
});
