/**
 * 自訂資料庫——欄位定義與列資料驗證（前後端共用，零漂移）。
 * 刻意不用 zod：這檔會進前端 bundle，純函式驗證最輕；伺服器端 router 只做外形檢查，
 * 語意驗證（型別、必填、選項白名單）全部集中在這裡，MCP 與 tRPC 走同一套。
 */

export type DataFieldType = "text" | "number" | "select" | "date" | "checkbox" | "url" | "user" | "project" | "schedule";

export interface DataField {
  /** 穩定鍵（列資料以此為 key）：建立後不變，改 label 不影響既有資料 */
  key: string;
  label: string;
  type: DataFieldType;
  /** select 型別的選項清單（其他型別忽略） */
  options?: string[];
  required?: boolean;
}

/** 列資料值：依欄位型別為字串/數字/布林；空值一律存 null */
export type DataRowValue = string | number | boolean | null;
export type DataRowData = Record<string, DataRowValue>;

export const FIELD_TYPES: Array<{ id: DataFieldType; label: string }> = [
  { id: "text", label: "文字" },
  { id: "number", label: "數字" },
  { id: "select", label: "單選" },
  { id: "date", label: "日期" },
  { id: "checkbox", label: "勾選" },
  { id: "url", label: "網址" },
  { id: "user", label: "成員" },
  // 系統實體連結（值＝該實體 id）：格線顯示標題並可跳轉——資料庫跟專案/排程接起來
  { id: "project", label: "專案連結" },
  { id: "schedule", label: "排程連結" },
];

export const MAX_FIELDS = 30;
export const MAX_LABEL = 40;
export const MAX_OPTIONS = 50;
export const MAX_TEXT_VALUE = 4000;
const KEY_RE = /^[a-z0-9_-]{1,24}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 日期是否為真實存在的日曆日：正規表達式只驗形狀（2026-13-45 也會過），需再建構回推
 * 確認月/日 round-trip。擋掉不存在的日期，否則後續 new Date() 會得 NaN 而被行事曆等靜默丟棄。
 */
export function isValidCalendarDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 產生新欄位鍵（建立欄位時前端呼叫；碰撞由 validateFields 的唯一性檢查兜底） */
export function newFieldKey(): string {
  return "f" + Math.random().toString(36).slice(2, 10);
}

/** 勾選欄位的寬鬆布林解析（供 CSV／外部來源）：認得常見真假字串；認不出回 null（讓呼叫端擋） */
export function coerceBoolean(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : null;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (["true", "1", "yes", "y", "是", "✓", "v", "o"].includes(s)) return true;
  if (["false", "0", "no", "n", "否", "✗", "x", ""].includes(s)) return false;
  return null;
}

/**
 * 驗證欄位定義陣列：回錯誤訊息（人話），合法回 null。
 * 順帶把 label/options 去頭尾空白的責任留給呼叫端（這裡只驗不改，保持純檢查語意）。
 */
export function validateFields(fields: unknown): string | null {
  if (!Array.isArray(fields)) return "欄位定義格式不正確";
  if (fields.length === 0) return "至少要有一個欄位";
  if (fields.length > MAX_FIELDS) return `欄位太多（上限 ${MAX_FIELDS} 個）`;
  const seen = new Set<string>();
  for (const f of fields as Array<Partial<DataField>>) {
    if (!f || typeof f !== "object") return "欄位定義格式不正確";
    if (typeof f.key !== "string" || !KEY_RE.test(f.key)) return "欄位鍵格式不正確（英數字、底線、連字號，1–24 字）";
    if (seen.has(f.key)) return "欄位鍵重複";
    seen.add(f.key);
    if (typeof f.label !== "string" || f.label.trim().length === 0) return "欄位名稱不可為空";
    if (f.label.length > MAX_LABEL) return `欄位名稱過長（上限 ${MAX_LABEL} 字）`;
    if (!FIELD_TYPES.some((t) => t.id === f.type)) return "欄位型別不正確";
    if (f.type === "select") {
      if (!Array.isArray(f.options) || f.options.length === 0) return `「${f.label}」是單選欄位，請至少給一個選項`;
      if (f.options.length > MAX_OPTIONS) return `「${f.label}」的選項太多（上限 ${MAX_OPTIONS} 個）`;
      for (const opt of f.options) {
        if (typeof opt !== "string" || opt.trim().length === 0) return `「${f.label}」有空白選項`;
        if (opt.length > 60) return `「${f.label}」的選項過長（上限 60 字）`;
      }
    }
    if (f.required !== undefined && typeof f.required !== "boolean") return "欄位定義格式不正確";
  }
  return null;
}

