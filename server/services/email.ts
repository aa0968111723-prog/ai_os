/**
 * 全站寄信（邀請、測試信、敏感操作驗證碼、回饋回覆）。
 *
 * 設計：未設金鑰＝優雅降級 skipped，不擋主流程；金鑰永不回前端。
 *
 * 供應商（優先序）：
 * - EMAIL_PROVIDER=zeabur|resend|auto（預設 auto）
 * - auto：有 ZEABUR_EMAIL_API_KEY → Zeabur Email；否則 RESEND_API_KEY → Resend
 * - 皆需 EMAIL_FROM（已驗證網域，如 "AI Director OS <noreply@your-domain.com>"）
 *
 * Zeabur：POST https://api.zeabur.com/api/v1/zsend/emails  Authorization: Bearer …
 * Resend：POST https://api.resend.com/emails
 */
import { proxyFetch } from "./http";

const EMAIL_FROM = process.env.EMAIL_FROM?.trim();
const ZEABUR_EMAIL_API_KEY = process.env.ZEABUR_EMAIL_API_KEY?.trim();
const RESEND_API_KEY = process.env.RESEND_API_KEY?.trim();

export type EmailProviderId = "zeabur" | "resend";

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type EmailStatus = "sent" | "skipped" | "failed";

export interface SendEmailResult {
  status: EmailStatus;
  detail: string;
}

/** 解析實際供應商；未設定金鑰時回 null */
export function resolveEmailProvider(): EmailProviderId | null {
  const mode = (process.env.EMAIL_PROVIDER ?? "auto").trim().toLowerCase();
  if (mode === "zeabur") return ZEABUR_EMAIL_API_KEY ? "zeabur" : null;
  if (mode === "resend") return RESEND_API_KEY ? "resend" : null;
  // auto
  if (ZEABUR_EMAIL_API_KEY) return "zeabur";
  if (RESEND_API_KEY) return "resend";
  return null;
}

export function isEmailConfigured(): boolean {
  return Boolean(EMAIL_FROM && resolveEmailProvider());
}

function looksLikeEmail(addr: string): boolean {
  return /^\S+@\S+\.\S+$/.test(addr.trim());
}

/**
 * 供應商錯誤 → 人話（管理頁顯示）。
 * provider 影響「請檢查哪個環境變數」的指引。
 */
export function humanizeEmailError(
  status: number,
  body: string,
  provider: EmailProviderId = "resend",
): string {
  let msg = body;
  try {
    const parsed = JSON.parse(body) as { message?: string; error?: string };
    if (typeof parsed.message === "string") msg = parsed.message;
    else if (typeof parsed.error === "string") msg = parsed.error;
  } catch {
    /* 非 JSON */
  }
  const low = msg.toLowerCase();
  const keyHint =
    provider === "zeabur"
      ? "ZEABUR_EMAIL_API_KEY"
      : "RESEND_API_KEY";
  const domainHint =
    provider === "zeabur"
      ? "請到 Zeabur Email 完成 EMAIL_FROM 網域驗證（SPF／DKIM）"
      : "請到 Resend 完成 EMAIL_FROM 網域驗證";

  if (status === 401 || low.includes("api key is invalid") || low.includes("unauthorized") || low.includes("invalid token")) {
    return `信箱服務的 API 金鑰無效——請開發者檢查環境變數 ${keyHint} 是否貼錯或已被撤銷`;
  }
  if (low.includes("not verified") || low.includes("verify a domain")) {
    return `寄件網域尚未通過驗證——${domainHint}`;
  }
  if (status === 403) {
    return `信箱服務拒絕這個寄件人——請開發者確認 EMAIL_FROM 是已驗證網域的地址（${domainHint}）`;
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

/** @deprecated 使用 humanizeEmailError；保留別名以免舊測試／呼叫端立刻壞掉 */
export function humanizeResendError(status: number, body: string): string {
  return humanizeEmailError(status, body, "resend");
}

function envHintForSkip(): string {
  return "未設定 EMAIL_FROM，以及 ZEABUR_EMAIL_API_KEY 或 RESEND_API_KEY（僅落地草稿，未寄出）";
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const to = input.to.trim();
  if (!looksLikeEmail(to)) {
    return { status: "failed", detail: `收件地址無效：${to.slice(0, 80)}` };
  }
  const provider = resolveEmailProvider();
  if (!EMAIL_FROM || !provider) {
    console.log(
      `[email] 信箱機制未設定（略過寄送，僅落地草稿）→ 收件：${to}｜主旨：${input.subject}`,
    );
    return { status: "skipped", detail: envHintForSkip() };
  }

  try {
    if (provider === "zeabur") {
      return await sendViaZeabur(to, input);
    }
    return await sendViaResend(to, input);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error(`[email] 寄送連線失敗 → 收件：${to}｜${raw}`);
    return { status: "failed", detail: "無法連線到信箱服務（網路異常或逾時）——請稍後再試" };
  }
}

async function sendViaZeabur(to: string, input: SendEmailInput): Promise<SendEmailResult> {
  const res = await proxyFetch("https://api.zeabur.com/api/v1/zsend/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ZEABUR_EMAIL_API_KEY}`,
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
    console.error(`[email] Zeabur ${res.status} → 收件：${to}｜回應：${body.slice(0, 300)}`);
    return { status: "failed", detail: humanizeEmailError(res.status, body, "zeabur") };
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string; data?: { id?: string } };
  const id = data.id ?? data.data?.id ?? "sent";
  return { status: "sent", detail: String(id) };
}

async function sendViaResend(to: string, input: SendEmailInput): Promise<SendEmailResult> {
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
    console.error(`[email] Resend ${res.status} → 收件：${to}｜回應：${body.slice(0, 300)}`);
    return { status: "failed", detail: humanizeEmailError(res.status, body, "resend") };
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { status: "sent", detail: data.id ?? "sent" };
}
