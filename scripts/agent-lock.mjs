#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const command = process.argv[2];
const requestedPath = process.argv[3];
const owner = argValue("--owner", process.env.AI_TASK_ID || process.env.USER || "unknown-agent");
const ttlMinutes = Math.max(5, Number(argValue("--ttl", "120")) || 120);
const root = git(["rev-parse", "--show-toplevel"]);
let commonDir = git(["rev-parse", "--git-common-dir"]);
if (!path.isAbsolute(commonDir)) commonDir = path.resolve(root, commonDir);
const lockDir = path.join(commonDir, "ai-file-locks");
fs.mkdirSync(lockDir, { recursive: true });

function normalizeTarget(value) {
  if (!value) return null;
  const absolute = path.resolve(root, value);
  const rel = path.relative(root, absolute);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`Path must stay inside repository: ${value}`);
  return rel.split(path.sep).join("/");
}

function lockPathFor(target) {
  const key = crypto.createHash("sha256").update(target).digest("hex");
  return path.join(lockDir, `${key}.json`);
}

function readLock(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return null; }
}

function isExpired(lock) {
  return !lock?.expiresAt || Date.parse(lock.expiresAt) <= Date.now();
}

function writeAtomic(file, data) {
  const fd = fs.openSync(file, "wx");
  try { fs.writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`, "utf8"); }
  finally { fs.closeSync(fd); }
}

function acquire(target) {
  const file = lockPathFor(target);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = readLock(file);
    if (existing && !isExpired(existing) && existing.owner !== owner) {
      console.error(`LOCKED: ${target}`);
      console.error(`owner=${existing.owner} expiresAt=${existing.expiresAt}`);
      process.exit(3);
    }
    if (existing && (isExpired(existing) || existing.owner === owner)) {
      try { fs.unlinkSync(file); } catch {}
    }
    const now = new Date();
    const lock = {
      path: target,
      owner,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
      pid: process.pid,
    };
    try {
      writeAtomic(file, lock);
      console.log(`LOCK ACQUIRED: ${target}`);
      console.log(`owner=${owner} expiresAt=${lock.expiresAt}`);
      return;
    } catch (error) {
      if (error?.code !== "EEXIST" || attempt === 1) throw error;
    }
  }
}

function release(target) {
  const file = lockPathFor(target);
  const existing = readLock(file);
  if (!existing) {
    console.log(`NO LOCK: ${target}`);
    return;
  }
  if (!isExpired(existing) && existing.owner !== owner) {
    console.error(`REFUSED: ${target} is owned by ${existing.owner}`);
    process.exit(3);
  }
  try { fs.unlinkSync(file); } catch {}
  console.log(`LOCK RELEASED: ${target}`);
}

function status(target) {
  const files = target ? [lockPathFor(target)] : fs.readdirSync(lockDir).filter((name) => name.endsWith(".json")).map((name) => path.join(lockDir, name));
  let count = 0;
  for (const file of files) {
    const lock = readLock(file);
    if (!lock) continue;
    count += 1;
    console.log(`${isExpired(lock) ? "EXPIRED" : "ACTIVE"}\t${lock.path}\t${lock.owner}\t${lock.expiresAt}`);
  }
  if (!count) console.log("No file locks.");
}

try {
  if (command === "status") status(requestedPath ? normalizeTarget(requestedPath) : null);
  else if (command === "acquire") acquire(normalizeTarget(requestedPath));
  else if (command === "release") release(normalizeTarget(requestedPath));
  else {
    console.error("Usage:");
    console.error("  node scripts/agent-lock.mjs acquire <repo-path> --owner <task-id> [--ttl 120]");
    console.error("  node scripts/agent-lock.mjs release <repo-path> --owner <task-id>");
    console.error("  node scripts/agent-lock.mjs status [repo-path]");
    process.exit(2);
  }
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}
