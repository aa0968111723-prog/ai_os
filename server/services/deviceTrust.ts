/**
 * 裝置綁定登入：已驗證過的手機／電腦直接登入，陌生裝置需信箱驗證碼。
 * 完整設計與取捨見 docs/device-trust-design.md。
 *
 * 三個必須先講清楚的前提：
 *
 * 1. **網頁拿不到硬體序號**。IMEI／主機板序號／MAC 位址在瀏覽器（含 PWA）一律讀不到，
 *    這是瀏覽器安全模型的硬限制。故「這台裝置」＝伺服器發出的長效隨機憑證
 *    （cookie aidos_device，DB 只存 SHA-256，比照 sessions.tokenHash）。
 *
 * 2. **指紋只是輔助訊號，不是主識別**。瀏覽器版本、螢幕、時區都會漂移；拿它當封鎖條件
 *    會製造大量假警報，把使用者訓練成「看到驗證碼就無腦輸入」——那比不做還危險。
 *    指紋只用來：(a) 綁定挑戰的發起裝置 (b) 產生看得懂的裝置名稱 (c) 異常時寫審計。
 *
 * 3. **閘門放在「發 session」這一層**，不是每支 API。server/index.ts 有 25 處以上
 *    resolveSession() 呼叫點，逐一加閘門必然漏（mustChangePassword 就漏過 REST 端點，
 *    見 services/auth.ts 的 AUTH2-003）。改成「裝置沒過就拿不到 session token」，
 *    所有既有與未來端點自動受保護。
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { Request, Response } from "express";
import { db, schema } from "../db";
import { hashSessionIp, sha256 } from "./auth";
import { isEmailConfigured, sendEmail } from "./email";
import { deviceDetailLines, type DeviceDetails } from "../../shared/deviceDetails";
import { browserFamily, deviceLabelFrom, describeDevice, osFamily, type DeviceHint } from "../../shared/deviceNaming";

/**
 * 裝置命名（家族判定、機型翻譯、標籤與細節）全部住在 shared/deviceNaming.ts——
 * 前端的通知設定頁與這裡必須產出同一個名字，否則同一台手機在「已連結裝置」
 * 與「信任裝置」兩份清單裡叫兩個名字，使用者不敢按移除。
 * 這裡轉出去是為了不動既有匯入點（auth router、測試）。
 */
export {
  brandOfModel,
  browserFamily,
  deviceKindFrom,
  deviceLabelFrom,
  describeDevice,
  marketingModel,
  osDescription,
  osFamily,
  screenText,
} from "../../shared/deviceNaming";
export type { DeviceHint } from "../../shared/deviceNaming";

/* ── 模式開關 ────────────────────────────────── */

/**
 * off     ＝ 完全不啟用（預設，程式上線但不生效）
 * monitor ＝ 記錄＋自動信任＋寄通知信，但照樣放行（暖身期，累積既有裝置）
 * enforce ＝ 真的擋下陌生裝置，要求信箱驗證碼
 */
export type DeviceTrustMode = "off" | "monitor" | "enforce";

const VALID_MODES: readonly DeviceTrustMode[] = ["off", "monitor", "enforce"];

/**
 * 讀取生效模式。
 *
 * ★安全關鍵：設 enforce 但信箱機制沒就緒（無 RESEND_API_KEY／EMAIL_FROM）＝
 * 保證把所有人鎖在門外（陌生裝置要驗證碼，但驗證碼永遠寄不出去），包含超管、無後門。
 * 這裡自動降級成 monitor 而非照做——開機自檢（services/boot.ts）會同時大聲警告。
 */
export function resolveDeviceTrustMode(
  env: NodeJS.ProcessEnv = process.env,
  emailReady: boolean = isEmailConfigured(),
): DeviceTrustMode {
  const raw = env.DEVICE_TRUST_MODE?.trim().toLowerCase();
  const mode = (VALID_MODES as readonly string[]).includes(raw ?? "") ? (raw as DeviceTrustMode) : "off";
  if (mode === "enforce" && !emailReady) return "monitor";
  return mode;
}

