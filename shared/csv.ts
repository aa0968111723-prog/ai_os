/**
 * CSV 解析與序列化（前後端共用，零相依）：連接 Excel／Google 試算表／其他資料庫的匯出檔。
 * 遵循 RFC 4180：以逗號分隔、雙引號包住含逗號/引號/換行的欄位、引號內以 "" 轉義。
 * 純函式，供伺服器匯入匯出與單元測試共用。
 */

/** 序列化一格：含分隔符/引號/換行時加引號並轉義 */
function encodeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (typeof value === "boolean") s = value ? "true" : "false";
  else s = String(value);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** 資料列（含表頭）→ CSV 文字。加 UTF-8 BOM 讓 Excel 正確辨識中文（可關）。 */
export function toCsv(rows: Array<Array<unknown>>, opts: { bom?: boolean } = {}): string {
  const body = rows.map((r) => r.map(encodeCell).join(",")).join("\r\n");
  return (opts.bom === false ? "" : "﻿") + body;
}

/**
 * 解析 CSV 文字 → 二維字串陣列（含表頭列）。狀態機逐字掃描：
 * 正確處理引號欄位內的逗號/換行、"" 轉義、CRLF 與 LF 混用、結尾無換行、去 UTF-8 BOM。
 * 空輸入回空陣列。
 */
export function parseCsv(text: string): string[][] {
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
    if (c === ",") { pushCell(); i++; continue; }
    if (c === "\r") { i++; continue; } // CR 併入 LF 處理
    if (c === "\n") { pushRow(); i++; continue; }
    cell += c; i++;
  }
  // 收尾：最後一格/列（結尾沒有換行時）——但完全空字串不產生列
  if (cell.length > 0 || row.length > 0) pushRow();
  return rows;
}

/**
 * 把「表頭 + 資料列」的 CSV 依「表頭名稱對應欄位」轉成列物件陣列。
 * headerMap：CSV 表頭字串 → 目標欄位 key（未在 map 的表頭欄一律丟棄）。
 * 回每列的 { [fieldKey]: 原始字串值 }；值的型別轉換與驗證交給呼叫端（validateRowData）。
 */
export function csvToRowObjects(text: string, headerMap: Record<string, string>): Array<Record<string, string>> {
  const grid = parseCsv(text);
  if (grid.length < 2) return []; // 只有表頭或空
  const header = grid[0].map((h) => h.trim());
  const cols: Array<{ index: number; key: string }> = [];
  header.forEach((h, idx) => {
    const key = headerMap[h];
    if (key) cols.push({ index: idx, key });
  });
  const out: Array<Record<string, string>> = [];
  for (let r = 1; r < grid.length; r++) {
    const line = grid[r];
    // 全空列略過（尾端空行常見）
    if (line.every((c) => c.trim() === "")) continue;
    const obj: Record<string, string> = {};
    for (const { index, key } of cols) obj[key] = (line[index] ?? "").trim();
    out.push(obj);
  }
  return out;
}
