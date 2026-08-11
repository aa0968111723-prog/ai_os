#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

const root = git(["rev-parse", "--show-toplevel"]).stdout.trim();
process.chdir(root);

const configPath = path.join(root, "config", "critical-files.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const critical = new Map(Object.entries(config.files ?? {}));
const errors = [];
const warnings = [];

function ghEscape(value) {
  return String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function fail(message, file) {
  errors.push({ message, file });
  const filePart = file ? ` file=${ghEscape(file)}` : "";
  console.error(`::error${filePart}::${ghEscape(message)}`);
}

function warn(message, file) {
  warnings.push({ message, file });
  const filePart = file ? ` file=${ghEscape(file)}` : "";
  console.warn(`::warning${filePart}::${ghEscape(message)}`);
}

function normalizeRepoPath(value) {
  return value.split(path.sep).join("/");
}

function lineCount(text) {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function isSourceCandidate(file) {
  if (!/\.(?:css|cjs|js|jsx|mjs|ts|tsx)$/.test(file)) return false;
  if (/(^|\/)(?:__tests__|__fixtures__|fixtures|test-fixtures)(\/|$)/.test(file)) return false;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) return false;
  return true;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(normalizeRepoPath(path.relative(root, full)));
  }
  return out;
}

const forbiddenMarkers = [
  "PLACEHOLDER_USE_ARTIFACT_FINAL",
  "PLACEHOLDER_WILL_FAIL_IF_TOO_LARGE",
  "PLACEHOLDER_WILL_FAIL_TOO_LARGE",
  "PLACEHOLDER_WILL_LOAD",
  "PLACEHOLDER_WILL_REPLACE",
  "FULL_BODY_FROM_LOCAL_ARTIFACT",
  "FULL_BODY_FROM_ARTIFACT",
  "CONTENT_PENDING",
  "TODO_RESTORE",
  "TEMP - full",
  "publish button pending",
  "truncated for tool safety",
  "rest of the component continues identically",
];

console.log("[integrity] scanning runtime source for destructive placeholders...");
for (const file of ["client/src", "server", "shared"].flatMap((dir) => walk(path.join(root, dir))).filter(isSourceCandidate)) {
  const text = fs.readFileSync(file, "utf8");
  for (const marker of forbiddenMarkers) {
    if (text.includes(marker)) fail(`forbidden placeholder marker detected: ${marker}`, file);
  }
  if (Buffer.byteLength(text, "utf8") < 256 && /\bPLACEHOLDER\b/i.test(text)) {
    fail("runtime source is suspiciously small and contains PLACEHOLDER", file);
  }
}

console.log("[integrity] validating critical-file contracts...");
for (const [file, contract] of critical) {
  if (!fs.existsSync(file)) {
    fail("critical file is missing", file);
    continue;
  }
  const stat = fs.statSync(file);
  if (!stat.isFile()) {
    fail("critical path is not a file", file);
    continue;
  }
  const minBytes = Number(contract.minBytes ?? 0);
  if (minBytes > 0 && stat.size < minBytes) {
    fail(`critical file shrank below minimum size: ${stat.size} B < ${minBytes} B`, file);
  }
  if (Array.isArray(contract.mustContain) && contract.mustContain.length) {
    const text = fs.readFileSync(file, "utf8");
    for (const needle of contract.mustContain) {
      if (!text.includes(needle)) fail(`critical contract token is missing: ${needle}`, file);
    }
  }
}

const rawBase = String(process.env.INTEGRITY_BASE_SHA ?? "").trim();
const allZero = /^0+$/.test(rawBase);
const baseExists = rawBase && !allZero && git(["cat-file", "-e", `${rawBase}^{commit}`], { allowFailure: true }).status === 0;

if (!baseExists) {
  warn(rawBase ? `comparison base is unavailable (${rawBase}); diff-based shrink checks skipped` : "INTEGRITY_BASE_SHA is unset; diff-based shrink checks skipped");
} else {
  console.log(`[integrity] comparing ${rawBase.slice(0, 12)} -> HEAD...`);
  const diff = git(["diff", "--numstat", rawBase, "HEAD", "--", "client/src", "server", "shared", "drizzle", ".github", "scripts", "config"]).stdout;
  let totalAdds = 0;
  let totalDeletes = 0;

  for (const rawLine of diff.split(/\r?\n/)) {
    if (!rawLine) continue;
    const [addsRaw, deletesRaw, ...pathParts] = rawLine.split("\t");
    const file = pathParts.join("\t");
    if (!file) continue;
    if (addsRaw === "-" || deletesRaw === "-") {
      warn("binary diff skipped by line-based shrink guard", file);
      continue;
    }
    const adds = Number(addsRaw);
    const deletes = Number(deletesRaw);
    if (!Number.isFinite(adds) || !Number.isFinite(deletes)) continue;
    totalAdds += adds;
    totalDeletes += deletes;

    const contract = critical.get(file);
    if (contract && !fs.existsSync(file)) {
      fail("critical file was deleted", file);
      continue;
    }

    if (deletes >= 500 && adds <= Math.max(50, Math.floor(deletes * 0.1))) {
      fail(`destructive diff detected: -${deletes} / +${adds}`, file);
    }

    if (deletes < 100 || !fs.existsSync(file)) continue;
    const previous = git(["show", `${rawBase}:${file}`], { allowFailure: true });
    if (previous.status !== 0) continue;
    const currentText = fs.readFileSync(file, "utf8");
    const oldLines = lineCount(previous.stdout);
    const newLines = lineCount(currentText);
    if (oldLines <= 0 || newLines >= oldLines) continue;

    const shrinkPercent = ((oldLines - newLines) / oldLines) * 100;
    const threshold = Number(contract?.maxShrinkPercent ?? config.defaultMaxShrinkPercent ?? 70);
    if (shrinkPercent >= threshold) {
      fail(`file shrank ${shrinkPercent.toFixed(1)}% (${oldLines} -> ${newLines} lines), threshold ${threshold}%`, file);
    }
  }

  if (totalDeletes >= 5000 && totalAdds < 500) {
    fail(`repository-wide destructive diff detected: -${totalDeletes} / +${totalAdds}`);
  }
}

console.log(`[integrity] completed: ${errors.length} error(s), ${warnings.length} warning(s)`);
if (errors.length) process.exit(1);
