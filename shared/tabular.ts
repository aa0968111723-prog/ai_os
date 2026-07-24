/**
 * 多格式表格匯入（前後端共用，零相依）：CSV／TSV／JSON 一套解析口徑。
 * 連接 Excel／Google 試算表（CSV/TSV 另存）、其他資料庫或 API 的 JSON 匯出檔——
 * 統一成「表頭 + 列」的正規形狀，再交給 databaseFields 的 validateRowData 逐列把關。
 *
 * 設計取捨：
 * - 只做「表格類」文字格式。二進位的 Excel（.xlsx）不在此解析（需重量級相依）——
 *   請在試算表「另存為 CSV／Tab 分隔」後匯入，或走文件層上傳（AI 讀文字）。
 * - 分隔類（CSV/TSV）沿用 csv.ts 的引號狀態機與公式中和還原（round-trip 無損）。
 * - JSON 接受「物件陣列」或「單一物件」；巢狀值以 JSON 字串攤平，交由欄位驗證再收斂。
 */
import { delimitedToRowObjects, parseDelimited, unguard } from "./csv";
import { MAX_FIELDS, MAX_LABEL, newFieldKey, type DataField } from "./databaseFields";

export type TabularFormat = "csv" | "tsv" | "json";

/** 支援格式的顯示中繼（前端下拉、檔案 accept、副檔名偵測共用） */
export const TABULAR_FORMATS: Array<{ id: TabularFormat; label: string; exts: string[]; hint: string }> = [
  { id: "csv", label: "CSV", exts: [".csv"], hint: "逗號分隔——Excel／Google 試算表「另存為 CSV」" },
  { id: "tsv", label: "TSV", exts: [".tsv", ".tab"], hint: "Tab 分隔——試算表「另存為 Tab 分隔值」" },
  { id: "json", label: "JSON", exts: [".json"], hint: "物件陣列 [{…},{…}]——其他資料庫／API 的匯出檔" },
];

const DELIMITER: Record<Exclude<TabularFormat, "json">, string> = { csv: ",", tsv: "\t" };

/** 檔案 input 的 accept 字串（副檔名 + 對應 MIME） */
export const TABULAR_ACCEPT = ".csv,.tsv,.tab,.json,text/csv,text/tab-separated-values,application/json";

/**
 * 偵測格式：先看副檔名，再嗅探內容。認不出時保守回 "csv"（最常見的貼上來源）。
 * - 副檔名：.json→json、.tsv/.tab→tsv、.csv→csv（.txt 等交給內容嗅探）。
 * - 內容：去空白後以 [ 或 { 起頭→json；首個非空行含 Tab 且 Tab 數 ≥ 逗號數→tsv；否則 csv。
 */
export function detectFormat(filename: string | null | undefined, text: string): TabularFormat {
  const lower = (filename ?? "").toLowerCase();
  for (const fmt of TABULAR_FORMATS) {
    if (fmt.exts.some((ext) => lower.endsWith(ext))) return fmt.id;
  }
  const trimmed = text.replace(/^﻿/, "").trimStart();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return "json";
  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? "";
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  if (tabs > 0 && tabs >= commas) return "tsv";
  return "csv";
}

/** 把任意 JSON 值攤平成字串儲存格：字串原樣、數字/布林轉字串、null/undefined→空、物件/陣列→JSON 字串 */
function flattenJsonValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export interface TabularParse {
  /** 表頭（欄位來源名稱）依出現順序、去重 */
  headers: string[];
  /** 每列：values 以表頭字串為 key；line＝供錯誤回報定位（分隔類＝實體行號、JSON＝第幾筆物件，皆 1 起算） */
  records: Array<{ values: Record<string, string>; line: number }>;
}

/**
 * 解析成正規「表頭 + 列」形狀（供前端預覽、欄位推斷、匯入共用）。
 * JSON 格式不正確會拋人話 Error（呼叫端 try/catch 顯示）。分隔類永不拋（空輸入回空表）。
 */
