/**
 * 「回到原本的流程」的目的地白名單（單一真相，前後端共用）。
 *
 * 使用者是從某個情境出發去連接外部帳號的（專案 → ＋加入資料 → Google）。
 * 連完要回到那個情境，而不是掉到一個跟他意圖無關的設定頁。
 *
 * ★ 這同時是 open redirect 的風險面：任何「回跳目的地」都必須先過這裡。
 *   伺服器端另外把值 HMAC 簽進 OAuth state（見 services/integrations），
 *   但簽章只保證「沒被竄改」，不保證「值本身安全」——所以兩端都要過白名單，
 *   沒有「因為簽過就放行」的捷徑。
 */

/** 站內相對路徑長度上限：回跳目的地不是夾帶資料的通道 */
const MAX_RETURN_TO = 512;

/**
 * 只接受**單一斜線開頭的站內相對路徑**（可含查詢字串與 hash）。
 * 不合格一律回 null，由呼叫端退回預設頁——絕不「盡量照做」。
 */
export function sanitizeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.length > MAX_RETURN_TO) return null;
  if (!raw.startsWith("/")) return null;
  // //evil.com 是協定相對網址，瀏覽器會當成外站
  if (raw.startsWith("//")) return null;
  // 反斜線：部分瀏覽器把 /\evil.com 正規化成 //evil.com
  if (raw.includes("\\")) return null;
  // 控制字元與空白：瀏覽器會先剝掉再解析，剝完可能變成 //evil.com
  if (/[\u0000-\u0020\u007f]/.test(raw)) return null;
  return raw;
}

/**
 * 目前頁面的回跳路徑（含查詢字串與 hash）。
 * 拿不到 window（SSR／測試）時回 null，呼叫端自行退回預設頁。
 */
export function currentReturnTo(loc?: { pathname: string; search: string; hash: string }): string | null {
  const l = loc ?? (typeof window === "undefined" ? null : window.location);
  if (!l) return null;
  return sanitizeReturnTo(`${l.pathname}${l.search}${l.hash}`);
}

/** 把回跳路徑接到某個站內連結上（已有查詢字串時用 &） */
export function withReturnTo(href: string, returnTo: string | null): string {
  const safe = sanitizeReturnTo(returnTo);
  if (!safe) return href;
  return `${href}${href.includes("?") ? "&" : "?"}return=${encodeURIComponent(safe)}`;
}
