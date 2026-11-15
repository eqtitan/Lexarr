// @vitest-environment node
/**
 * scripts/client-ip-preload.cjs: every request reaching the app carries the
 * real TCP peer in x-lexarr-client-ip, whatever the client sent.
 */
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("../../scripts/client-ip-preload.cjs");

let server: http.Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

function get(port: number, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: "/", headers }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve(body));
      })
      .on("error", reject);
  });
}

async function listen(s: http.Server): Promise<number> {
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return (s.address() as AddressInfo).port;
}

describe("client IP hook", () => {
  it("overwrites a spoofed x-lexarr-client-ip with the real peer address", async () => {
    server = http.createServer((req, res) => res.end(String(req.headers["x-lexarr-client-ip"])));
    const port = await listen(server);
    const seen = await get(port, { "x-lexarr-client-ip": "6.6.6.6", "x-forwarded-for": "7.7.7.7" });
    expect(seen.replace(/^::ffff:/, "")).toBe("127.0.0.1");
  });

  it("also covers request listeners attached with server.on", async () => {
    server = http.createServer();
    server.on("request", (req, res) => res.end(String(req.headers["x-lexarr-client-ip"])));
    const port = await listen(server);
    expect((await get(port, { "x-lexarr-client-ip": "6.6.6.6" })).replace(/^::ffff:/, "")).toBe("127.0.0.1");
  });
});
