#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function run(command, args, { cwd, env, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: env ?? process.env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed with exit ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join("\n"));
  }
  return result;
}

function git(cwd, args, options = {}) {
  return run("git", args, { cwd, ...options });
}

function combinedOutput(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function expectFailure({ cwd, script, needles, baseSha, label }) {
  const result = run(process.execPath, [script], {
    cwd,
    env: { ...process.env, INTEGRITY_BASE_SHA: baseSha },
    allowFailure: true,
  });
  const output = combinedOutput(result);
  if (result.status === 0) {
    throw new Error(`${label}: guard unexpectedly passed\n${output}`);
  }
  if (!needles.some((needle) => output.includes(needle))) {
    throw new Error(`${label}: guard failed, but not for the expected reason (${needles.join(" | ")})\n${output}`);
  }
  console.log(`[integrity-selftest] PASS expected rejection: ${label}`);
}

const root = run("git", ["rev-parse", "--show-toplevel"]).stdout.trim();
const originalHead = git(root, ["rev-parse", "HEAD"]).stdout.trim();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aios-integrity-selftest-"));
const worktree = path.join(tempRoot, "repo");

function fixturePath(relativePath) {
  return path.join(worktree, ...relativePath.split("/"));
}

function commitFixture(message, files) {
  git(worktree, ["add", "--", ...files]);
  git(worktree, ["commit", "-m", message]);
}

function resetFixture() {
  git(worktree, ["reset", "--hard", originalHead]);
  git(worktree, ["clean", "-fd"]);
}

try {
  git(root, ["worktree", "add", "--detach", worktree, originalHead]);
  git(worktree, ["config", "user.name", "AI OS Integrity Fixture"]);
  git(worktree, ["config", "user.email", "integrity-fixture@local.invalid"]);

  console.log("[integrity-selftest] baseline guards must pass...");
  run(process.execPath, ["scripts/guard-repo-integrity.mjs"], {
    cwd: worktree,
    env: { ...process.env, INTEGRITY_BASE_SHA: originalHead },
  });
  run(process.execPath, ["scripts/guard-migrations.mjs"], { cwd: worktree });

  console.log("[integrity-selftest] fixture 1/4: destructive placeholder...");
  const placeholderTarget = "client/src/components/GenerationList.tsx";
  fs.writeFileSync(fixturePath(placeholderTarget), "PLACEHOLDER_USE_ARTIFACT_FINAL\n", "utf8");
  commitFixture("fixture: placeholder regression", [placeholderTarget]);
  expectFailure({
    cwd: worktree,
    script: "scripts/guard-repo-integrity.mjs",
    needles: ["forbidden placeholder marker detected"],
    baseSha: originalHead,
    label: "placeholder marker",
  });
  resetFixture();

  console.log("[integrity-selftest] fixture 2/4: critical file destructive shrink...");
  const shrinkTarget = "client/src/styles.css";
  fs.writeFileSync(fixturePath(shrinkTarget), ":root { --integrity-fixture: 1; }\n", "utf8");
  commitFixture("fixture: destructive critical-file shrink", [shrinkTarget]);
  expectFailure({
    cwd: worktree,
    script: "scripts/guard-repo-integrity.mjs",
    needles: [
      "critical file shrank below minimum size",
      "destructive diff detected",
      "file shrank",
    ],
    baseSha: originalHead,
    label: "critical-file shrink",
  });
  resetFixture();

  console.log("[integrity-selftest] fixture 3/4: duplicate migration number...");
  const migrationFiles = fs.readdirSync(fixturePath("drizzle"))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  if (!migrationFiles.length) throw new Error("no migration SQL files found for collision fixture");
  const latestMigration = migrationFiles.at(-1);
  const prefix = latestMigration.slice(0, 4);
  const collision = `drizzle/${prefix}_integrity_collision.sql`;
  fs.copyFileSync(fixturePath(`drizzle/${latestMigration}`), fixturePath(collision));
  commitFixture("fixture: duplicate migration number", [collision]);
  expectFailure({
    cwd: worktree,
    script: "scripts/guard-migrations.mjs",
    needles: ["duplicate migration number"],
    baseSha: originalHead,
    label: "migration number collision",
  });
  resetFixture();

  console.log("[integrity-selftest] fixture 4/4: released migration hash tamper...");
  const tamperTarget = `drizzle/${latestMigration}`;
  fs.appendFileSync(fixturePath(tamperTarget), "\n-- integrity fixture tamper\n", "utf8");
  commitFixture("fixture: migration hash tamper", [tamperTarget]);
  expectFailure({
    cwd: worktree,
    script: "scripts/guard-migrations.mjs",
    needles: ["migration hash mismatch"],
    baseSha: originalHead,
    label: "migration hash tamper",
  });

  console.log("[integrity-selftest] all destructive fixtures were rejected as expected");
} finally {
  run("git", ["worktree", "remove", "--force", worktree], { cwd: root, allowFailure: true });
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
