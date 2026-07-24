/**
 * 信箱回覆機制（回饋代理寄信給回報者用）。
 *
 * 設計沿襲全站「未設金鑰＝優雅降級、絕不炸」的原則（比照 FAL_KEY／NVIDIA_NIM_API_KEY）：
 * - 設定了 RESEND_API_KEY＋EMAIL_FROM → 走 Resend HTTP API（OpenAI 相容的簡單 JSON POST，
 *   沿用既有 proxyFetch，不引入 nodemailer/原生 SMTP 這種重相依）。
 * - 未設定 → 回 { status: "skipped" }，把信件內容寫進 log 供人工補寄——不擋流程、不拋例外。
 *
 * 之後要換供應商（SendGrid／Mailgun／自架 SMTP relay 的 HTTP gateway）只要改這一支，
 * 呼叫端（feedbackAgent）介面不變。
 */
import { proxyFetch } from "./http";

const RESEND_API_KEY = process.env.RESEND_API_KEY?.trim();
/** 寄件人（需為 Resend 已驗證網域的地址，如 "AI Director OS <noreply@your-domain.com>"） */
const EMAIL_FROM = process.env.EMAIL_FROM?.trim();

export interface SendEmailInput {
  to: string;
  subject: string;
  /** 純文字內文（必填）；html 選填，未給時以 text 呈現 */
  text: string;
  html?: string;
}

export type EmailStatus = "sent" | "skipped" | "failed";

export interface SendEmailResult {
  status: EmailStatus;
  /** 供 log／除錯：sent 時為供應商 id，skipped/failed 時為原因 */
  detail: string;
}

/** 信箱機制是否已就緒（管理頁顯示、代理決定寄或僅落地用） */
export function isEmailConfigured(): boolean {
  return Boolean(RESEND_API_KEY && EMAIL_FROM);
}

/** 極輕量 email 格式檢查——擋明顯無效地址，避免對外送出必失敗的請求 */
function looksLikeEmail(addr: string): boolean {
  return /^\S+@\S+\.\S+$/.test(addr.trim());
}

/**
 * 供應商錯誤 → 人話（detail 會顯示在管理頁「寄信失敗」提示上）：
 * 舊版直接把 `Resend 401: {"statusCode":401,...}` 原始 JSON 噴到畫面，非技術夥伴看不懂
 * 也不知道下一步。這裡翻成「哪裡壞了＋找誰做什麼」；原始回應由呼叫處記進伺服器 log 供工程追查。
 * export 供單元測試。
 */
export function humanizeResendError(status: number, body: string): string {
  // Resend 錯誤體是 {statusCode,name,message}——解析不出就拿原文比對關鍵字
  let msg = body;
  try {
    const parsed = JSON.parse(body) as { message?: string };
    if (typeof parsed.message === "string") msg = parsed.message;
  } catch {
    /* 非 JSON 就用原文 */
  }
  const low = msg.toLowerCase();
  if (status === 401 || low.includes("api key is invalid")) {
    return "信箱服務的 API 金鑰無效——請開發者檢查環境變數 RESEND_API_KEY 是否貼錯或已被撤銷";
  }
  if (low.includes("not verified") || low.includes("verify a domain")) {
    return "寄件網域尚未通過 Resend 驗證——請開發者到 Resend 完成 EMAIL_FROM 網域驗證";
  }
  if (status === 403) {
    return "信箱服務拒絕這個寄件人——請開發者確認 EMAIL_FROM 是 Resend 已驗證網域的地址";
  }
  if (status === 422) {
    return "寄件資料被信箱服務退回——請開發者確認 EMAIL_FROM 格式（例：AI Director OS <noreply@你的網域>）";
  }
  if (status === 429) {
    return "信箱服務額度已滿或寄送太頻繁——請稍後再試";
  }
  if (status >= 500) {
    return "信箱服務暫時故障——請稍後再試";
  }
  return `信箱服務回應異常（${status}）——請稍後再試；持續發生請開發者查伺服器紀錄`;
}

/**
 * 寄一封信。永不拋例外——一律回 { status, detail }，讓呼叫端（背景代理）把結果落地即可。
 * 未設定信箱機制回 skipped；地址無效回 failed；供應商錯誤回 failed（訊息截斷進 detail）。
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const to = input.to.trim();
  if (!looksLikeEmail(to)) {
    return { status: "failed", detail: `收件地址無效：${to.slice(0, 80)}` };
  }
  if (!isEmailConfigured()) {
    // 未設定時把信件內容記進 log（人工可補寄），但流程照走
    console.log(
      `[email] 信箱機制未設定（略過寄送，僅落地草稿）→ 收件：${to}｜主旨：${input.subject}`,
    );
    return { status: "skipped", detail: "未設定 RESEND_API_KEY／EMAIL_FROM（僅落地草稿，未寄出）" };
  }
  try {
    const res = await proxyFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
      }),
      timeoutMs: 30_000,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // 原始回應進伺服器 log 供工程追查；回給畫面的 detail 是人話＋下一步
      console.error(`[email] Resend ${res.status} → 收件：${to}｜回應：${body.slice(0, 300)}`);
      return { status: "failed", detail: humanizeResendError(res.status, body) };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { status: "sent", detail: data.id ?? "sent" };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error(`[email] 寄送連線失敗 → 收件：${to}｜${raw}`);
    return { status: "failed", detail: "無法連線到信箱服務（網路異常或逾時）——請稍後再試" };
  }
}
