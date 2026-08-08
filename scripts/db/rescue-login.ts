/**
 * 帳號進不去時的離線救援工具（直連資料庫，不經過任何 HTTP 端點）。
 *
 * 為什麼需要它：登入頁只有一句「忘記密碼請找管理員重設」，但這條路對**最上層的開發者帳號**
 * 是死路——它上面沒有管理員。而 services/seed.ts 對既有帳號「絕不覆寫 passwordHash」
 * （刻意的設計：避免任何人靠改環境變數＋重啟就接管線上帳號），所以設 SEED_ADMIN_PASSWORD
 * 再重開機也救不回來。剩下唯一的出口就是握有資料庫的人在機器上跑一支工具，也就是這支。
 *
 * 使用（在**與 API 相同的環境**執行，才讀得到同一個 DATABASE_URL／RATE_LIMIT_SECRET）：
 *
 *   # 1) 只診斷，不改任何東西（預設行為）
 *   npm run rescue:login -- --email=you@example.com
 *
 *   # 2) 解除「嘗試太多次」的登入限流
 *   npm run rescue:login -- --email=you@example.com --unlock
 *
 *   # 3) 重設密碼（不給值就產生一組隨機密碼並印出來，只印這一次）
 *   npm run rescue:login -- --email=you@example.com --unlock --reset-password
 *
 *   # 4) 自己指定密碼，且不要進強制改密碼流程
 *   npm run rescue:login -- --email=you@example.com --unlock --reset-password=你的新密碼 --no-force-change
 *
 * ★ 這支工具會印出明文密碼，請在自己的終端機執行，不要把輸出貼到公開頻道或 log 服務。
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, pool, schema } from "../../server/db";
import {
  deriveRateLimitIdentity,
  normalizeRateLimitState,
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_SCOPES,
} from "../../server/services/rateLimit";
import { runCli } from "./cli";

/**
 * 與 services/auth.hashPassword 相同的 bcrypt 成本。
 *
 * 這裡刻意不 import services/auth：它會連帶拉進 userAvatar → storage，而 storage 在模組載入時
 * 就會摸檔案系統／物件儲存設定——救援工具跑在「東西已經壞掉」的環境，多一個載入期副作用
 * 就多一種救不了的死法。bcrypt 的成本寫在雜湊字串裡，比對時自動沿用，故兩邊即使日後不同步
 * 也只是強度差異，不會讓密碼驗不過。
 */
const BCRYPT_COST = 10;

/** 與 services/rateLimit 的 MIN_PRODUCTION_SECRET_LENGTH 一致（該常數未匯出）。 */
const MIN_RATE_LIMIT_SECRET_LENGTH = 32;

/** 管理員預先授信的長度，與 routers/auth 的「按一次給 30 分鐘」一致。 */
const DEVICE_GRACE_MS = 30 * 60_000;

interface Options {
  email: string;
  unlock: boolean;
  unlockAllAuth: boolean;
  ip?: string;
  resetPassword: boolean;
  newPassword?: string;
  forceChange?: boolean;
  activate: boolean;
  grace: boolean;
  revokeSessions: boolean;
}

