#!/usr/bin/env node
/**
 * Lexarr release helper.
 *
 * Usage:
 *   npm run release -- patch     # 0.5.0 → 0.5.1
 *   npm run release -- minor     # 0.5.0 → 0.6.0
 *   npm run release -- major     # 0.5.0 → 1.0.0 (only after 1.0 goal is met)
 *   npm run release -- 0.6.2     # explicit version
 *   npm run release -- --dry     # preview what would happen
 *
 * What it does:
 *   1. Reads package.json version
 *   2. Bumps per the argument
 *   3. Gathers commits since the previous tag
 *   4. Inserts a [Unreleased] → [x.y.z] block in CHANGELOG.md
 *   5. Commits the bump as "chore: release vX.Y.Z"
 *   6. Creates an annotated git tag vX.Y.Z
 *   7. Prints the commands to build the Docker image + push the tag
 *
 * Does NOT push to git or build Docker automatically — those are two manual
 * steps so you can review before shipping.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const bumpArg = args.find((a) => !a.startsWith("--"));

if (!bumpArg) {
  console.error("Usage: npm run release -- <patch|minor|major|x.y.z> [--dry]");
  process.exit(1);
}

// --- Load current version -------------------------------------------------
const pkgPath = join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const [curMajor, curMinor, curPatch] = pkg.version.split(".").map(Number);

// --- Compute next version -------------------------------------------------
let next;
if (/^\d+\.\d+\.\d+$/.test(bumpArg)) {
  next = bumpArg;
} else if (bumpArg === "patch") {
  next = `${curMajor}.${curMinor}.${curPatch + 1}`;
} else if (bumpArg === "minor") {
  next = `${curMajor}.${curMinor + 1}.0`;
} else if (bumpArg === "major") {
  next = `${curMajor + 1}.0.0`;
} else {
  console.error(`Invalid bump: ${bumpArg}`);
  process.exit(1);
}

console.log(`${pkg.version}  →  ${next}${dryRun ? "  (dry run)" : ""}`);

// --- Gather commits since previous tag ------------------------------------
let commits = "";
try {
  const lastTag = execSync("git describe --tags --abbrev=0", {
    cwd: root,
    encoding: "utf-8",
  }).trim();
  commits = execSync(`git log ${lastTag}..HEAD --format="- %s (%h)"`, {
    cwd: root,
    encoding: "utf-8",
  }).trim();
  console.log(`\nCommits since ${lastTag}:`);
} catch {
  commits = execSync(`git log --format="- %s (%h)"`, {
    cwd: root,
    encoding: "utf-8",
  }).trim();
  console.log(`\nCommits (no previous tag):`);
}
console.log(commits || "  (none)");

if (!commits) {
  console.error("\nNothing to release — no commits since last tag.");
  process.exit(1);
}

// --- Classify commits per Conventional Commits ----------------------------
const categories = {
  "### Added": [],
  "### Fixed": [],
  "### Changed": [],
  "### Removed": [],
  "### Security": [],
  "### Chore": [],
};
for (const line of commits.split("\n")) {
  if (/^- (feat|feature)[(:]/i.test(line)) categories["### Added"].push(line);
  else if (/^- fix[(:]/i.test(line)) categories["### Fixed"].push(line);
  else if (/^- (refactor|perf|style)[(:]/i.test(line))
    categories["### Changed"].push(line);
  else if (/^- (remove|revert)[(:]/i.test(line))
    categories["### Removed"].push(line);
  else if (/^- sec(urity)?[(:]/i.test(line))
    categories["### Security"].push(line);
  else categories["### Chore"].push(line);
}

// --- Build CHANGELOG entry ------------------------------------------------
const today = new Date().toISOString().slice(0, 10);
let entry = `## [${next}] — ${today}\n\n`;
for (const [heading, lines] of Object.entries(categories)) {
  if (lines.length === 0) continue;
  entry += `${heading}\n${lines.join("\n")}\n\n`;
}

console.log(`\n--- CHANGELOG entry preview ---\n${entry}`);

if (dryRun) {
  console.log("Dry run — no changes written.");
  console.log(`\nNext steps (not executed):`);
  console.log(`  npm run release -- ${bumpArg}`);
  console.log(`  docker build -t lexarr:${next} -t lexarr:latest .`);
  process.exit(0);
}

// --- Write package.json ---------------------------------------------------
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// --- Write CHANGELOG.md ---------------------------------------------------
const changelogPath = join(root, "CHANGELOG.md");
const changelog = readFileSync(changelogPath, "utf-8");
const updated = changelog.replace(
  /## \[Unreleased\]\s*\n/,
  `## [Unreleased]\n\n${entry}`,
);
writeFileSync(changelogPath, updated);

// --- Git commit + tag -----------------------------------------------------
execSync("git add package.json CHANGELOG.md", { cwd: root, stdio: "inherit" });
execSync(`git commit -m "chore: release v${next}"`, {
  cwd: root,
  stdio: "inherit",
});
execSync(`git tag -a v${next} -m "Release v${next}"`, {
  cwd: root,
  stdio: "inherit",
});

console.log(`\n✓ Tagged v${next}`);
console.log(`\nNext steps:`);
console.log(`  1. Review the commit:   git show HEAD`);
console.log(`  2. Build Docker image:  docker build -t lexarr:${next} -t lexarr:latest .`);
console.log(`  3. Push when ready:     git push origin master && git push origin v${next}`);
