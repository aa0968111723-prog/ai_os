/**
 * CSV 解析與序列化（前後端共用，零相依）：連接 Excel／Google 試算表／其他資料庫的匯出檔。
 * 遵循 RFC 4180：以逗號分隔、雙引號包住含逗號/引號/換行的欄位、引號內以 "" 轉義。
 * 純函式，供伺服器匯入匯出與單元測試共用。
 */

/** 試算表公式注入起始字元（Excel/LibreOffice/Sheets 會把 = + - @ 開頭的儲存格當公式求值） */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * 中和公式注入（匯出時用）：對危險起始字元的儲存格前綴單引號 `'`。
 * Excel/Sheets 顯示時吃掉這個 `'` 只當純文字；我們自己的 CSV 匯入會在 csvToRowObjects 還原（見下方）。
 * CWE-1236：共享表裡低權限成員可植入 =HYPERLINK/=cmd 之類公式，管理者匯出開檔即觸發——這裡阻斷。
 */
function neutralizeFormula(s: string): string {
  return FORMULA_LEAD.test(s) ? "'" + s : s;
}

/** 序列化一格：含分隔符/引號/換行時加引號並轉義；formulaGuard 時中和公式注入 */
function encodeCell(value: unknown, formulaGuard: boolean): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (typeof value === "boolean") s = value ? "true" : "false";
  else s = String(value);
  if (formulaGuard) s = neutralizeFormula(s);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** 資料列（含表頭）→ CSV 文字。加 UTF-8 BOM 讓 Excel 正確辨識中文（可關）；
 *  formulaGuard 預設開（匯出安全預設）——round-trip 由 csvToRowObjects 還原前綴 `'`。 */
export function toCsv(rows: Array<Array<unknown>>, opts: { bom?: boolean; formulaGuard?: boolean } = {}): string {
  const guard = opts.formulaGuard !== false;
  const body = rows.map((r) => r.map((c) => encodeCell(c, guard)).join(",")).join("\r\n");
  return (opts.bom === false ? "" : "﻿") + body;
}

/**
 * 解析「分隔符分隔」的表格文字 → 二維字串陣列（含表頭列）。狀態機逐字掃描：
 * 正確處理引號欄位內的分隔符/換行、"" 轉義、CRLF 與 LF 混用、結尾無換行、去 UTF-8 BOM。
 * 空輸入回空陣列。delimiter＝","→CSV、"\t"→TSV（同一套引號規則，接 Excel/試算表另存的 TSV）。
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  const pushCell = () => { row.push(cell); cell = ""; };
  const pushRow = () => { pushCell(); rows.push(row); row = []; };
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue; } // 轉義的引號
        inQuotes = false; i++; continue;
      }
      cell += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === delimiter) { pushCell(); i++; continue; }
    if (c === "\r") { i++; continue; } // CR 併入 LF 處理
    if (c === "\n") { pushRow(); i++; continue; }
    cell += c; i++;
  }
  // 收尾：最後一格/列（結尾沒有換行時）——但完全空字串不產生列
  if (cell.length > 0 || row.length > 0) pushRow();
  return rows;
}

/** 解析 CSV（逗號分隔）→ 二維字串陣列。見 parseDelimited。 */
export function parseCsv(text: string): string[][] {
  return parseDelimited(text, ",");
}

/**
 * 把「表頭 + 資料列」的 CSV 依「表頭名稱對應欄位」轉成列物件陣列。
 * headerMap：CSV 表頭字串 → 目標欄位 key（未在 map 的表頭欄一律丟棄）。
 * 回每列的 { data:{ [fieldKey]: 原始字串值 }, line:CSV 實體行號(1 起算) }——
 *   line 精準對應原始 CSV 行（跳過的全空列不影響其他列的行號），供匯入錯誤回報準確定位。
 * 值的型別轉換與驗證交給呼叫端（validateRowData）；還原匯出時中和公式所加的前綴 `'`（round-trip 無損）。
 */
export function delimitedToRowObjects(text: string, delimiter: string, headerMap: Record<string, string>): Array<{ data: Record<string, string>; line: number }> {
  const grid = parseDelimited(text, delimiter);
  if (grid.length < 2) return []; // 只有表頭或空
  const header = grid[0].map((h) => h.trim());
  const cols: Array<{ index: number; key: string }> = [];
  header.forEach((h, idx) => {
    const key = headerMap[h];
    if (key) cols.push({ index: idx, key });
  });
  const out: Array<{ data: Record<string, string>; line: number }> = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    // 全空列略過（尾端空行常見）
    if (row.every((c) => c.trim() === "")) continue;
    const data: Record<string, string> = {};
    for (const { index, key } of cols) data[key] = unguard((row[index] ?? "").trim());
    out.push({ data, line: r + 1 }); // grid r 為 0 起算（含表頭），實體行號＝r+1
  }
  return out;
}

/** CSV（逗號分隔）表頭 → 欄位對應 → 列物件陣列。見 delimitedToRowObjects。 */
export function csvToRowObjects(text: string, headerMap: Record<string, string>): Array<{ data: Record<string, string>; line: number }> {
  return delimitedToRowObjects(text, ",", headerMap);
}

/** 還原匯出時的公式中和：`'=…` → `=…`（只在 `'` 後緊接公式起始字元時剝除，避免誤傷真實資料） */
export function unguard(s: string): string {
  return s.startsWith("'") && FORMULA_LEAD.test(s.slice(1)) ? s.slice(1) : s;
}