/** enforce 但信箱未就緒＝設定衝突，開機自檢與管理頁據此顯示警告 */
export function deviceTrustMisconfigured(
  env: NodeJS.ProcessEnv = process.env,
  emailReady: boolean = isEmailConfigured(),
): boolean {
  return env.DEVICE_TRUST_MODE?.trim().toLowerCase() === "enforce" && !emailReady;
}

/**
 * 超管 break-glass：DEVICE_TRUST_BREAKGLASS_UNTIL=<ISO 時間>，該時刻前超管登入免裝置驗證。
 * 這是「換手機＋信箱同時進不去」時，改 Railway Variables 就能自救的路，不必進資料庫。
 * 刻意只給超管：一般帳號的救援走管理員預先授信（users.deviceGraceUntil）。
 */
export function breakGlassActive(
  isSuperAdmin: boolean,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): boolean {
  if (!isSuperAdmin) return false;
  const raw = env.DEVICE_TRUST_BREAKGLASS_UNTIL?.trim();
  if (!raw) return false;
  const until = new Date(raw);
  if (Number.isNaN(until.getTime())) {
    console.error(`[deviceTrust] DEVICE_TRUST_BREAKGLASS_UNTIL 不是有效時間，已忽略：${raw}`);
    return false;
  }
  return until.getTime() > now.getTime();
}

/* ── 裝置特徵 ────────────────────────────────── */

/**
 * 裝置特徵雜湊。加 pepper 讓 DB 外洩者無法用彩虹表反推使用者的螢幕/時區組合，
 * 沿用 sessions.ipHash 同一組來源（SESSION_IP_PEPPER || RATE_LIMIT_SECRET）。
 */
