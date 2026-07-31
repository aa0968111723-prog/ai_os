#!/usr/bin/env node
/**
 * UI primitives ratchet（UIUX-01）。
 *
 * 為什麼要這支腳本：
 *   `docs/product/site-wide-uiux-optimization-plan.md` §24.3 已經規範「按鈕收斂為三級」「表單統一」，
 *   但規範收斂的是 **CSS class 命名**，不是元件。在沒有 <Button>／<Hint> 的世界裡，
 *   新 PR 只能繼續手寫 className="btn-sm primary"、<p className="hint">，
 *   於是每一輪 UIUX 打磨的成果都會被後續 PR 稀釋回去（實測：hint 464 → 491、styles.css +15%）。
 *
 * 因此本檢查是 **單向棘輪（ratchet）**：
 *   - 既有的裸 class 用量寫進 baseline，不擋、不逼你一次改完。
 *   - 任何檔案的用量「超過」baseline → CI 紅燈，必須改用 client/src/components/ui 的 primitives。
 *   - 新檔案的 baseline 視為 0，一律要用 primitives。
 *   - 用量下降時 baseline 不會自動跟著降，需明確 --write-baseline 收緊（避免誤放行）。
 *
 * 用法：
 *   node scripts/check-ui-primitives.mjs                 # 檢查（CI 用，退出碼非 0 代表退化）
 *   node scripts/check-ui-primitives.mjs --report        # 只列現況，永遠退出 0
 *   node scripts/check-ui-primitives.mjs --json          # 輸出 JSON（供其他工具消費）
 *   node scripts/check-ui-primitives.mjs --write-baseline # 重寫 baseline（遷移完一批後收緊）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SCAN_ROOT = path.join(ROOT, "client", "src");
const BASELINE_PATH = path.join(ROOT, "docs", "uiux-audit", "ui-primitives-baseline.json");
const STYLES_PATH = path.join(ROOT, "client", "src", "styles.css");
/** primitives 元件層位置；此目錄底下的檔案本來就該直接寫 class，不受棘輪管轄。 */
const PRIMITIVES_DIR = path.join(SCAN_ROOT, "components", "ui");

const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "build", "coverage", ".git", ".vite", "test"]);

/**
 * 被 primitives 接管的 class。鍵＝class token，值＝應改用的元件。
 * 只列「已經有／即將有對應元件」的 class；純版面用的 utility 不列入，避免噪音。
 */
const OWNED_CLASSES = {
  hint: "<Hint>",
  btn: "<Button>",
  "btn-sm": "<Button size=\"sm\">",
  "btn-ghost": "<Button variant=\"ghost\">",
  "btn-tonal": "<Button variant=\"tonal\">",
  card: "<Card>",
  card2: "<Card variant=\"nested\">",
  chip: "<Chip>",
  badge: "<Badge>",
  pill: "<Pill>",
  "empty-state": "<EmptyState>",
  skeleton: "<Skeleton>",
};

/**
 * **結構性豁免**：這些「標籤 × class」組合永遠不該遷移，不是「還沒遷移」。
 *
 * 兩者混在一起數，會讓棘輪的總量誤導人以為還有那麼多待辦。分開之後，
 * 「待遷移」歸零就是真的做完了。
 *
 * 加入這裡的門檻很高：必須是「遷移會讓程式碼變差」，不是「遷移比較麻煩」。
 */
/**
 * primitives 元件本身。className 傳給它們**代表已經遷移完成**，不是待辦——
 * 例如 `<Skeleton className="card">` 是「卡片形狀的骨架」，不是一張裸卡。
 * 掃描器只認 class 字面值，不加這條就會把已完成的遷移重新算成債。
 */
const PRIMITIVE_TAGS = ["Button", "Card", "Chip", "Badge", "Pill", "Hint", "Meta", "EmptyState", "Skeleton"];

const STRUCTURAL_EXEMPTIONS = [
  {
    tags: PRIMITIVE_TAGS,
    classes: Object.keys(OWNED_CLASSES),
    why: "className 傳給 primitive 元件本身＝已完成遷移（如 <Skeleton className=\"card\"> 是卡片形狀的骨架）",
  },
  {
    tags: ["button"],
    classes: ["hint"],
    why: "真正的展開／收合觸發鈕；Hint 渲染 p/div/span，換掉會失去 button 語意與鍵盤行為",
  },
  {
    tags: ["label"],
    classes: ["chip"],
    why: "包住 radio/checkbox 的 <label>；Chip 渲染 span/div/li，換掉會失去 label 與表單控件的關聯",
  },
  {
    tags: ["Link"],
    classes: ["chip", "hint", "btn", "btn-sm", "btn-ghost", "btn-tonal", "badge", "pill"],
    why: "wouter 的 <Link> 是路由元件；primitives 渲染原生標籤，換掉會失去 client-side 導航",
  },
  {
    tags: ["a"],
    classes: ["btn", "btn-sm", "btn-ghost", "btn-tonal"],
    why: "<a className=\"btn-sm\"> 沒有 .btn 基底，換成 <Button as=\"a\"> 會多加 btn —— 那是真的視覺改變，不是等價轉換",
  },
  {
    tags: ["button"],
    classes: ["chip", "badge"],
    why: "原生 <button> 的語意與鍵盤行為優於 <span role=\"button\">；換成 Chip/Badge 是無障礙降級",
  },
  {
    tags: ["label", "th", "td", "dt", "dd", "summary", "a"],
    classes: ["hint"],
    why: "這些標籤各有專屬 HTML 屬性（htmlFor／scope／href），塞進 Meta 的 HTMLAttributes 會讓型別謊報",
  },
  {
    tags: ["span"],
    classes: ["skeleton"],
    why: "Skeleton 渲染 <div>；span→div 會把行內元素變區塊，改變版面",
  },
];