function parseArgs(argv: string[]): Options {
  const get = (name: string): string | undefined => {
    const hit = argv.find((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
    if (hit == null) return undefined;
    const eq = hit.indexOf("=");
    return eq === -1 ? "" : hit.slice(eq + 1);
  };
  const has = (name: string) => get(name) != null;

  const email = get("email")?.trim().toLowerCase();
  if (!email) {
    throw new Error(
      "用法：npm run rescue:login -- --email=you@example.com [--unlock] [--reset-password[=新密碼]] "
      + "[--ip=1.2.3.4] [--unlock-all-auth] [--activate] [--grace] [--revoke-sessions] [--force-change|--no-force-change]",
    );
  }
  const resetValue = get("reset-password");
  const newPassword = resetValue ? resetValue : undefined;
  if (newPassword != null && newPassword.length < 8) {
    throw new Error("--reset-password 指定的密碼至少 8 個字（不指定值則自動產生）");
  }
  return {
    email,
    unlock: has("unlock"),
    unlockAllAuth: has("unlock-all-auth"),
    ip: get("ip")?.trim() || undefined,
    resetPassword: resetValue != null,
    newPassword,
    // 未指定時交由呼叫端決定：自動產生的臨時密碼＝強制改，自己指定的密碼＝不強制。
    forceChange: has("force-change") ? true : has("no-force-change") ? false : undefined,
    activate: has("activate"),
    grace: has("grace"),
    revokeSessions: has("revoke-sessions"),
  };
}

/** 只遮到看得出是哪個帳號、又不至於整串外流的程度。 */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const head = local.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, local.length - head.length))}@${domain}`;
}

function hasRateLimitSecret(): boolean {
  return (process.env.RATE_LIMIT_SECRET?.trim() ?? "").length >= MIN_RATE_LIMIT_SECRET_LENGTH;
}

function requireRateLimitSecret(): void {
  if (hasRateLimitSecret()) return;
  throw new Error(
    "解除限流需要與 API 相同的 RATE_LIMIT_SECRET（限流的 key 是 HMAC，算錯就會靜靜地清到別的桶、看起來成功其實沒解）。"
    + "請在部署平台的同一個環境執行本工具；真的拿不到時改用 --unlock-all-auth（清掉全站登入限流桶，不需要密鑰）。",
  );
}

/** 讀出某個限流桶目前還要等多久（不消耗額度，純觀察）。 */
async function inspectAuthBucket(
  scope: string,
  subject: string,
  windowMs: number,
  limit: number,
): Promise<{ hits: number; retryAfterMin: number } | null> {
  const identity = deriveRateLimitIdentity(scope, subject);
  const [row] = await db
    .select({ state: schema.rateLimitBuckets.state })
    .from(schema.rateLimitBuckets)
    .where(eq(schema.rateLimitBuckets.keyHash, identity.keyHash));
  if (!row) return null;
  const now = Date.now();
  const state = normalizeRateLimitState(row.state);
  const hits = state.hits.filter((hit) => hit > now - windowMs && hit <= now);
  if (hits.length < limit) return { hits: hits.length, retryAfterMin: 0 };
  return { hits: hits.length, retryAfterMin: Math.max(1, Math.ceil((hits[0] + windowMs - now) / 60_000)) };
}

async function deleteBucket(scope: string, subject: string): Promise<void> {
  const identity = deriveRateLimitIdentity(scope, subject);
  await db.delete(schema.rateLimitBuckets).where(eq(schema.rateLimitBuckets.keyHash, identity.keyHash));
}

void runCli(async () => {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 未設定——請在與 API 相同的環境執行");

  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, options.email));

  console.log(`[rescue] 帳號：${maskEmail(options.email)}`);
  if (!user) {
    // 這本身就是答案：不是密碼記錯，是這個 email 在這個資料庫裡根本沒有帳號
    // （最常見的是連錯環境——測試站與正式站各有一份資料）。
    console.log("[rescue] 查無此帳號。請確認 email 拼字，以及這支工具連到的是不是正式站的資料庫。");
    return;
  }

  console.log(`[rescue] 狀態：status=${user.status} superAdmin=${user.isSuperAdmin} mustChangePassword=${user.mustChangePassword}`);
  console.log(`[rescue] 建立於 ${user.createdAt.toISOString()}；裝置豁免 ${user.deviceGraceUntil?.toISOString() ?? "無"}`);

  // 診斷三件事，對應「進不去」的三種成因：限流、帳號被停用、裝置驗證。
  //
  // ★沒有密鑰時限流那兩行是不可信的：桶的 key 是 HMAC(scope+subject, RATE_LIMIT_SECRET)，
  // 密鑰不同就算出不同的 key、查不到那一列，於是顯示「沒有紀錄＝沒被鎖」——而使用者明明正被鎖著。
  // 這種「安靜地說反話」比沒有診斷更糟，所以先把話講在前面。
  if (!hasRateLimitSecret()) {
    console.warn("[rescue] 警告：未設定 RATE_LIMIT_SECRET，以下限流診斷不準（會把「查不到桶」誤報成「沒被鎖」）");
  }
  const emailBucket = await inspectAuthBucket(
    RATE_LIMIT_SCOPES.authEmail,
    options.email,
    RATE_LIMIT_POLICIES.authEmail.windowMs,
    RATE_LIMIT_POLICIES.authEmail.limit,
  );
  console.log(
    emailBucket == null
      ? "[rescue] 登入限流（帳號）：沒有紀錄＝現在沒被鎖"
      : `[rescue] 登入限流（帳號）：視窗內 ${emailBucket.hits}/${RATE_LIMIT_POLICIES.authEmail.limit} 次`
        + (emailBucket.retryAfterMin > 0 ? `，還要等約 ${emailBucket.retryAfterMin} 分鐘` : "，未達上限"),
  );
  if (options.ip) {
    const ipBucket = await inspectAuthBucket(
      RATE_LIMIT_SCOPES.authIp,
      options.ip,
      RATE_LIMIT_POLICIES.authIp.windowMs,
      RATE_LIMIT_POLICIES.authIp.limit,
    );
    console.log(
      ipBucket == null
        ? "[rescue] 登入限流（IP）：沒有紀錄"
        : `[rescue] 登入限流（IP）：視窗內 ${ipBucket.hits}/${RATE_LIMIT_POLICIES.authIp.limit} 次`,
    );
  }

  const [sessions] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, user.id), gt(schema.sessions.expiresAt, new Date())));
  console.log(`[rescue] 未過期 session：${sessions?.count ?? 0} 筆`);

  const mutations = options.unlock || options.unlockAllAuth || options.resetPassword
    || options.activate || options.grace || options.revokeSessions;
  if (!mutations) {
    console.log("[rescue] 診斷模式（沒有加任何動作旗標），未變更任何資料。");
    return;
  }

  if (options.unlock) {
    requireRateLimitSecret();
    await deleteBucket(RATE_LIMIT_SCOPES.authEmail, options.email);
    if (options.ip) await deleteBucket(RATE_LIMIT_SCOPES.authIp, options.ip);
    console.log(`[rescue] 已清除登入限流（帳號${options.ip ? "＋指定 IP" : ""}）`);
  }

  if (options.unlockAllAuth) {
    // 不需要 RATE_LIMIT_SECRET 的逃生門：整批清掉登入相關的桶。
    // 代價是全站所有人的登入失敗計數一起歸零——對小團隊的一次性救援可以接受，
    // 但它同時抹掉「有人正在暴力嘗試」的證據，所以不是預設行為。
    const scopes = [RATE_LIMIT_SCOPES.authEmail, RATE_LIMIT_SCOPES.authIp];
    for (const scope of scopes) {
      await db.delete(schema.rateLimitBuckets).where(eq(schema.rateLimitBuckets.scope, scope));
    }
    console.log("[rescue] 已清除全站登入限流桶（auth:email／auth:ip）");
  }

  if (options.activate && user.status !== "active") {
    await db.update(schema.users).set({ status: "active" }).where(eq(schema.users.id, user.id));
    console.log("[rescue] 已把帳號狀態改回 active");
  }

  if (options.resetPassword) {
    // 沒指定就給一組夠長的隨機密碼；base64url 讓它能安全地手打／複製，不含引號與空白。
    const generated = options.newPassword == null;
    const password = options.newPassword ?? randomBytes(12).toString("base64url");
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    // 自動產生＝臨時密碼，交接後應立刻改；自己指定＝本人設定的，強制再改一次只會把人推進
    // 「強制改密碼對話框 ×changePassword 限流」的死路（docs/細節缺漏盤點-初步.md 已列為缺口）。
    const mustChangePassword = options.forceChange ?? generated;
    await db
      .update(schema.users)
      .set({ passwordHash, mustChangePassword, status: "active" })
      .where(eq(schema.users.id, user.id));
    console.log(`[rescue] 已重設密碼（mustChangePassword=${mustChangePassword}）`);
    if (generated) console.log(`[rescue] 新密碼（只顯示這一次）：${password}`);
  }

  if (options.revokeSessions) {
    // 與 services/auth.destroyAllUserSessions 同一個做法：session 沒有 revoked 欄位，直接刪列。
    const deleted = await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.userId, user.id))
      .returning({ id: schema.sessions.id });
    console.log(`[rescue] 已撤銷此帳號所有既有 session（${deleted.length} 筆）`);
  }

  if (options.grace) {
    const until = new Date(Date.now() + DEVICE_GRACE_MS);
    await db.update(schema.users).set({ deviceGraceUntil: until }).where(eq(schema.users.id, user.id));
    console.log(`[rescue] 已給予裝置驗證豁免至 ${until.toISOString()}（約 30 分鐘，用掉即清除）`);
  }

  console.log("[rescue] 完成。請立刻回登入頁試一次；若仍失敗，把上面的診斷行貼給維護者。");
}).finally(() => {
  void pool.end();
});