/**
 * 驗證並清洗一列資料：依欄位定義逐鍵檢查型別／必填／選項白名單，
 * 未定義的鍵一律丟棄（改欄位後的殘鍵不進新寫入）。
 * 回 { ok:true, data } 或 { ok:false, error }。
 */
export function validateRowData(
  fields: DataField[],
  raw: unknown,
): { ok: true; data: DataRowData } | { ok: false; error: string } {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "列資料格式不正確" };
  const input = raw as Record<string, unknown>;
  const out: DataRowData = {};
  for (const f of fields) {
    const v = input[f.key];
    const empty = v === undefined || v === null || v === "";
    if (empty) {
      if (f.required) return { ok: false, error: `「${f.label}」必填` };
      out[f.key] = null;
      continue;
    }
    switch (f.type) {
      case "text": {
        if (typeof v !== "string") return { ok: false, error: `「${f.label}」要是文字` };
        if (v.length > MAX_TEXT_VALUE) return { ok: false, error: `「${f.label}」過長（上限 ${MAX_TEXT_VALUE} 字）` };
        out[f.key] = v;
        break;
      }
      case "url": {
        if (typeof v !== "string" || v.length > 800 || !/^https?:\/\//i.test(v)) {
          return { ok: false, error: `「${f.label}」要是 http(s) 開頭的網址` };
        }
        out[f.key] = v;
        break;
      }
      case "number": {
        let n: number;
        if (typeof v === "number") {
          n = v;
        } else if (typeof v === "string") {
          // Number() 太寬鬆：Number("0x10")===16、Number("0b10")===2、Number("1_000")=NaN——
          // 匯入代碼型字串（如產品編號 "0x10"）會被靜默變成數字 16。只收「十進位」寫法（可含正負號、
          // 小數、科學記號、前後空白），把 0x/0b/0o 這類非十進位進位與其他非數字字面擋在外面。
          const t = v.trim();
          n = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t) ? Number(t) : NaN;
        } else {
          n = NaN;
        }
        if (!Number.isFinite(n)) return { ok: false, error: `「${f.label}」要是數字` };
        out[f.key] = n;
        break;
      }
      case "select": {
        if (typeof v !== "string" || !(f.options ?? []).includes(v)) {
          return { ok: false, error: `「${f.label}」只能選：${(f.options ?? []).join("、")}` };
        }
        out[f.key] = v;
        break;
      }
      case "date": {
        if (typeof v !== "string" || !DATE_RE.test(v)) return { ok: false, error: `「${f.label}」日期格式要是 YYYY-MM-DD` };
        // 形狀對還不夠：2026-02-30／2026-13-01 這種不存在的日期要擋，否則行事曆匯出時 new Date() 會 NaN
        if (!isValidCalendarDate(v)) return { ok: false, error: `「${f.label}」不是有效的日期（例如 2026-02-30 並不存在）` };
        out[f.key] = v;
        break;
      }
      case "checkbox": {
        // 接受 boolean，也接受 CSV／外部來源常見的字串真假值（true/false、是/否、1/0、yes/no、y/n、✓）——
        // 否則 CSV 匯入與「匯出→再匯入」round-trip（匯出把勾選寫成「是/否」）整列都會被擋。
        const b = coerceBoolean(v);
        if (b === null) return { ok: false, error: `「${f.label}」要是勾選（true/false、是/否、1/0）` };
        out[f.key] = b;
        break;
      }
      case "user":
      case "project":
      case "schedule": {
        // 三種都存系統實體的 uuid；歸屬驗證交給顯示端（撈得到才顯示標題，撈不到只見縮短 id），
        // 與 user 型別同取捨——寫入端只擋格式，避免逐列查表拖慢批次寫入
        if (typeof v !== "string" || !UUID_RE.test(v)) {
          return { ok: false, error: `「${f.label}」要是系統內的${f.type === "user" ? "成員" : f.type === "project" ? "專案" : "排程"} id` };
        }
        out[f.key] = v;
        break;
      }
    }
  }
  return { ok: true, data: out };
}