export function parseTabular(text: string, format: TabularFormat): TabularParse {
  if (format === "json") return parseJson(text);
  const grid = parseDelimited(text, DELIMITER[format]);
  if (grid.length === 0) return { headers: [], records: [] };
  // 表頭去重：重複表頭只保留第一次（後續同名欄與之合併，與 delimitedToRowObjects 的 header→key 對應一致）
  const seen = new Set<string>();
  const headerAt: Array<{ index: number; name: string }> = [];
  grid[0].forEach((raw, idx) => {
    const name = raw.trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    headerAt.push({ index: idx, name });
  });
  const records: TabularParse["records"] = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (row.every((c) => c.trim() === "")) continue; // 略過全空列（尾端空行常見）
    const values: Record<string, string> = {};
    for (const { index, name } of headerAt) values[name] = unguard((row[index] ?? "").trim());
    records.push({ values, line: r + 1 }); // grid r 0 起算（含表頭），實體行號＝r+1
  }
  return { headers: headerAt.map((h) => h.name), records };
}

/** JSON → 正規形狀：接受物件陣列或單一物件；非物件元素略過。表頭＝所有物件 key 的有序聯集。 */
function parseJson(text: string): TabularParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("JSON 格式不正確——請確認是有效的 JSON（物件陣列 [{…},{…}]）");
  }
  const items = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : [];
  if (items.length === 0) throw new Error("JSON 要是物件陣列 [{…},{…}] 或單一物件");
  const headers: string[] = [];
  const seen = new Set<string>();
  const records: TabularParse["records"] = [];
  items.forEach((item, i) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return; // 略過非物件元素（如純值）
    const obj = item as Record<string, unknown>;
    const values: Record<string, string> = {};
    for (const key of Object.keys(obj)) {
      if (!seen.has(key)) { seen.add(key); headers.push(key); }
      // 去前後空白，與分隔類（CSV/TSV 每格皆 .trim()）一致——否則同一份資料 JSON 版的
      // " done"／"2026-01-01 " 之類尾空白值會過不了 select/date 驗證，CSV 版卻通過（格式相依的意外拒絕）。
      values[key] = flattenJsonValue(obj[key]).trim();
    }
    records.push({ values, line: i + 1 }); // JSON 無行號，line＝第幾筆物件
  });
  return { headers, records };
}

/**
 * 從表頭推斷欄位定義（建庫用）：一律 text 型別、非必填，label＝表頭（去空白、截斷 MAX_LABEL）。
 * 空白表頭補「欄位N」；超過 MAX_FIELDS 個表頭只取前 MAX_FIELDS（呼叫端可據回傳長度提示截斷）。
 * 值的型別交給使用者建庫後自行調整欄位型別——先求「能一鍵成表」，再談精緻化。
 */
export function inferFields(headers: string[]): DataField[] {
  return headers.slice(0, MAX_FIELDS).map((h, i) => {
    const label = (h.trim() || `欄位${i + 1}`).slice(0, MAX_LABEL);
    return { key: newFieldKey(), label, type: "text" as const };
  });
}

/**
 * 匯入用：解析 + 依「表頭→欄位 key」對應成列物件陣列（與 csvToRowObjects 同形狀，供匯入迴圈共用）。
 * 分隔類走 delimitedToRowObjects（含公式中和還原）；JSON 走 parseJson 後套 headerMap。
 * 未對應的表頭欄一律丟棄；值的型別轉換與驗證交給呼叫端 validateRowData。
 */
export function tabularToRowObjects(text: string, format: TabularFormat, headerMap: Record<string, string>): Array<{ data: Record<string, string>; line: number }> {
  if (format !== "json") return delimitedToRowObjects(text, DELIMITER[format], headerMap);
  const { records } = parseJson(text);
  const out: Array<{ data: Record<string, string>; line: number }> = [];
  for (const rec of records) {
    const data: Record<string, string> = {};
    for (const [header, value] of Object.entries(rec.values)) {
      const key = headerMap[header];
      if (key) data[key] = value;
    }
    out.push({ data, line: rec.line });
  }
  return out;
}
