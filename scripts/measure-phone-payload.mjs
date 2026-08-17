#!/usr/bin/env node
/**
 * Phone initial-payload measurement.
 *
 * Reads `dist/public` after a build and reports the *transitive* set of JS and CSS
 * a phone actually downloads to reach an interactive route — entry chunk, its
 * static imports (which the browser fetches eagerly via modulepreload), plus the
 * lazy chunk for that one route and everything that chunk statically imports.
 *
 * Why not just read Vite's printed sizes: those are per-chunk. The number that
 * matters is "bytes on the wire before this screen works", and that is a graph
 * closure, not a single row. A refactor that moves 200KB from the entry chunk
 * into a chunk the entry still statically imports has saved nothing, and only a
 * closure walk shows that.
 *
 * Usage:  node scripts/measure-phone-payload.mjs [dist/public]
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const dist = process.argv[2] ?? "dist/public";
const assetsDir = path.join(dist, "assets");
if (!existsSync(assetsDir)) {
  console.error(`no build found at ${assetsDir} — run "npx vite build" first`);
  process.exit(1);
}

const files = readdirSync(assetsDir);
const gz = (file) => gzipSync(readFileSync(path.join(assetsDir, file))).length;
const raw = (file) => readFileSync(path.join(assetsDir, file)).length;

/** Static imports of an ES chunk, resolved to sibling asset filenames. */
function staticImports(file) {
  if (!file.endsWith(".js")) return [];
  const src = readFileSync(path.join(assetsDir, file), "utf8");
  const out = new Set();
  // Emitted chunks reference siblings as "./name-hash.js" in import/export-from.
  for (const m of src.matchAll(/\bfrom"(\.\/[^"]+\.js)"/g)) out.add(path.basename(m[1]));
  for (const m of src.matchAll(/\bimport"(\.\/[^"]+\.js)"/g)) out.add(path.basename(m[1]));
  return [...out];
}

function closure(seeds) {
  const seen = new Set();
  const queue = [...seeds];
  while (queue.length) {
    const file = queue.pop();
    if (!file || seen.has(file) || !files.includes(file)) continue;
    seen.add(file);
    queue.push(...staticImports(file));
  }
  return seen;
}

const find = (prefix, ext = ".js") =>
  files.find((f) => f.startsWith(prefix) && f.endsWith(ext) && !f.endsWith(".map"));

// The entry is whatever index.html loads; its modulepreloads come along with it.
const html = readFileSync(path.join(dist, "index.html"), "utf8");
const entryJs = path.basename(html.match(/src="\/assets\/(index-[^"]+\.js)"/)?.[1] ?? "");
const entryCss = path.basename(html.match(/stylesheet[^>]*href="\/assets\/([^"]+\.css)"/)?.[1] ?? "");
if (!entryJs) {
  console.error("could not find the entry script in index.html");
  process.exit(1);
}

const ROUTES = [
  { name: "phone  /dashboard", seed: find("MobileHome-") },
  { name: "phone  /p/:id", seed: find("MobileProjectPage-") },
  { name: "desktop /dashboard", seed: find("Launchpad-") },
  { name: "desktop /p/:id", seed: find("ProjectPage-") },
];

const baseline = closure([entryJs]);
const baselineGz = [...baseline].reduce((sum, f) => sum + gz(f), 0);
const cssGz = entryCss ? gz(entryCss) : 0;

const kb = (bytes) => (bytes / 1024).toFixed(1).padStart(7);

console.log(`entry closure : ${[...baseline].length} chunks, ${kb(baselineGz)} kB gzip`);
console.log(`entry css     : ${kb(cssGz)} kB gzip  (${entryCss})`);
console.log("");
console.log("route                 chunks   route JS   +entry JS   +entry CSS = total");
for (const route of ROUTES) {
  if (!route.seed) {
    console.log(`${route.name.padEnd(20)}  (chunk not found)`);
    continue;
  }
  const all = closure([route.seed]);
  const added = [...all].filter((f) => !baseline.has(f));
  const addedGz = added.reduce((sum, f) => sum + gz(f), 0);
  // Route CSS chunks are loaded alongside their JS chunk.
  const routeCss = files.filter(
    (f) => f.endsWith(".css") && f.startsWith(route.seed.split("-")[0] + "-"),
  );
  const routeCssGz = routeCss.reduce((sum, f) => sum + gz(f), 0);
  const total = baselineGz + cssGz + addedGz + routeCssGz;
  console.log(
    `${route.name.padEnd(20)} ${String(added.length).padStart(6)} ${kb(addedGz + routeCssGz)}   ${kb(baselineGz)}    ${kb(cssGz)}   ${kb(total)} kB gzip`,
  );
}

console.log("");
console.log("largest chunks in the entry closure:");
for (const file of [...baseline].sort((a, b) => gz(b) - gz(a)).slice(0, 8)) {
  console.log(`  ${kb(gz(file))} kB gzip  ${kb(raw(file))} kB raw  ${file}`);
}
