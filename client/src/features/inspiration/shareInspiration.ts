/**
 * 靈感頻道分享（純函式 + 一個薄薄的瀏覽器 API 包裝）。
 *
 * 分享出去的是 `/community?post=<id>`：進站後自動打開那一則的細節。
 * 刻意**不做免登入公開頁**——全庫唯一的免登入內容出口是 server/routers/share.ts，
 * 那份檔案的存在理由就是「審查對外公開了什麼只要讀一頁」。靈感頻道是全站共用（站內），
 * 不是對外發表，在這裡開第二個公開出口會把那個保證作廢。
 */

export type ShareOutcome = "shared" | "copied" | "unavailable";

/** 分享連結。origin 由呼叫端給（測試才有辦法斷言，也避免 SSR 讀 window） */
export function buildInspirationShareUrl(origin: string, postId: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/community?post=${encodeURIComponent(postId)}`;
}

/** 分享文案：標題＋分類，讓收到連結的人不必點進來就知道是什麼 */
export function buildInspirationShareText(post: {
  title: string;
  categoryLabel?: string | null;
}): string {
  const category = post.categoryLabel?.trim();
  return category ? `${post.title}（${category}）` : post.title;
}

type ShareNavigator = {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
};

/**
 * 分享一則貼文：優先系統分享面板（手機一步就能轉進 LINE），退回複製連結。
 *
 * 使用者在系統面板按「取消」不是錯誤——回 "shared" 讓 UI 安靜結束，
 * 不要跳出「分享失敗」嚇人。真的兩條路都不通才回 "unavailable"。
 */
export async function shareInspirationPost(
  input: { url: string; title: string; text?: string },
  nav: ShareNavigator | undefined = typeof navigator === "undefined"
    ? undefined
    : (navigator as ShareNavigator),
): Promise<ShareOutcome> {
  if (nav?.share) {
    try {
      await nav.share({ title: input.title, text: input.text, url: input.url });
      return "shared";
    } catch (err) {
      // AbortError＝使用者自己關掉面板；其他錯誤才往下退回複製
      if (err instanceof Error && err.name === "AbortError") return "shared";
    }
  }
  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(input.url);
      return "copied";
    } catch {
      return "unavailable";
    }
  }
  return "unavailable";
}