export function fingerprintOf(
  ua: string,
  hint: DeviceHint | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const pepper =
    env.SESSION_IP_PEPPER?.trim() ||
    env.RATE_LIMIT_SECRET?.trim() ||
    (env.NODE_ENV === "production" ? "" : "dev-device-pepper");
  // ★只放「幾乎不會變」的欄位。
  // 刻意排除 detailOsVersion／detailBrowserVersion／detailGpu／detailPixelRatio：
  // Chrome 每四週自動更新、Windows 每月推更新、顯示卡驅動更新會改字串——
  // 任何一個進指紋都等於每個月要求全公司重驗一次信箱，
  // 使用者會被訓練成「看到驗證碼就無腦輸入」，那比不做驗證還危險。
  // model／arch／bitness／memoryGb／touchPoints 是硬體特性，換機才會變，可安全納入。
  //
  // ★osFamily 這裡刻意只餵 UA、不餵 hint：hint.detailPlatform 是顯示用的補強訊號，
  //   讓它參與指紋等於把「瀏覽器哪天開始送 UA-CH」變成一次全員重驗。
  // ★browserFamily 認得更多瀏覽器之後（Samsung 瀏覽器、LINE 內建瀏覽器等原本都被歸為
  //   Chrome/Safari），那些裝置的指紋會變動一次。指紋漂移只記審計不封鎖（見設計 §6），
  //   使用者無感；下次登入 touchDevice 就會把新值連同新標籤一起寫回。
  const parts = [
    osFamily(ua),
    browserFamily(ua),
    hint?.screen ?? "",
    hint?.tz ?? "",
    hint?.lang ?? "",
    hint?.cores != null ? String(hint.cores) : "",
    hint?.standalone ? "standalone" : "",
    hint?.model ?? "",
    hint?.arch ?? "",
    hint?.bitness ?? "",
    hint?.memoryGb != null ? String(hint.memoryGb) : "",
    hint?.touchPoints != null ? String(hint.touchPoints) : "",
    pepper,
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

/* ── 裝置憑證 cookie ────────────────────────────────── */

const DEVICE_COOKIE = "aidos_device";
/**
 * 400 天＝Chrome 對 cookie 存活期的上限（超過會被截到 400 天）。
 * 信任本身是「永久直到手動移除」（DB 無 expiresAt），cookie 則在每次成功登入時重新簽發，
 * 所以只要 400 天內登入過一次就會一直續下去。
 */
const DEVICE_COOKIE_DAYS = 400;

export function getDeviceToken(req: Request, cookies: Record<string, string>): string | undefined {
  return cookies[DEVICE_COOKIE];
}

/**
 * 設裝置 cookie。
 * ★與 session cookie 分開兩個 Set-Cookie 標頭：res.setHeader 會覆寫同名標頭，
 * 故一律用 append 疊加，否則設完裝置 cookie 會把 session cookie 洗掉（登入直接失效）。
 */
export function setDeviceCookie(res: Response, token: string): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${DEVICE_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${DEVICE_COOKIE_DAYS * 86_400}${secure}`,
  );
}

export function clearDeviceCookie(res: Response): void {
  res.append("Set-Cookie", `${DEVICE_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

/* ── 查詢與信任 ────────────────────────────────── */

export interface DeviceContext {
  userAgent: string;
  hint?: DeviceHint;
  ip?: string;
}

export type DeviceLookup =
  | { known: true; deviceId: string; label: string; fingerprintChanged: boolean }
  | { known: false };

/**
 * 這台裝置是否已被這位使用者信任過？
 * 未命中的情形一律回 known:false（不區分「沒 cookie」「別人的票」「已撤銷」——
 * 對呼叫端都是同一件事：要走陌生裝置流程）。
 */
export async function lookupDevice(
  userId: string,
  deviceToken: string | undefined,
  ctx: DeviceContext,
): Promise<DeviceLookup> {
  if (!deviceToken) return { known: false };
  const [row] = await db
    .select()
    .from(schema.userDevices)
    .where(
      and(
        eq(schema.userDevices.tokenHash, sha256(deviceToken)),
        eq(schema.userDevices.userId, userId),
        isNull(schema.userDevices.revokedAt),
      ),
    );
  if (!row) return { known: false };
  const fingerprintChanged = row.fingerprintHash !== fingerprintOf(ctx.userAgent, ctx.hint);
  return { known: true, deviceId: row.id, label: row.label, fingerprintChanged };
}

/**
 * 只取裝置 id（不算指紋）。供 changePassword／logoutAll 重發 session 時沿用裝置歸屬——
 * 否則改一次密碼後新 session 的 deviceId 變 null，「移除裝置」就再也踢不掉那台。
 */
export async function deviceIdForToken(
  userId: string,
  deviceToken: string | undefined,
): Promise<string | null> {
  if (!deviceToken) return null;
  const [row] = await db
    .select({ id: schema.userDevices.id })
    .from(schema.userDevices)
    .where(
      and(
        eq(schema.userDevices.tokenHash, sha256(deviceToken)),
        eq(schema.userDevices.userId, userId),
        isNull(schema.userDevices.revokedAt),
      ),
    );
  return row?.id ?? null;
}

/**
 * 成功以既有裝置登入：更新最近使用足跡、標籤與裝置細節（fire-and-forget 等級，失敗不擋登入）。
 * 每次重寫：系統或瀏覽器升級後，「我的裝置」清單顯示的才是目前狀態而非當初註冊時的。
 * 標籤一併重寫（原本只更新 details），否則辨識力提升後，舊裝置永遠停在當初那個
 * 「Android・Chrome」——名字正是使用者用來認出哪一台的東西。
 */
export async function touchDevice(deviceId: string, ctx: DeviceContext): Promise<void> {
  await db
    .update(schema.userDevices)
    .set({
      lastSeenAt: new Date(),
      lastSeenIpHash: hashSessionIp(ctx.ip),
      label: deviceLabelFrom(ctx.userAgent, ctx.hint),
      details: describeDevice(ctx.userAgent, ctx.hint),
    })
    .where(eq(schema.userDevices.id, deviceId));
}

/**
 * 把這台裝置記為已信任，回傳要寫進 cookie 的原始憑證（只在此刻回一次，之後只存雜湊）。
 * 呼叫端負責在同一個交易內建立 session，避免「裝置記了但 session 沒發」的半套狀態。
 */
export async function trustDevice(
  userId: string,
  ctx: DeviceContext,
  /** 交易控制代碼（結構化型別，比照 revokeAllUserMcpTokens 慣例） */
  exec: { insert: typeof db.insert } = db,
): Promise<{ token: string; deviceId: string; label: string }> {
  const token = randomBytes(32).toString("hex");
  const label = deviceLabelFrom(ctx.userAgent, ctx.hint);
  // 註：兌換挑戰後呼叫時，label／details 會和挑戰當時記下的一致——
  // 指紋在兌換時已比對過相符，故由同一份 ctx 重算必然得到同樣結果。
  const [row] = await exec
    .insert(schema.userDevices)
    .values({
      userId,
      tokenHash: sha256(token),
      label,
      fingerprintHash: fingerprintOf(ctx.userAgent, ctx.hint),
      details: describeDevice(ctx.userAgent, ctx.hint),
      lastSeenAt: new Date(),
      lastSeenIpHash: hashSessionIp(ctx.ip),
    })
    .returning({ id: schema.userDevices.id });
  return { token, deviceId: row.id, label };
}

/* ── 管理（我的裝置頁） ────────────────────────────────── */

export interface DeviceListItem {
  id: string;
  label: string;
  trustedAt: Date;
  lastSeenAt: Date | null;
  isCurrent: boolean;
  /** 廠牌／機型／OS／CPU／記憶體／顯示卡等細節，供使用者辨認是哪一台 */
  details: DeviceDetails | null;
}

/** 目前帳號已信任的裝置清單。永不回傳 tokenHash／ipHash／fingerprintHash。 */
export async function listUserDevices(
  userId: string,
  currentDeviceToken: string | undefined,
): Promise<DeviceListItem[]> {
  const rows = await db
    .select({
      id: schema.userDevices.id,
      tokenHash: schema.userDevices.tokenHash,
      label: schema.userDevices.label,
      trustedAt: schema.userDevices.trustedAt,
      lastSeenAt: schema.userDevices.lastSeenAt,
      details: schema.userDevices.details,
    })
    .from(schema.userDevices)
    .where(and(eq(schema.userDevices.userId, userId), isNull(schema.userDevices.revokedAt)))
    .orderBy(desc(schema.userDevices.lastSeenAt));
  const currentHash = currentDeviceToken ? sha256(currentDeviceToken) : undefined;
  return rows.map(({ tokenHash, details, ...rest }) => ({
    ...rest,
    details: (details as DeviceDetails | null) ?? null,
    isCurrent: currentHash != null && tokenHash === currentHash,
  }));
}

export type RevokeDeviceResult = "not_found" | "revoked" | "revoked_current";

/**
 * 移除一台已信任裝置。
 * ★連帶刪除該裝置簽發的所有 session——否則「移除裝置」只是讓下次登入要重驗，
 * 目前還開著的那台照樣能用，等於沒有真的踢掉（信任是永久制，這點更重要）。
 * 只能移除自己的裝置（以 userId 限定範圍，防 IDOR）。
 */
export async function revokeDevice(
  userId: string,
  deviceId: string,
  currentDeviceToken: string | undefined,
): Promise<RevokeDeviceResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: schema.userDevices.id, tokenHash: schema.userDevices.tokenHash })
      .from(schema.userDevices)
      .where(
        and(
          eq(schema.userDevices.id, deviceId),
          eq(schema.userDevices.userId, userId),
          isNull(schema.userDevices.revokedAt),
        ),
      );
    if (!row) return "not_found";
    await tx
      .update(schema.userDevices)
      .set({ revokedAt: new Date() })
      .where(eq(schema.userDevices.id, deviceId));
    await tx.delete(schema.sessions).where(eq(schema.sessions.deviceId, deviceId));
    const isCurrent = currentDeviceToken != null && row.tokenHash === sha256(currentDeviceToken);
    return isCurrent ? "revoked_current" : "revoked";
  });
}

