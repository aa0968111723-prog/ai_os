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
      return { status: "failed", detail: `Resend ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { status: "sent", detail: data.id ?? "sent" };
  } catch (err) {
    return { status: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
