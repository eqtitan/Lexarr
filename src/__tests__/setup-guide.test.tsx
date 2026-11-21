/**
 * The setup guide's flow: step navigation, skipping, finishing, and what
 * the webhook step shows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const push = vi.fn();
const apiSend = vi.fn();
let setupInfo: Record<string, unknown> | undefined;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/admin/settings/NotificationChannelsSection", () => ({
  default: () => <div>notification channels section</div>,
}));
vi.mock("@/components/admin/settings/UpdateNoticeSection", () => ({
  default: () => <div>update notices section</div>,
}));
vi.mock("@/lib/use-api", () => ({
  apiSend: (...args: unknown[]) => apiSend(...args),
  failure: (action: string, err: unknown) => `${action} failed — ${err instanceof Error ? err.message : "unknown error"}`,
  useApi: (url: string) => {
    if (url === "/api/admin/readiness") {
      return {
        data: {
          status: "warn",
          generatedAt: "",
          checks: [
            { id: "radarr", group: "Services", label: "Radarr", status: "ok", detail: "Reachable" },
            { id: "lidarr", group: "Services", label: "Lidarr", status: "fail", detail: "Unreachable", fix: "Check ARR_HOST." },
            { id: "stack-health", group: "Services", label: "Stack health report", status: "warn", detail: "No report found" },
            { id: "csp", group: "Security", label: "CSP", status: "ok", detail: "Enforced" },
          ],
        },
        isValidating: false,
        mutate: vi.fn(),
      };
    }
    return { data: setupInfo };
  },
}));

import SetupGuide from "@/components/setup/SetupGuide";

const next = () => fireEvent.click(screen.getByRole("button", { name: /^(Start|Next)$/ }));

describe("SetupGuide", () => {
  beforeEach(() => {
    push.mockReset();
    apiSend.mockReset().mockResolvedValue({});
    setupInfo = { webhookSecretSet: true, registrationOpen: false, plexEnabled: false, jellyfinEnabled: true };
  });
  afterEach(cleanup);

  it("starts on the welcome step and steps forward and back", () => {
    render(<SetupGuide />);
    expect(screen.getByText(/step 1 of 7/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    next();
    expect(screen.getByText(/step 2 of 7/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText(/step 1 of 7/i)).toBeTruthy();
  });

  it("shows only the service checks on the connections step, with the fix for a failing one", () => {
    render(<SetupGuide />);
    next();
    expect(screen.getByText("Radarr")).toBeTruthy();
    expect(screen.getByText("Lidarr")).toBeTruthy();
    expect(screen.getByText("Check ARR_HOST.")).toBeTruthy();
    expect(screen.queryByText("Stack health report")).toBeNull();
    expect(screen.queryByText("CSP")).toBeNull();
  });

  it("walks every step to the end and finishing saves 'completed' and goes home", async () => {
    render(<SetupGuide />);
    for (let i = 0; i < 6; i++) next();
    expect(screen.getByText(/step 7 of 7/i)).toBeTruthy();
    expect(screen.queryByText("Skip setup")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(apiSend).toHaveBeenCalledWith("/api/admin/setup", "PUT", { status: "completed" });
  });

  it("'Skip setup' from any step saves 'skipped' and goes home", async () => {
    render(<SetupGuide />);
    next();
    fireEvent.click(screen.getByText("Skip setup"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(apiSend).toHaveBeenCalledWith("/api/admin/setup", "PUT", { status: "skipped" });
  });

  it("stays on the page and says so when saving fails", async () => {
    apiSend.mockRejectedValue(new Error("boom"));
    render(<SetupGuide />);
    fireEvent.click(screen.getByText("Skip setup"));
    expect(await screen.findByText("Saving failed — boom")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("webhook step: shows this site's webhook URLs and warns when the secret is missing", async () => {
    setupInfo = { webhookSecretSet: false };
    render(<SetupGuide />);
    for (let i = 0; i < 4; i++) next();
    expect(screen.getByText(/isn.t set, so Lexarr will reject webhook calls/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(`${window.location.origin}/api/webhooks/sonarr`)).toBeTruthy());
    expect(screen.getByText(`${window.location.origin}/api/webhooks/radarr`)).toBeTruthy();
    expect(screen.getByText(`${window.location.origin}/api/webhooks/lidarr`)).toBeTruthy();
  });

  it("sign-in step reflects the server's settings", () => {
    setupInfo = { registrationOpen: true, plexEnabled: true, jellyfinEnabled: false };
    render(<SetupGuide />);
    next();
    next();
    expect(screen.getByText(/Open sign-up: on/)).toBeTruthy();
    expect(screen.getByText(/Plex sign-in: on/)).toBeTruthy();
    expect(screen.getByText(/Jellyfin sign-in: off/)).toBeTruthy();
  });
});