/* ── 管理員預先授信（救援） ────────────────────────────────── */

export const DEVICE_GRACE_MINUTES = 30;

/** 豁免期是否仍有效 */
export function graceActive(deviceGraceUntil: Date | null | undefined, now: Date = new Date()): boolean {
  return deviceGraceUntil != null && deviceGraceUntil.getTime() > now.getTime();
}

/** 管理員給某帳號 30 分鐘的陌生裝置免驗窗口 */
export async function grantDeviceGrace(userId: string): Promise<Date> {
  const until = new Date(Date.now() + DEVICE_GRACE_MINUTES * 60_000);
  await db.update(schema.users).set({ deviceGraceUntil: until }).where(eq(schema.users.id, userId));
  return until;
}

/** 用掉豁免即清除（一次性，不留著給下次） */
export async function consumeDeviceGrace(userId: string): Promise<void> {
  await db.update(schema.users).set({ deviceGraceUntil: null }).where(eq(schema.users.id, userId));
}

/* ── 驗證碼比對 ────────────────────────────────── */

/**
 * 常數時間比較 6 碼驗證碼（比照 MCP 金鑰的 timingSafeEqual 口徑）。
 * 長度不同要先擋——timingSafeEqual 對長度不等會直接丟例外。
 */
export function codesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/* ── 陌生裝置挑戰 ────────────────────────────────── */

