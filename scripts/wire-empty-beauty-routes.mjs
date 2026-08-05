#!/usr/bin/env node
/**
 * Wire EmptyIllustration into Launchpad / AssetLibrary / GenerationList.
 * Run from repo root: node scripts/wire-empty-beauty-routes.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function patch(rel, steps) {
  const path = join(root, rel);
  if (!existsSync(path)) {
    console.error("missing", rel);
    process.exit(1);
  }
  let t = readFileSync(path, "utf8");
  for (const { find, replace, label } of steps) {
    if (t.includes(replace)) {
      console.log("skip (done):", rel, label);
      continue;
    }
    if (!t.includes(find)) {
      if (t.includes("EmptyIllustration")) {
        console.log("skip (already partial):", rel, label);
        continue;
      }
      console.error("pattern not found:", rel, label);
      process.exit(1);
    }
    t = t.replace(find, replace);
    console.log("ok", rel, label);
  }
  writeFileSync(path, t);
}

patch("client/src/pages/Launchpad.tsx", [
  {
    label: "import",
    find: 'import { Icon } from "../components/Icon";\n',
    replace:
      'import { Icon } from "../components/Icon";\nimport { EmptyIllustration } from "../components/EmptyIllustration";\n',
  },
  {
    label: "empty projects",
    find: '<EmptyState icon={<Icon name="Package" />}',
    replace: '<EmptyState icon={<EmptyIllustration name="emptyProjects" />}',
  },
]);

patch("client/src/components/AssetLibrary.tsx", [
  {
    label: "import",
    find: 'import { Icon, type IconName } from "./Icon";\n',
    replace:
      'import { Icon, type IconName } from "./Icon";\nimport { EmptyIllustration } from "./EmptyIllustration";\n',
  },
  {
    label: "empty media",
    find:
      '<EmptyState icon={<Icon name="Image" />} title={<>還沒有素材——</>} description={<>上傳參考圖、原音檔，或先生成一張。</>} style={{ marginTop: 10 }} />',
    replace:
      '<EmptyState icon={<EmptyIllustration name="emptyMedia" />} title={<>還沒有素材——</>} description={<>上傳參考圖、原音檔，或先生成一張。</>} style={{ marginTop: 10 }} />',
  },
]);

patch("client/src/components/GenerationList.tsx", [
  {
    label: "import",
    find: 'import { Icon } from "./Icon";\n',
    replace: 'import { Icon } from "./Icon";\nimport { EmptyIllustration } from "./EmptyIllustration";\n',
  },
  {
    label: "empty generation",
    find:
      '<EmptyState icon={<Icon name="Sparkles" />} title={<>還沒有生成紀錄——</>} description={<>上面試一次吧。</>} style={{ marginTop: 12 }} />',
    replace:
      '<EmptyState icon={<EmptyIllustration name="ribbonMark" />} title={<>還沒有生成紀錄——</>} description={<>上面試一次吧。</>} style={{ marginTop: 12 }} />',
  },
]);

console.log("wire-empty-beauty-routes done");
