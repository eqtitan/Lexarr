/**
 * Vitest globalSetup: migrate one template SQLite DB per test run. Each
 * real-DB test file copies it (helpers/test-db.ts) instead of running every
 * migration itself, so a file's DB setup costs a file copy, not ~2s.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    dbTemplate: string;
  }
}

export default function setup(project: TestProject) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lexarr-vitest-"));
  const template = path.join(dir, "template.db").replace(/\\/g, "/");
  execSync("npx prisma migrate deploy", {
    cwd: path.resolve(__dirname, "../../.."),
    env: { ...process.env, DATABASE_URL: `file:${template}` },
    stdio: "pipe",
  });
  project.provide("dbTemplate", template);

  return () => {
    fs.rmSync(dir, { recursive: true, force: true });
  };
}