const MAX_ATTEMPTS = 5;
const CODE_TTL_MS = 10 * 60 * 1000;

/**
 * 驗證碼雜湊。與 emailStepUp 各自獨立（不同的 salt 前綴），
 * 一邊的挑戰不能拿去兌換另一邊。
 */
function hashCode(code: string): string {
  return createHash("sha256").update(`aios-device-login:${code}`).digest("hex");
}

/** 遮罩過的信箱：讓使用者確認信寄去哪，又不洩漏完整地址 */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  const masked = user.length <= 2 ? "*".repeat(user.length) : `${user[0]}***${user[user.length - 1]}`;
  return `${masked}@${domain}`;
}

/**
 * 驗證信內容：寫明是哪台裝置、什麼時候，以及「不是你本人」該怎麼辦。
 * 細節列得夠完整，使用者才判斷得出「這是不是我剛才登入的那台」——
 * 只寫「Windows · Chrome」的話，辦公室裡每台電腦看起來都一樣。
 */
export function buildDeviceChallengeEmail(
  label: string,
  code: string,
  now: Date = new Date(),
  details?: DeviceDetails | null,
): { subject: string; text: string } {
  const when = new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(now);
  const detailLines = deviceDetailLines(details).map((line) => `    ${line}`);
  return {
    subject: `AI Director OS 登入驗證碼 ${code}`,
    text: [
      "有人正在用你的帳號登入 AI Director OS：",
      "",
      `  裝置：${label}`,
      `  時間：${when}`,
      ...(detailLines.length ? ["", "  這台裝置的詳細資料：", ...detailLines] : []),
      "",
      "如果是你本人 —— 請在畫面上輸入這 6 個數字：",
      "",
      `  ${code}`,
      "",
      "這組號碼 10 分鐘後失效。",
      "",
      "如果不是你 —— 代表有人知道了你的密碼。",
      "請立刻登入系統改密碼，並通知管理員。",
    ].join("\n"),
  };
}

/**
 * 對陌生裝置發出信箱驗證挑戰。回傳的 challengeId 本身沒有任何 API 權限——
 * 它只是「密碼已驗過」的票根，要配上信箱收到的 6 碼才能換 session。
 */
