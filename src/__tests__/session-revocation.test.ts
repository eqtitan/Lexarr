/**
 * Session revocation via User.sessionVersion (the jwt callback in
 * src/lib/auth/config.ts). Returning null from the jwt callback makes
 * Auth.js clear the session cookie, so these assert on null vs token.
 *
 * NextAuth() is mocked to capture the config object so the callback can
 * be called directly.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

type JwtCallback = (args: {
  token: Record<string, unknown>;
  user?: Record<string, unknown>;
}) => Promise<Record<string, unknown> | null>;

let jwt: JwtCallback;

vi.mock("next-auth", () => ({
  default: (config: { callbacks: { jwt: JwtCallback } }) => {
    jwt = config.callbacks.jwt;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: (opts: unknown) => opts,
}));
vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/auth/jellyfin", () => ({ authenticateJellyfin: vi.fn() }));
vi.mock("@/lib/auth/plex", () => ({ getPlexUser: vi.fn(), isPlexEnabled: vi.fn() }));

beforeAll(async () => {
  await import("@/lib/auth/config");
});

beforeEach(() => vi.clearAllMocks());

async function dbVersion(v: number | null) {
  const { prisma } = await import("@/lib/db");
  vi.mocked(prisma.user.findUnique).mockResolvedValue(
    (v === null ? null : { sessionVersion: v }) as never,
  );
}

describe("jwt callback session revocation", () => {
  it("stamps the user's sessionVersion into the token at sign-in", async () => {
    const token = await jwt({ token: {}, user: { id: "u1", sessionVersion: 3 } });
    expect(token).toMatchObject({ userId: "u1", sessionVersion: 3 });
  });

  it("keeps a session whose version matches", async () => {
    await dbVersion(3);
    const token = await jwt({ token: { userId: "u1", sessionVersion: 3 } });
    expect(token).not.toBeNull();
  });

  it("signs out a session issued before a password reset / role change", async () => {
    await dbVersion(4);
    expect(await jwt({ token: { userId: "u1", sessionVersion: 3 } })).toBeNull();
  });

  it("signs out a session whose user was deleted", async () => {
    await dbVersion(null);
    expect(await jwt({ token: { userId: "gone", sessionVersion: 0 } })).toBeNull();
  });

  it("keeps legacy tokens from before sessionVersion existed (treated as 0)", async () => {
    // Rolling this out must not log everybody out.
    await dbVersion(0);
    expect(await jwt({ token: { userId: "u1" } })).not.toBeNull();
  });

  it("but signs out a legacy token once that user's version has been bumped", async () => {
    await dbVersion(1);
    expect(await jwt({ token: { userId: "u1" } })).toBeNull();
  });
});
