#!/usr/bin/env node
/**
 * EAS Build pre-install hook for the VoyceLab Expo app.
 *
 * Why this exists:
 *   EAS Build uploads the entire pnpm monorepo to a macOS worker, runs
 *   `pnpm install --frozen-lockfile` at the workspace root, and that fails
 *   with EACCES on `mkdir 'artifacts/square-voice-agent/node_modules'` (and
 *   similar for other workspace packages). This is a known EAS issue; pnpm
 *   workspace symlinking does not survive the worker's filesystem layout.
 *
 * Strategy:
 *   - Run as `expo` on the build worker (workingdir is /Users/expo/workingdir/build).
 *   - Print diagnostics so we can see ownership/permission state.
 *   - chmod -R u+rwX everywhere we can to clear any read-only bits that survived
 *     the upload (Windows / OneDrive can introduce these).
 *   - Demote the repo from a pnpm workspace to a single-package install:
 *       * delete pnpm-workspace.yaml
 *       * replace the root package.json with an empty stub
 *     Once the workspace markers are gone, EAS's auto-install will run
 *     `pnpm install --frozen-lockfile` directly in this Expo package's
 *     project directory instead of recursively across all workspace packages.
 *   - Generate a fresh, single-package pnpm-lock.yaml inside the Expo app
 *     directory so EAS's auto-install with --frozen-lockfile succeeds.
 *
 * Notes:
 *   - We use --ignore-scripts: EAS's auto-install (run after this hook) is the
 *     only place lifecycle scripts should execute.
 *   - We use --no-frozen-lockfile: pnpm needs to be able to write the lockfile.
 *   - The script is intentionally tolerant: if pnpm or the workspace markers
 *     aren't present, we exit 0 so EAS can fall back to its default behavior.
 *   - All `catalog:` references in this Expo package's package.json have
 *     already been resolved to explicit versions, so --ignore-workspace is safe.
 */
"use strict";

const { execSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const projectDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(projectDir, "..", "..");
const lockfilePath = path.join(repoRoot, "pnpm-lock.yaml");
const workspaceFilePath = path.join(repoRoot, "pnpm-workspace.yaml");
const rootPackageJsonPath = path.join(repoRoot, "package.json");
const projectLockfilePath = path.join(projectDir, "pnpm-lock.yaml");

function log(line) {
  process.stdout.write("[eas-pre-install] " + line + "\n");
}

function safeExec(cmd, options) {
  try {
    execSync(cmd, Object.assign({ stdio: "inherit" }, options || {}));
    return true;
  } catch (err) {
    log("Command failed: " + cmd);
    log(err && err.message ? err.message : String(err));
    return false;
  }
}

function printStat(p) {
  try {
    const st = fs.statSync(p);
    const mode = (st.mode & 0o777).toString(8);
    log("stat " + p + " -> mode=" + mode + " uid=" + st.uid + " gid=" + st.gid + " isDir=" + st.isDirectory());
  } catch (err) {
    log("stat " + p + " -> error: " + (err && err.message ? err.message : err));
  }
}

if (process.env.EAS_BUILD !== "true") {
  log("Not running on EAS Build (EAS_BUILD != 'true'); skipping.");
  process.exit(0);
}

log("uid=" + (process.getuid ? process.getuid() : "?") + " user=" + (os.userInfo().username || "?"));
log("projectDir = " + projectDir);
log("repoRoot   = " + repoRoot);

if (!fs.existsSync(workspaceFilePath) && !fs.existsSync(rootPackageJsonPath)) {
  log("No pnpm-workspace.yaml or root package.json; nothing to prepare.");
  process.exit(0);
}

if (fs.existsSync(repoRoot)) {
  try {
    const top = fs.readdirSync(repoRoot).sort().join(", ");
    log("repoRoot contents: " + top);
  } catch (err) {
    log("Could not list repoRoot: " + (err && err.message ? err.message : err));
  }
}

printStat(repoRoot);
printStat(projectDir);
printStat(path.join(repoRoot, "artifacts"));

log("Running: chmod -R u+rwX " + repoRoot);
safeExec("chmod -R u+rwX " + JSON.stringify(repoRoot));

const probeNodeModules = path.join(projectDir, "node_modules");
log("Probing write access by creating " + probeNodeModules);
try {
  fs.mkdirSync(probeNodeModules, { recursive: true });
  log("mkdir node_modules OK");
} catch (err) {
  log("mkdir node_modules FAILED: " + (err && err.message ? err.message : err));
}

if (fs.existsSync(workspaceFilePath)) {
  log("Removing pnpm-workspace.yaml so EAS treats this as a single-package install.");
  try {
    fs.rmSync(workspaceFilePath, { force: true });
  } catch (err) {
    log("Could not remove pnpm-workspace.yaml: " + (err && err.message ? err.message : err));
  }
}

if (fs.existsSync(rootPackageJsonPath)) {
  log("Replacing root package.json with an empty stub (no workspace deps).");
  try {
    fs.writeFileSync(
      rootPackageJsonPath,
      JSON.stringify(
        {
          name: "voycelab-monorepo-eas-stub",
          private: true,
          version: "0.0.0",
        },
        null,
        2,
      ) + "\n",
    );
  } catch (err) {
    log("Could not replace root package.json: " + (err && err.message ? err.message : err));
  }
}

if (fs.existsSync(lockfilePath)) {
  log("Removing stale repo-root pnpm-lock.yaml.");
  try {
    fs.rmSync(lockfilePath, { force: true });
  } catch (err) {
    log("Could not remove repo-root lockfile: " + (err && err.message ? err.message : err));
  }
}

if (fs.existsSync(projectLockfilePath)) {
  log("Removing stale project pnpm-lock.yaml so it can be regenerated cleanly.");
  try {
    fs.rmSync(projectLockfilePath, { force: true });
  } catch (err) {
    log("Could not remove project lockfile: " + (err && err.message ? err.message : err));
  }
}

log("Generating standalone pnpm-lock.yaml inside " + projectDir);
const installResult = spawnSync(
  "pnpm",
  [
    "install",
    "--ignore-workspace",
    "--no-frozen-lockfile",
    "--ignore-scripts",
    "--config.node-linker=hoisted",
    "--config.shamefully-hoist=true",
  ],
  {
    cwd: projectDir,
    stdio: "inherit",
    env: process.env,
  },
);

if (installResult.status !== 0) {
  log("pnpm install in projectDir failed with status " + installResult.status);
  if (installResult.error) {
    log("error: " + installResult.error.message);
  }
  process.exit(installResult.status || 1);
}

if (fs.existsSync(projectLockfilePath)) {
  const stat = fs.statSync(projectLockfilePath);
  log(
    "Standalone pnpm-lock.yaml written at " +
      projectLockfilePath +
      " (" +
      stat.size +
      " bytes). EAS auto-install can now run --frozen-lockfile.",
  );
} else {
  log("WARNING: projectDir lockfile not found after install; EAS may regenerate it.");
}
