#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

const root = git(["rev-parse", "--show-toplevel"]);
process.chdir(root);
const errors = [];

function fail(message, file) {
  errors.push(message);
  const escaped = String(message).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  const filePart = file ? ` file=${file}` : "";
  console.error(`::error${filePart}::${escaped}`);
}

const journalPath = "drizzle/meta/_journal.json";
const revisionsPath = "server/db/migrationRevisions.ts";
const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
const entries = Array.isArray(journal.entries) ? journal.entries : [];

if (!entries.length) fail("migration journal has no entries", journalPath);

const seenIdx = new Set();
const seenTag = new Set();
const seenWhen = new Set();
for (let position = 0; position < entries.length; position += 1) {
  const entry = entries[position];
  const idx = Number(entry.idx);
  const tag = String(entry.tag ?? "");
  const when = String(entry.when ?? "");

  if (!Number.isInteger(idx) || idx < 0) fail(`journal entry ${position} has invalid idx: ${entry.idx}`, journalPath);
  if (seenIdx.has(idx)) fail(`duplicate migration journal idx: ${idx}`, journalPath);
  seenIdx.add(idx);
  if (!tag) fail(`journal entry ${position} has empty tag`, journalPath);
  if (seenTag.has(tag)) fail(`duplicate migration journal tag: ${tag}`, journalPath);
  seenTag.add(tag);
  if (!when) fail(`journal entry ${position} has empty timestamp`, journalPath);
  if (seenWhen.has(when)) fail(`duplicate migration journal timestamp: ${when}`, journalPath);
  seenWhen.add(when);

  if (idx !== position) fail(`journal idx is not contiguous: position ${position} has idx ${idx}`, journalPath);
  const prefix = tag.match(/^(\d{4})_/);
  if (!prefix) fail(`migration tag must begin with a 4-digit sequence: ${tag}`, journalPath);
  else if (Number(prefix[1]) !== idx) fail(`migration tag prefix ${prefix[1]} does not match idx ${idx}: ${tag}`, journalPath);
}

const migrationFiles = fs.readdirSync("drizzle", { withFileTypes: true })
  .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/.test(entry.name))
  .map((entry) => entry.name)
  .sort();

const prefixOwners = new Map();
for (const file of migrationFiles) {
  const prefix = file.slice(0, 4);
  const list = prefixOwners.get(prefix) ?? [];
  list.push(file);
  prefixOwners.set(prefix, list);
}
for (const [prefix, files] of prefixOwners) {
  if (files.length > 1) fail(`duplicate migration number ${prefix}: ${files.join(", ")}`, "drizzle");
}

const fileTags = new Set(migrationFiles.map((file) => file.replace(/\.sql$/, "")));
for (const entry of entries) {
  if (!fileTags.has(entry.tag)) fail(`journaled migration SQL is missing: drizzle/${entry.tag}.sql`, journalPath);
}
for (const tag of fileTags) {
  if (!seenTag.has(tag)) fail(`migration SQL is not registered in journal: drizzle/${tag}.sql`, `drizzle/${tag}.sql`);
}

const revisionSource = fs.readFileSync(revisionsPath, "utf8");
const revisionEntryRegex = /["'](\d{4}_[^"']+)["']\s*:\s*\[([\s\S]*?)\],/g;
const hashRegex = /["']([0-9a-f]{64})["']/g;
const revisions = new Map();
for (const match of revisionSource.matchAll(revisionEntryRegex)) {
  const [, tag, body] = match;
  const hashes = [...body.matchAll(hashRegex)].map((item) => item[1]);
  if (!hashes.length) {
    fail(`revision entry has no SHA-256 hashes: ${tag}`, revisionsPath);
    continue;
  }
  if (revisions.has(tag)) fail(`duplicate revision entry: ${tag}`, revisionsPath);
  revisions.set(tag, hashes);
}

for (const entry of entries) {
  const hashes = revisions.get(entry.tag);
  if (!hashes) {
    fail(`missing MIGRATION_REVISIONS entry: ${entry.tag}`, revisionsPath);
    continue;
  }
  const sqlPath = path.join("drizzle", `${entry.tag}.sql`);
  if (!fs.existsSync(sqlPath)) continue;
  const actual = crypto.createHash("sha256").update(fs.readFileSync(sqlPath)).digest("hex");
  const expectedCurrent = hashes.at(-1);
  if (actual !== expectedCurrent) {
    fail(`migration hash mismatch for ${entry.tag}: latest revision ${expectedCurrent}, got ${actual}`, sqlPath);
  }
}

for (const tag of revisions.keys()) {
  if (!seenTag.has(tag)) fail(`revision entry is not present in journal: ${tag}`, revisionsPath);
}

console.log(`[migration-guard] journal=${entries.length} sql=${migrationFiles.length} revisions=${revisions.size} errors=${errors.length}`);
if (errors.length) process.exit(1);
