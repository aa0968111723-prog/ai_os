/**
 * 自訂資料庫——欄位定義與列資料驗證（前後端共用，零漂移）。
 * 刻意不用 zod：這檔會進前端 bundle，純函式驗證最輕；伺服器端 router 只做外形檢查，
 * 語意驗證（型別、必填、選項白名單）全部集中在這裡，MCP 與 tRPC 走同一套。
 */

export type DataFieldType = "text" | "number" | "select" | "date" | "checkbox" | "url" | "user";

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
];

export const MAX_FIELDS = 30;
export const MAX_LABEL = 40;
export const MAX_OPTIONS = 50;
export const MAX_TEXT_VALUE = 4000;
const KEY_RE = /^[a-z0-9_-]{1,24}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 產生新欄位鍵（建立欄位時前端呼叫；碰撞由 validateFields 的唯一性檢查兜底） */
export function newFieldKey(): string {
  return "f" + Math.random().toString(36).slice(2, 10);
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
        const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
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
        out[f.key] = v;
        break;
      }
      case "checkbox": {
        if (typeof v !== "boolean") return { ok: false, error: `「${f.label}」要是勾選（true/false）` };
        out[f.key] = v;
        break;
      }
      case "user": {
        if (typeof v !== "string" || !UUID_RE.test(v)) return { ok: false, error: `「${f.label}」要是成員 id` };
        out[f.key] = v;
        break;
      }
    }
  }
  return { ok: true, data: out };
}
