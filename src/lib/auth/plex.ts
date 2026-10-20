const PLEX_AUTH_URL = "https://app.plex.tv/auth#";
const PLEX_API = "https://plex.tv";
const CLIENT_ID = process.env.PLEX_CLIENT_ID || "lexarr";
const PRODUCT = "Lexarr";

/**
 * Whether Plex sign-in is turned on. The login page only shows the Plex
 * button when this is true (see /api/config), but until now nothing
 * server-side enforced it — the pin endpoints and the NextAuth "plex"
 * provider worked on every install regardless of the flag. Call this at
 * the top of each of those so Plex is fully inert, not just hidden,
 * when the operator hasn't opted in.
 */
export function isPlexEnabled(): boolean {
  return process.env.AUTH_PLEX_ENABLED === "true";
}

export function getPlexAuthUrl(forwardUrl: string) {
  const params = new URLSearchParams({
    clientID: CLIENT_ID,
    "context[device][product]": PRODUCT,
    forwardUrl,
    code: "", // will be replaced with pin
  });
  return `${PLEX_AUTH_URL}?${params}`;
}

export async function createPlexPin() {
  const res = await fetch(`${PLEX_API}/api/v2/pins`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "X-Plex-Client-Identifier": CLIENT_ID,
      "X-Plex-Product": PRODUCT,
    },
    body: new URLSearchParams({ strong: "true" }),
  });
  if (!res.ok) throw new Error("Failed to create Plex pin");
  return res.json() as Promise<{ id: number; code: string }>;
}

export async function checkPlexPin(pinId: number) {
  const res = await fetch(`${PLEX_API}/api/v2/pins/${pinId}`, {
    headers: {
      Accept: "application/json",
      "X-Plex-Client-Identifier": CLIENT_ID,
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.authToken || null;
}

export async function getPlexUser(authToken: string) {
  const res = await fetch(`${PLEX_API}/api/v2/user`, {
    headers: {
      Accept: "application/json",
      "X-Plex-Token": authToken,
    },
  });
  if (!res.ok) throw new Error("Failed to get Plex user");
  const user = await res.json();
  return {
    plexId: String(user.id),
    name: user.title || user.username,
    email: user.email,
    avatar: user.thumb,
  };
}