function isExempt(tag, cls) {
  return STRUCTURAL_EXEMPTIONS.some((e) => e.tags.includes(tag) && e.classes.includes(cls));
}

/**
 * 個案例外：檔案／class 組合就算超過 baseline 也放行。
 * 加入前請在 PR 描述說明理由——這個清單長大＝護欄失效。
 */
const ALLOWLIST = new Set([
  // 目前無例外。格式：`${posixRelPath}::${class}`
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/**
 * 從原始碼抓出所有 className 屬性值的字串內容。
 * 同時支援 className="a b"、className={`a ${x}`}、className={cx("a", cond && "b")}。
 * 做法：抓到 className= 之後，字串直接取；大括號則做括號平衡取出整段表達式，
 * 再從表達式裡撈所有字面字串——寧可多抓（保守）也不要漏掉退化。
 */
function extractClassTokens(source) {
  const tokens = [];
  const attr = /className\s*=\s*/g;
  let m;
  while ((m = attr.exec(source)) !== null) {
    // 往回找這個 className 屬於哪個標籤——結構性豁免是依「標籤 × class」判定的，
    // 只看 class 無法分辨 <span className="chip"> 與 <Link className="chip">。
    const before = source.slice(Math.max(0, m.index - 400), m.index);
    const openTag = before.match(/<([A-Za-z][\w.]*)(?:\s[^<>]*)?$/);
    const tag = openTag ? openTag[1] : "?";
    let i = attr.lastIndex;
    const ch = source[i];
    let raw = "";
    if (ch === '"' || ch === "'") {
      const end = source.indexOf(ch, i + 1);
      if (end === -1) continue;
      raw = source.slice(i + 1, end);
      tokens.push(...splitTokens(raw).map((t) => ({ tag, cls: t })));
      attr.lastIndex = end + 1;
    } else if (ch === "{") {
      let depth = 0;
      let j = i;
      for (; j < source.length; j++) {
        if (source[j] === "{") depth++;
        else if (source[j] === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      if (j >= source.length) continue;
      const expr = source.slice(i + 1, j);
      // 撈表達式裡的所有字面字串（含 template literal）
      for (const lit of expr.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
        tokens.push(...splitTokens(lit[1] ?? lit[2] ?? lit[3] ?? "").map((t) => ({ tag, cls: t })));
      }
      attr.lastIndex = j + 1;
    }
  }
  return tokens;
}

/** 拆 class 字串成 token，並丟掉 template interpolation 殘骸。 */
function splitTokens(raw) {
  return raw
    .replace(/\$\{[^}]*\}/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function relPosix(abs) {
  return path.relative(ROOT, abs).split(path.sep).join("/");
}

/** 掃描全部檔案，回傳 { [relPath]: { [class]: count } }（只含 OWNED_CLASSES）。 */
function scan() {
  const counts = {};
  const exempt = {};
  if (!fs.existsSync(SCAN_ROOT)) return { counts, exempt };
  for (const file of walk(SCAN_ROOT)) {
    if (file.startsWith(PRIMITIVES_DIR + path.sep)) continue; // primitives 自己可以寫 class
    const rel = relPosix(file);
    const tokens = extractClassTokens(fs.readFileSync(file, "utf8"));
    for (const { tag, cls } of tokens) {
      if (!(cls in OWNED_CLASSES)) continue;
      if (isExempt(tag, cls)) {
        exempt[cls] = (exempt[cls] ?? 0) + 1;
        continue;
      }
      counts[rel] ??= {};
      counts[rel][cls] = (counts[rel][cls] ?? 0) + 1;
    }
  }
  return { counts, exempt };
}

/** 額外觀測值：不擋，但列在報告裡讓退化趨勢看得見。 */
function observations() {
  const stylesLines = fs.existsSync(STYLES_PATH)
    ? fs.readFileSync(STYLES_PATH, "utf8").split("\n").length
    : 0;
  const files = fs.existsSync(SCAN_ROOT) ? walk(SCAN_ROOT) : [];
  let primitiveImports = 0;
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    // 相對匯入有兩種寫法：元件同層用 "./ui"、頁面用 "../components/ui"。
    // 只認後者會漏算，讓「遷移進度」看起來停滯。
    if (/from\s+["'](?:[^"']*components\/ui|\.{1,2}\/ui)(\/[^"']*)?["']/.test(src)) primitiveImports++;
  }
  return { stylesCssLines: stylesLines, tsxFiles: files.length, filesUsingPrimitives: primitiveImports };
}

function totals(counts) {
  const perClass = {};
  let all = 0;
  for (const byClass of Object.values(counts)) {
    for (const [cls, n] of Object.entries(byClass)) {
      perClass[cls] = (perClass[cls] ?? 0) + n;
      all += n;
    }
  }
  return { total: all, perClass };
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
}

function writeBaseline(counts, obs, exempt) {
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  const payload = {
    $schema: "ui-primitives-baseline/v1",
    note:
      "單向棘輪基準線。任何檔案的裸 class 用量不得超過此處數字；新檔案視為 0。" +
      "遷移完一批後執行 `node scripts/check-ui-primitives.mjs --write-baseline` 收緊。",
    generatedFrom: "scripts/check-ui-primitives.mjs",
    observations: obs,
    structurallyExempt: exempt,
    totals: totals(counts),
    files: Object.fromEntries(
      Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

function check(counts, baseline) {
  const violations = [];
  const base = baseline?.files ?? {};
  for (const [file, byClass] of Object.entries(counts)) {
    for (const [cls, n] of Object.entries(byClass)) {
      if (ALLOWLIST.has(`${file}::${cls}`)) continue;
      const allowed = base[file]?.[cls] ?? 0;
      if (n > allowed) {
        violations.push({ file, cls, count: n, allowed, component: OWNED_CLASSES[cls] });
      }
    }
  }
  return violations.sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
}

// ── main ──────────────────────────────────────────────────────────────────────
const args = new Set(process.argv.slice(2));
const { counts, exempt } = scan();
const obs = observations();
const sum = totals(counts);

if (args.has("--json")) {
  console.log(JSON.stringify({ observations: obs, totals: sum, files: counts }, null, 2));
  process.exit(0);
}

if (args.has("--write-baseline")) {
  const payload = writeBaseline(counts, obs, exempt);
  console.log(`已寫入基準線 → ${relPosix(BASELINE_PATH)}`);
  console.log(`  裸 class 總量 ${payload.totals.total}／涵蓋 ${Object.keys(counts).length} 個檔案`);
  console.log(`  styles.css ${obs.stylesCssLines} 行、tsx ${obs.tsxFiles} 個、已用 primitives ${obs.filesUsingPrimitives} 個`);
  process.exit(0);
}

if (args.has("--report")) {
  const exemptTotal = Object.values(exempt).reduce((a, b) => a + b, 0);
  console.log("UI primitives 現況");
  console.log(`  styles.css        ${obs.stylesCssLines} 行`);
  console.log(`  tsx 檔            ${obs.tsxFiles} 個（其中 ${obs.filesUsingPrimitives} 個已用 primitives）`);
  console.log(`  待遷移            ${sum.total}`);
  console.log(`  結構性豁免        ${exemptTotal}（遷移會讓程式碼變差，非待辦）`);
  for (const [cls, n] of Object.entries(sum.perClass).sort(([, a], [, b]) => b - a)) {
    console.log(`    ${cls.padEnd(14)} ${String(n).padStart(4)}  → ${OWNED_CLASSES[cls]}`);
  }
  const top = Object.entries(counts)
    .map(([f, c]) => [f, Object.values(c).reduce((a, b) => a + b, 0)])
    .sort(([, a], [, b]) => b - a)
    .slice(0, 12);
  console.log("  用量最高的檔案：");
  for (const [file, n] of top) console.log(`    ${String(n).padStart(4)}  ${file}`);
  if (exemptTotal) {
    console.log("  結構性豁免明細（依標籤 × class）：");
    for (const rule of STRUCTURAL_EXEMPTIONS) {
      const hit = rule.classes.filter((c) => exempt[c]);
      if (hit.length) console.log(`    <${rule.tags.join("|")}> × ${hit.join("/")}
      理由：${rule.why}`);
    }
  }
  process.exit(0);
}

const baseline = loadBaseline();
if (!baseline) {
  console.error(`找不到基準線 ${relPosix(BASELINE_PATH)}`);
  console.error("首次啟用請先執行：node scripts/check-ui-primitives.mjs --write-baseline");
  process.exit(2);
}

const violations = check(counts, baseline);
if (violations.length === 0) {
  console.log(`UI primitives 棘輪通過：裸 class ${sum.total}（基準線 ${baseline.totals?.total ?? "?"}）`);
  process.exit(0);
}

console.error("UI primitives 棘輪失敗 — 有檔案新增了應由元件承擔的裸 class：\n");
for (const v of violations) {
  console.error(`  ${v.file}`);
  console.error(`    class "${v.cls}" 用了 ${v.count} 次，基準線允許 ${v.allowed} 次 → 請改用 ${v.component}`);
}
console.error("\n修法：從 client/src/components/ui 匯入對應 primitive 取代裸 class。");
console.error("若確實是合理例外，請在 scripts/check-ui-primitives.mjs 的 ALLOWLIST 加入並於 PR 說明理由。");
console.error("若這批遷移讓用量整體下降並想收緊基準線：node scripts/check-ui-primitives.mjs --write-baseline");
process.exit(1);
