/**
 * Fal Platform 帳戶 billing（credits 餘額）。
 * GET https://api.fal.ai/v1/account/billing?expand=credits
 * 需 Admin scope key；優先 FAL_ADMIN_KEY，其次 FAL_KEY。
 * Key 永不回傳前端；錯誤訊息使用者可讀、不含 secret。
 * 快取有 Redis 時跨實例共用（見 services/cache），沒有就退回本行程記憶體。
 */
import { cacheDelete, cacheGet, cacheSet } from "./cache";
import { proxyFetch } from "./http";

const BILLING_URL = "https://api.fal.ai/v1/account/billing?expand=credits";

/** 快取 TTL：60～120 秒中間值，避免管理頁輪詢打爆上游 */
export const FAL_BILLING_CACHE_TTL_MS = 90_000;

export type FalAccountBalanceOk = {
  ok: true;
  username: string;
  balance: number;
  currency: string;
  fetchedAt: string; // ISO
  cached: boolean;
};

export type FalAccountBalanceErr = {
  ok: false;
  code: "not_configured" | "forbidden" | "upstream_error";
  message: string;
};

export type FalAccountBalanceResult = FalAccountBalanceOk | FalAccountBalanceErr;

/** 快取鍵（services/cache 會自動加上 Redis 前綴） */
const CACHE_KEY = "fal:account-balance";

/** 單元測試用：清快取與狀態 */
export function resetFalBillingCacheForTests(): void {
  void cacheDelete(CACHE_KEY);
}

function resolveBillingKey(): string | null {
  const admin = process.env.FAL_ADMIN_KEY?.trim();
  if (admin) return admin;
  const fallback = process.env.FAL_KEY?.trim();
  if (fallback) return fallback;
  return null;
}

function parseBillingPayload(data: unknown): { username: string; balance: number; currency: string } | null {
  if (!data || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;
  const username = typeof root.username === "string" ? root.username : "";
  const credits = root.credits;
  if (!credits || typeof credits !== "object") return null;
  const c = credits as Record<string, unknown>;
  const balanceRaw = c.current_balance ?? c.currentBalance ?? c.balance;
  const balance = typeof balanceRaw === "number" ? balanceRaw : Number(balanceRaw);
  if (!Number.isFinite(balance)) return null;
  const currency =
    typeof c.currency === "string" && c.currency.trim()
      ? c.currency.trim()
      : "USD";
  return { username: username || "—", balance, currency };
}

/**
 * 讀取平台 Fal credits 餘額（含記憶體快取）。
 * 不拋例外：一律回傳結構化 ok / 錯誤碼，方便 tRPC 直接透傳。
 */
export async function getFalAccountBalance(opts?: { force?: boolean }): Promise<FalAccountBalanceResult> {
  if (!opts?.force) {
    const hit = await cacheGet<FalAccountBalanceOk>(CACHE_KEY);
    if (hit) return { ...hit, cached: true };
  }

  const key = resolveBillingKey();
  if (!key) {
    return {
      ok: false,
      code: "not_configured",
      message: "尚未設定 FAL_ADMIN_KEY 或 FAL_KEY，無法查詢 Fal 帳戶餘額。",
    };
  }

  try {
    const res = await proxyFetch(BILLING_URL, {
      headers: {
        Authorization: `Key ${key}`,
        Accept: "application/json",
      },
      // 原為 20 秒。這是「頁面載入時順手抓的餘額徽章」，20 秒的上游逾時會讓
      // 整個 /admin 卡住（部署站巡覽實測：超過稽核 15 秒門檻，頂欄直接消失）。
      // 5 秒足夠正常回應；逾時就走下方既有的降級形狀顯示「暫時讀不到」，
      // 遠優於讓一個徽章拖垮整頁。
      timeoutMs: 5_000,
    });

    if (res.status === 401 || res.status === 403) {
      // 一般 FAL_KEY 常會 403 authorization_error——提示需 Admin scope
      return {
        ok: false,
        code: "forbidden",
        message:
          "目前金鑰沒有查詢 billing 的權限。請在後端設定具 Admin scope 的 FAL_ADMIN_KEY（勿把金鑰放到前端）。",
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        code: "upstream_error",
        message: `Fal 帳戶查詢暫時失敗（HTTP ${res.status}），請稍後再試。`,
      };
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return {
        ok: false,
        code: "upstream_error",
        message: "Fal 帳戶回應格式異常，請稍後再試。",
      };
    }

    const parsed = parseBillingPayload(data);
    if (!parsed) {
      return {
        ok: false,
        code: "upstream_error",
        message: "Fal 帳戶回應缺少 credits 餘額欄位，請稍後再試。",
      };
    }

    const fetchedAt = new Date().toISOString();
    const okResult: FalAccountBalanceOk = {
      ok: true,
      username: parsed.username,
      balance: parsed.balance,
      currency: parsed.currency,
      fetchedAt,
      cached: false,
    };
    await cacheSet(CACHE_KEY, okResult, FAL_BILLING_CACHE_TTL_MS);
    return okResult;
  } catch (err) {
    // 不洩漏錯誤細節（可能含 URL／proxy 資訊）；僅使用者可讀訊息
    console.warn("[falBilling] upstream failed:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      code: "upstream_error",
      message: "無法連線 Fal 帳戶服務，請稍後再試。",
    };
  }
}
