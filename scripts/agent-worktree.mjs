#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function run(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { encoding: "utf8", stdio: allowFailure ? "pipe" : "inherit" });
  if (result.status !== 0 && !allowFailure) process.exit(result.status ?? 1);
  return result;
}

function capture(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

const rawTask = process.argv[2];
const base = process.argv[3] ?? "HEAD";
if (!rawTask) {
  console.error("Usage: node scripts/agent-worktree.mjs <task-id> [base-ref]");
  process.exit(2);
}

const slug = rawTask
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 80);
if (!slug) {
  console.error("Task id must contain at least one safe character.");
  process.exit(2);
}

const root = capture(["rev-parse", "--show-toplevel"]);
const parent = path.join(path.dirname(root), `${path.basename(root)}-worktrees`);
const destination = path.join(parent, slug);
const branch = `agent/${slug}`;

if (fs.existsSync(destination)) {
  console.error(`Refusing to reuse an existing worktree path: ${destination}`);
  process.exit(1);
}
if (run(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { allowFailure: true }).status === 0) {
  console.error(`Refusing to reuse an existing agent branch: ${branch}`);
  process.exit(1);
}

fs.mkdirSync(parent, { recursive: true });
console.log(`[agent-worktree] creating ${branch} from ${base}`);
run(["worktree", "add", "-b", branch, destination, base]);
console.log(`\nReady: ${destination}`);
console.log(`Branch: ${branch}`);
console.log("Each concurrent AI task should use a different worktree/branch.");
