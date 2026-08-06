/**
 * 審計日誌（需求 2.2）：所有登入後 mutation 的集中紀錄。
 * 設計原則：
 * - 寫入絕不影響主流程——fire-and-forget，失敗只記 warn（審計掛了不能把生成/核准一起拖垮）。
 * - 輸入先脫敏再落庫：密碼/token 類鍵剔除、長字串截斷、深度/鍵數/陣列長度上限，
 *   防「知識庫 4 萬字全文」把審計表灌爆、防敏感值進日誌。
 * - groupId/projectId 盡力從輸入常見鍵解析（供組層級可見性過濾）；解析不到就 null。
 */
import { db, schema } from "../db";
import type { AuthState } from "./auth";

/** 這些鍵的值一律不落審計（不論深度）——寧可漏記也不可記到憑證 */
const SECRET_KEY_RE = /password|token|secret|apikey|api_key|idempotency.?key/i;

const MAX_STRING = 200;
const MAX_KEYS = 24;
const MAX_ARRAY = 10;
const MAX_DEPTH = 3;

/** 脫敏＋瘦身：遞迴收斂輸入為可安全落庫的摘要 */
export function sanitizeAuditInput(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    // 修 R5-I18N-03：以碼點（非 UTF-16 code unit）截斷——slice 恰在代理對中間切斷會留孤立代理字元，
    // jsonb 寫入被 Postgres 拒收使該筆審計靜默遺失。Array.from 依碼點切，emoji/CJK 補充平面字元安全。
    const cps = Array.from(value);
    return cps.length > MAX_STRING ? `${cps.slice(0, MAX_STRING).join("")}…(共 ${cps.length} 字)` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return "…(過深截斷)";
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((v) => sanitizeAuditInput(v, depth + 1));
    if (value.length > MAX_ARRAY) out.push(`…(共 ${value.length} 項)`);
    return out;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) continue; // 憑證類鍵整個剔除
      if (n >= MAX_KEYS) {
        out["…"] = "(鍵數截斷)";
        break;
      }
      out[k] = sanitizeAuditInput(v, depth + 1);
      n += 1;
    }
    return out;
  }
  return String(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 盡力從輸入抓歸屬 id（groupId/projectId 常見鍵；非 uuid 一律當沒有，避免壞值進 uuid 欄位） */
function pickUuid(input: unknown, keys: string[]): string | null {
  if (!input || typeof input !== "object") return null;
  for (const k of keys) {
    const v = (input as Record<string, unknown>)[k];
    if (typeof v === "string" && UUID_RE.test(v)) return v;
  }
  return null;
}

/**
 * 寫入一筆審計（fire-and-forget）。由 trpc.ts 的 mutation 中介層呼叫；
 * 也可在服務層對特別重要的事件手動補記（帶自訂 action）。
 */
export function recordAudit(
  auth: AuthState,
  action: string,
  rawInput: unknown,
  outcome: { ok: boolean; error?: string },
): void {
  const input = sanitizeAuditInput(rawInput) ?? {};
  void db
    .insert(schema.auditLog)
    .values({
      actorId: auth.user.id,
      action,
      groupId: pickUuid(rawInput, ["groupId"]),
      projectId: pickUuid(rawInput, ["projectId"]),
      input: input as Record<string, unknown>,
      ok: outcome.ok,
      error: outcome.error ? outcome.error.slice(0, 300) : null,
    })
    .catch((err) => console.warn("[audit] 寫入失敗（不影響主流程）：", err instanceof Error ? err.message : err));
}