export async function requestLoginDeviceChallenge(
  user: { id: string; email: string },
  ctx: DeviceContext,
): Promise<{ challengeId: string; emailMasked: string; expiresInSec: number; deviceLabel: string }> {
  const label = deviceLabelFrom(ctx.userAgent, ctx.hint);
  const details = describeDevice(ctx.userAgent, ctx.hint);
  const code = String(randomInt(100000, 999999));
  const [row] = await db
    .insert(schema.deviceChallenges)
    .values({
      userId: user.id,
      codeHash: hashCode(code),
      fingerprintHash: fingerprintOf(ctx.userAgent, ctx.hint),
      deviceLabel: label,
      details,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    })
    .returning({ id: schema.deviceChallenges.id });

  const mail = buildDeviceChallengeEmail(label, code, new Date(), details);
  const sent = await sendEmail({ to: user.email, subject: mail.subject, text: mail.text });
  // 寄不出去就必須讓使用者知道並重試——若吞掉錯誤，他會呆等一封永遠不會到的信。
  // （enforce 模式本來就要求信箱機制就緒，見 resolveDeviceTrustMode 的自動降級。）
  if (sent.status !== "sent") {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: sent.detail || "驗證碼寄送失敗，請稍後再試",
    });
  }
  return {
    challengeId: row.id,
    emailMasked: maskEmail(user.email),
    expiresInSec: Math.floor(CODE_TTL_MS / 1000),
    deviceLabel: label,
  };
}

export interface ConsumedDeviceChallenge {
  deviceLabel: string;
  details: DeviceDetails | null;
}

/**
 * 兌換陌生裝置挑戰。
 *
 * ★刻意不共用 emailStepUp 的 consumeEmailStepUp：那支在「信箱未設定」時直接 return（放行），
 * 對敏感操作是合理的優雅降級，但套到登入上等於「信箱一壞全世界免驗證進站」。
 * 登入這條路的降級決策必須由 DEVICE_TRUST_MODE 明確表達，不能藏在共用函式裡。
 */
export async function consumeLoginDeviceChallenge(input: {
  userId: string;
  challengeId: string;
  code: string;
  ctx: DeviceContext;
}): Promise<ConsumedDeviceChallenge> {
  const code = input.code.trim();
  if (!/^\d{6}$/.test(code)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "驗證碼是 6 個數字" });
  }
  const [row] = await db
    .select()
    .from(schema.deviceChallenges)
    .where(
      and(
        eq(schema.deviceChallenges.id, input.challengeId),
        eq(schema.deviceChallenges.userId, input.userId),
        isNull(schema.deviceChallenges.consumedAt),
      ),
    );
  if (!row) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "驗證碼無效或已使用，請重新登入取得新的驗證碼" });
  }
  if (row.expiresAt.getTime() < Date.now()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "驗證碼已過期（超過 10 分鐘），請重新登入取得新的" });
  }
  if (row.attemptCount >= MAX_ATTEMPTS) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "驗證次數太多，請重新登入取得新的驗證碼" });
  }
  // 裝置綁定：防「攻擊者在自己機器觸發挑戰、騙受害者唸出信裡的碼、於攻擊者機器兌換」。
  // 指紋在此處是硬條件（與 §6「指紋漂移不封鎖」不同）——那條講的是已信任裝置的日常登入，
  // 這裡是 10 分鐘內的單次兌換，同一台機器的指紋不會在這段時間內改變。
  if (row.fingerprintHash !== fingerprintOf(input.ctx.userAgent, input.ctx.hint)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "請在剛才要求登入的那台裝置上輸入驗證碼",
    });
  }
  if (!codesMatch(row.codeHash, hashCode(code))) {
    await db
      .update(schema.deviceChallenges)
      .set({ attemptCount: row.attemptCount + 1 })
      .where(eq(schema.deviceChallenges.id, row.id));
    const left = MAX_ATTEMPTS - (row.attemptCount + 1);
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: left > 0 ? `驗證碼不正確，還可以試 ${left} 次` : "驗證碼不正確，次數已用完，請重新登入",
    });
  }
  await db
    .update(schema.deviceChallenges)
    .set({ consumedAt: new Date() })
    .where(eq(schema.deviceChallenges.id, row.id));
  return { deviceLabel: row.deviceLabel, details: (row.details as DeviceDetails | null) ?? null };
}
