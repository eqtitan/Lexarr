/**
 * Loaded with `node --require` in the production image (see Dockerfile).
 *
 * Next.js only fills in X-Forwarded-For when the client didn't send one, so
 * with no reverse proxy in front every forwarded header is client-chosen and
 * useless for rate limiting. This wraps http.createServer so every request
 * gets `x-lexarr-client-ip` set to the TCP peer address, overwriting
 * anything the client sent under that name, before Next.js sees it.
 * src/lib/rate-limit.ts reads it when LEXARR_CLIENT_IP_HEADER=1.
 */
/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS, loaded with node --require */
"use strict";
const http = require("node:http");

const HEADER = "x-lexarr-client-ip";
const originalCreateServer = http.createServer;

function stamp(listener) {
  return function stampedListener(req, res) {
    req.headers[HEADER] = (req.socket && req.socket.remoteAddress) || "";
    return listener.call(this, req, res);
  };
}

http.createServer = function createServer(...args) {
  const i = args.findIndex((a) => typeof a === "function");
  if (i >= 0) args[i] = stamp(args[i]);
  const server = originalCreateServer.apply(this, args);
  // Listeners attached later with server.on("request", ...) get the same.
  const originalOn = server.on;
  server.on = function on(event, listener) {
    if (event === "request" && typeof listener === "function") listener = stamp(listener);
    return originalOn.call(this, event, listener);
  };
  return server;
};

module.exports = { HEADER, stamp };
