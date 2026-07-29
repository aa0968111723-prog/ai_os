#!/usr/bin/env node
/**
 * Import boundary checker (TD-10 / ADR-009).
 *
 * Rules:
 *  1. client/** must not import server/**
 *  2. server/routers/** must not import client/**
 *  3. server/services/** must not import server/routers/**
 *
 * Pre-existing exceptions are allowlisted (see docs/adr/009-import-boundaries.md).
 * Do not grow the allowlist without updating the ADR.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".vite",
]);

/**
 * Allowlist keys: `${posixRelSource}::${specifier}`
 * specifier is the raw module string from the import/require.
 * Documented in docs/adr/009-import-boundaries.md — keep in sync.
 */
const ALLOWLIST = new Set([
  // Client → server: tRPC AppRouter type-only (legacy)
  "client/src/api.ts::../../server/routers",
  "client/src/components/MessagePanel.tsx::../../../server/routers",
  "client/src/pages/AdminPage.tsx::../../../server/routers",
  "client/src/pages/ChatPage.tsx::../../../server/routers",
  "client/src/pages/MembersPage.tsx::../../../server/routers",

  // Services → routers: helpers not yet extracted (legacy)
  "server/services/agentCore.ts::../routers/knowledge",
  "server/services/agentRunner.ts::../routers/director",
  "server/services/agentRunner.ts::../routers/approvals",
  "server/services/agentRunner.ts::../routers/assistant",
  "server/services/agentSplitRecovery.pg.test.ts::../routers/director",
  "server/services/generationCore.ts::../routers/characters",
  "server/services/generationCore.ts::../routers/scenePresets",
  "server/services/messageAssistant.ts::../routers/knowledge",
  "server/services/restApi.ts::../routers/schedule",
]);

/** Match static import / export-from / require / dynamic import(). */
const IMPORT_RE =
  /(?:(?:import|export)(?:\s+type)?(?:[\s\w{},*]+from)?\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".") && ent.name !== ".") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIR_NAMES.has(ent.name)) continue;
      walk(full, out);
    } else if (ent.isFile() && SOURCE_EXTS.has(path.extname(ent.name))) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(src) {
  // Remove block comments then line comments (good enough for import scanning).
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function collectImports(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const text = stripComments(raw);
  const specs = [];
  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(text)) !== null) {
    specs.push(m[1]);
  }
  return specs;
}

/**
 * Resolve a relative specifier against the importing file.
 * Returns posix path relative to ROOT, or null if not a relative local path.
 */
function resolveLocal(relSource, specifier) {
  if (!specifier.startsWith(".")) return null;
  const absFrom = path.join(ROOT, relSource);
  const resolved = path.normalize(path.join(path.dirname(absFrom), specifier));
  const rel = path.relative(ROOT, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return toPosix(rel);
}

function under(relPath, prefix) {
  return relPath === prefix || relPath.startsWith(prefix + "/");
}

function checkFile(absPath, violations) {
  const relSource = toPosix(path.relative(ROOT, absPath));
  const specs = collectImports(absPath);

  for (const spec of specs) {
    const key = `${relSource}::${spec}`;
    if (ALLOWLIST.has(key)) continue;

    // Only enforce on local/relative paths (and tsconfig path aliases).
    // Package names like `@trpc/server` must not be treated as the repo `server/` tree.
    const isRelative = spec.startsWith("./") || spec.startsWith("../");
    const isRootish =
      spec === "server" ||
      spec.startsWith("server/") ||
      spec === "client" ||
      spec.startsWith("client/");
    // tsconfig paths: "@server/*" → "./server/*", "@shared/*" is allowed everywhere.
    const aliasServer = spec === "@server" || spec.startsWith("@server/");
    const aliasClient = spec === "@client" || spec.startsWith("@client/");
    if (!isRelative && !isRootish && !aliasServer && !aliasClient) continue;

    let resolved;
    if (isRelative) {
      resolved = resolveLocal(relSource, spec);
    } else if (aliasServer) {
      resolved = "server" + spec.slice("@server".length);
    } else if (aliasClient) {
      resolved = "client" + spec.slice("@client".length);
    } else {
      resolved = toPosix(spec);
    }

    const targetsServer =
      resolved != null && under(resolved.replace(/\/index$/, ""), "server");
    const targetsClient =
      resolved != null && under(resolved.replace(/\/index$/, ""), "client");
    const targetsRouters =
      resolved != null &&
      (under(resolved.replace(/\/index$/, ""), "server/routers") ||
        // relative ../routers/... from services may resolve with or without ext
        /(^|\/)server\/routers(\/|$)/.test(resolved + "/"));

    // Rule 1: client → server
    if (under(relSource, "client") && targetsServer) {
      violations.push({
        rule: "client-must-not-import-server",
        file: relSource,
        specifier: spec,
        resolved,
      });
      continue;
    }

    // Rule 2: server/routers → client
    if (under(relSource, "server/routers") && targetsClient) {
      violations.push({
        rule: "routers-must-not-import-client",
        file: relSource,
        specifier: spec,
        resolved,
      });
      continue;
    }

    // Rule 3: server/services → routers
    if (under(relSource, "server/services") && targetsRouters) {
      violations.push({
        rule: "services-must-not-import-routers",
        file: relSource,
        specifier: spec,
        resolved,
      });
    }
  }
}

function main() {
  const roots = [
    path.join(ROOT, "client"),
    path.join(ROOT, "server"),
  ];
  const files = [];
  for (const r of roots) {
    if (fs.existsSync(r)) walk(r, files);
  }

  const violations = [];
  for (const f of files) checkFile(f, violations);

  // Detect allowlist entries that no longer match anything (stale).
  const seenAllow = new Set();
  for (const f of files) {
    const relSource = toPosix(path.relative(ROOT, f));
    for (const spec of collectImports(f)) {
      const key = `${relSource}::${spec}`;
      if (ALLOWLIST.has(key)) seenAllow.add(key);
    }
  }
  const stale = [...ALLOWLIST].filter((k) => !seenAllow.has(k)).sort();

  if (violations.length === 0 && stale.length === 0) {
    console.log(
      `check-import-boundaries: OK (${files.length} files, ${ALLOWLIST.size} allowlisted exceptions)`,
    );
    process.exit(0);
  }

  if (violations.length > 0) {
    console.error("check-import-boundaries: VIOLATIONS\n");
    for (const v of violations) {
      console.error(`  [${v.rule}] ${v.file}`);
      console.error(`    import ${JSON.stringify(v.specifier)}`);
      if (v.resolved) console.error(`    resolves → ${v.resolved}`);
    }
    console.error(
      "\nSee docs/adr/009-import-boundaries.md. New cross-layer imports are not allowed;",
    );
    console.error(
      "extract shared helpers or route through the correct layer instead of growing the allowlist.\n",
    );
  }

  if (stale.length > 0) {
    console.error("check-import-boundaries: STALE ALLOWLIST ENTRIES (remove them):\n");
    for (const k of stale) console.error(`  ${k}`);
    console.error("");
  }

  process.exit(1);
}

main();
