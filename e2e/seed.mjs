// Fresh SQLite DB for the end-to-end run: apply every migration, then seed
// one admin and one regular user. Runs right before `next start` (see the
// webServer command in playwright.config.ts) with DATABASE_URL pointing at
// e2e/.tmp/e2e.db, so each run starts from a clean slate.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

export const USERS = {
  admin: { name: "e2e-admin", password: "admin-pass-123" },
  user: { name: "alice", password: "alice-pass-123" },
};

const url = process.env.DATABASE_URL;
if (!url?.startsWith("file:")) throw new Error("seed.mjs needs a file: DATABASE_URL");
const dbFile = url.slice("file:".length);

fs.mkdirSync(path.dirname(dbFile), { recursive: true });
for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`, `${dbFile}-journal`]) {
  fs.rmSync(f, { force: true });
}

execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

const prisma = new PrismaClient();
await prisma.user.create({
  data: {
    name: USERS.admin.name,
    password: bcrypt.hashSync(USERS.admin.password, 10),
    role: "admin",
    autoApprove: true,
  },
});
await prisma.user.create({
  data: {
    name: USERS.user.name,
    password: bcrypt.hashSync(USERS.user.password, 10),
    role: "user",
    autoApprove: false,
  },
});
await prisma.$disconnect();
console.log(`e2e DB seeded at ${dbFile}`);
