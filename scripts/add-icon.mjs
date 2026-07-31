#!/usr/bin/env node
/**
 * 把 Lucide 圖示的路徑資料加進 client/src/components/Icon.tsx。
 *
 *   node scripts/add-icon.mjs Waypoints GitFork
 *   node scripts/add-icon.mjs --print Waypoints     # 只印出來、不改檔
 *
 * 為什麼要有這支腳本：Icon.tsx 是「內嵌路徑、零執行期依賴」的設計（CSP 是
 * scriptSrc 'self'，不能載 CDN；桌面版也要能離線跑）。但手抄 SVG 路徑資料
 * 極易出錯，而且錯了不會有任何測試抓得到——只會是一個形狀微妙走樣的圖示
 * 被送到使用者眼前。這支腳本從 devDependency `lucide-static` 讀原始檔，
 * 機械地轉成 JSX，把「抄寫」這個環節整個拿掉。
 *
 * lucide-static 只是 devDependency：路徑資料在建置前就被寫進原始碼，
 * 產品 bundle 不會多出任何一個位元組。
 *
 * 注意：本站既有圖示是從較舊版 Lucide 抄來的，與目前 lucide-static 比對有
 * 24 個幾何差異——逐條看過，全部是上游改版（Bell／Sparkles／Volume2／Mic／
 * Play 等被重新設計）或等價的不同寫法，沒有抄錯。因此刻意**不**做「必須與
 * 上游一致」的 CI 檢查：那會逼我們為了追新版視覺去改 24 個圖示（對使用者
 * 零好處），而且 lucide 每次發版就變紅。這支腳本只管新增，不管對齊。
 */
import fs from "node:fs";
import path from "node:path";

const ICON_TSX = "client/src/components/Icon.tsx";
const LUCIDE_DIR = "node_modules/lucide-static/icons";

/** Lucide 內層元素只帶幾何屬性（cx/cy/r/d/x/y/width/height/rx/ry/x1…/points），
 *  這些在 JSX 裡的拼法與 HTML 完全相同，不需要轉 camelCase。 */
const GEOMETRY_TAGS = "circle|rect|ellipse|line|polyline|polygon|path";

/** PascalCase → kebab-case（Volume2 → volume-2、XCircle → x-circle、CheckCircle2 → check-circle-2）
 *  第一條規則專治連續大寫：少了它，XCircle 會斷成 "xcircle" 而不是 "x-circle"。 */
function toKebab(name) {
  return name
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Za-z])([0-9])/g, "$1-$2")
    .toLowerCase();
}

function readIcon(name) {
  const file = path.join(LUCIDE_DIR, `${toKebab(name)}.svg`);
  if (!fs.existsSync(file)) {
    // lucide 常把詞序對調（XCircle → circle-x），所以用「任一詞素命中」來找，
    // 而不是只比對開頭——只比開頭會把改名後的正解全部漏掉。
    const all = fs.readdirSync(LUCIDE_DIR).filter((f) => f.endsWith(".svg"));
    const parts = toKebab(name).split("-");
    const near = all
      .map((f) => [f, parts.filter((p) => f.replace(/\.svg$/, "").split("-").includes(p)).length])
      .filter(([, hits]) => hits > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([f]) => f);
    throw new Error(
      `找不到 ${file}\n（lucide 常改名，例如 XCircle 現在叫 circle-x）\n` +
        (near.length ? `相近的檔名：${near.map((f) => f.replace(/\.svg$/, "")).join(", ")}` : ""),
    );
  }
  const svg = fs.readFileSync(file, "utf8");
  const els = [...svg.matchAll(new RegExp(`<(${GEOMETRY_TAGS})\\b[^>]*?/>`, "g"))].map((m) =>
    m[0].replace(/\s+/g, " "),
  );
  if (!els.length) throw new Error(`${file} 解析不出任何幾何元素`);
  return els;
}

/** 產生 PATHS 裡那一筆的原始碼。單一元素不包 fragment，與檔內既有寫法一致。 */
function toEntry(name, els, eol) {
  if (els.length === 1) return `  ${name}: ${els[0]},`;
  return [`  ${name}: (`, "    <>", ...els.map((e) => `      ${e}`), "    </>", "  ),"].join(eol);
}

const args = process.argv.slice(2);
const printOnly = args.includes("--print");
const names = args.filter((a) => !a.startsWith("--"));
if (!names.length) {
  console.error("用法：node scripts/add-icon.mjs [--print] <IconName>...");
  process.exit(2);
}

const lucideVersion = JSON.parse(
  fs.readFileSync("node_modules/lucide-static/package.json", "utf8"),
).version;

let src = fs.readFileSync(ICON_TSX, "utf8");
const eol = src.includes("\r\n") ? "\r\n" : "\n";

const added = [];
for (const name of names) {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new Error(`圖示名稱要用 PascalCase：${name}`);
  const els = readIcon(name);
  const entry = toEntry(name, els, eol);

  if (printOnly) {
    console.log(`\n// ${name}　（lucide-static ${lucideVersion}，ISC）`);
    console.log(entry);
    continue;
  }

  if (new RegExp(`^  \\| "${name}"$`, "m").test(src) || new RegExp(`^  ${name}:`, "m").test(src)) {
    console.log(`${name}：已存在，略過`);
    continue;
  }

  // 1) 加進 IconName 聯集：接在最後一個成員之後（該行以分號收尾）
  const union = src.match(/^ {2}\| "(\w+)";$/m);
  if (!union) throw new Error("找不到 IconName 聯集的結尾");
  src = src.replace(union[0], `  | "${union[1]}"${eol}  | "${name}";`);

  // 2) 加進 PATHS：接在物件收尾的 `};` 之前
  const start = src.indexOf("const PATHS");
  if (start < 0) throw new Error("找不到 PATHS 物件");
  const close = src.indexOf(`${eol}};`, start);
  if (close < 0) throw new Error("找不到 PATHS 的結尾");
  src = src.slice(0, close) + eol + entry + src.slice(close);

  added.push(`${name}（${els.length} 個元素）`);
}

if (!printOnly && added.length) {
  fs.writeFileSync(ICON_TSX, src);
  console.log(`已寫入 ${ICON_TSX}：${added.join("、")}`);
  console.log(`來源：lucide-static ${lucideVersion}（ISC）`);
}
