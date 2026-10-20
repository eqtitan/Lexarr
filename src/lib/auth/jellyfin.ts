import { env } from "@/lib/env";
const jellyfinUrl = () => env().JELLYFIN_URL || "http://localhost:8096";

export async function authenticateJellyfin(username: string, password: string) {
  const res = await fetch(`${jellyfinUrl()}/Users/AuthenticateByName`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Emby-Authorization": `MediaBrowser Client="Lexarr", Device="Web", DeviceId="lexarr-web", Version="1.0.0"`,
    },
    body: JSON.stringify({ Username: username, Pw: password }),
  });

  if (!res.ok) return null;
  const data = await res.json();

  return {
    jellyfinId: data.User?.Id,
    name: data.User?.Name,
    accessToken: data.AccessToken,
    avatar: data.User?.PrimaryImageTag
      ? `${jellyfinUrl()}/Users/${data.User.Id}/Images/Primary`
      : undefined,
  };
}
