#!/usr/bin/env node
/**
 * EAS Build pre-install hook.
 *
 * Why this exists:
 * - The repo is a pnpm monorepo. Locally, `pnpm install` at the workspace
 *   root produces a lockfile that lists every workspace importer
 *   (api-server, voycelab-landing, etc.).
 * - On EAS Build, only `artifacts/square-voice-agent` is uploaded (see the
 *   repo-root `.easignore`). The wider workspace lockfile is also excluded
 *   from the upload — if it weren't, EAS's `pnpm install --frozen-lockfile`
 *   would fail with "lockfile is out of sync" because most importers no
 *   longer exist on disk.
 * - This script regenerates a clean lockfile against the slimmed-down
 *   workspace before EAS runs its own install. After this script finishes,
 *   `pnpm-lock.yaml` exists at the workspace root, lists only this Expo
 *   package, and EAS's auto-install completes successfully.
 *
 * Notes:
 * - We run with `--ignore-scripts` so the EAS auto-install (which runs after
 *   us) is the only place lifecycle scripts execute.
 * - We use `--no-frozen-lockfile` so pnpm is allowed to write the lockfile.
 * - The script is intentionally tolerant: if pnpm or the workspace markers
 *   aren't present, we exit 0 so EAS can fall back to its default behavior.
 */
"use strict";

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(projectDir, "..", "..");
const lockfilePath = path.join(repoRoot, "pnpm-lock.yaml");
const workspaceFilePath = path.join(repoRoot, "pnpm-workspace.yaml");

function log(line) {
  process.stdout.write(`[eas-pre-install] ${line}\n`);
}

if (process.env.EAS_BUILD !== "true") {
  log("Not running on EAS Build (EAS_BUILD != 'true'); skipping.");
  process.exit(0);
}

log(`projectDir = ${projectDir}`);
log(`repoRoot   = ${repoRoot}`);

if (!fs.existsSync(workspaceFilePath)) {
  log("No pnpm-workspace.yaml at repo root; nothing to prepare.");
  process.exit(0);
}

if (fs.existsSync(repoRoot)) {
  try {
    const top = fs.readdirSync(repoRoot).sort().join(", ");
    log(`repoRoot contents: ${top}`);
  } catch (err) {
    log(`Could not list repoRoot: ${err && err.message ? err.message : err}`);
  }
}

if (fs.existsSync(lockfilePath)) {
  log("Removing stale pnpm-lock.yaml so the regen below produces a fresh one.");
  try {
    fs.rmSync(lockfilePath, { force: true });
  } catch (err) {
    log(`Could not remove lockfile: ${err && err.message ? err.message : err}`);
  }
} else {
  log("No pnpm-lock.yaml present; will be generated next.");
}

log("Running: pnpm install --no-frozen-lockfile --ignore-scripts");
try {
  execSync("pnpm install --no-frozen-lockfile --ignore-scripts", {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
} catch (err) {
  log("pnpm install failed during pre-install.");
  log(err && err.message ? err.message : String(err));
  process.exit(1);
}

if (fs.existsSync(lockfilePath)) {
  const stat = fs.statSync(lockfilePath);
  log(`Fresh pnpm-lock.yaml written (${stat.size} bytes). EAS auto-install can now run --frozen-lockfile.`);
} else {
  log("WARNING: pnpm-lock.yaml not found after install; EAS may regenerate it.");
}
