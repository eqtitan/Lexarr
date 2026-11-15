export const WEBHOOK_URL_ERROR = "Webhook URL must be a full http:// or https:// address";

/** Only http(s) URLs: Lexarr POSTs to a notification channel's address from
 *  the server, so file:, data:, gopher: and the like have no business here. */
export function isWebhookUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 2000) return false;
  try {
    const u = new URL(value);
    return (u.protocol === "https:" || u.protocol === "http:") && !!u.hostname;
  } catch {
    return false;
  }
}
