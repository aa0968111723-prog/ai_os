# 裝置綁定＋陌生裝置信箱驗證 設計

> 2026-07-31 · 依 Bruce 指示「登入偵測到手機登入就鎖定裝置並與帳號連結，陌生裝置要驗證信箱」
> 對應既有設計：[auth-design.md](./auth-design.md)、[../AI_Director_OS_安全設定規劃.md](../AI_Director_OS_安全設定規劃.md)

---

## 0. 先講一個硬限制：網頁拿不到「系統號」

這件事沒有繞路，先講清楚才不會設計錯：

**瀏覽器（含裝到主畫面的 PWA）讀不到手機 IMEI、電腦主機板序號、硬碟序號、MAC 位址。** 這是瀏覽器安全模型的硬性規定，所有網站都一樣 —— 銀行、Google、Facebook 也拿不到。只有「原生 App」（上架 App Store／Play 商店的那種）才拿得到部分裝置識別碼，而 AI Director OS 是網頁系統。

所以「鎖定系統號」在網頁上的**實際等價做法**是兩個東西合起來：

| | 是什麼 | 角色 |
|---|---|---|
| **裝置憑證 device token** | 伺服器發給這台裝置的一組長效隨機碼，存在瀏覽器的 httpOnly cookie 裡 | **主識別**。「這台裝置＝這組碼」，可靠、可撤銷 |
| **裝置特徵 fingerprint** | 作業系統家族、瀏覽器家族、螢幕解析度、時區、語言等被動特徵的雜湊 | **輔助訊號**。用來標示「憑證對但看起來換了台機器」的異常，以及給使用者看得懂的裝置名稱 |

**效果上跟你想要的一樣**：這台手機/電腦驗證過一次，之後就直接登入；換一台沒見過的，就要收信輸驗證碼。差別只在底層識別方式，不是硬體序號而是伺服器發的憑證 —— 這也是 Google、Apple、GitHub 在網頁端全部的做法。

一個要知道的取捨：device token 存在 cookie 裡，所以**清除瀏覽器資料、無痕模式、換瀏覽器，都會被當成新裝置**要重驗一次。這是無法避免的（沒有硬體序號可綁），但實務上一年可能發生一兩次，可以接受。

---

## 1. 設計目標

1. 帳號密碼**外洩也不夠用** —— 攻擊者在陌生裝置上還是進不來，除非同時控制了受害者的信箱。
2. **自己人幾乎無感** —— 常用的手機和電腦驗證一次之後，登入體驗跟現在完全一樣。
3. **不能把人鎖在門外** —— 尤其不能把超管鎖在門外（見 §7 救援機制，這是本設計風險最高的地方）。
4. 沿用既有基礎建設：PostgreSQL 限流、審計、Resend 寄信、cookie 慣例，不引入新相依套件。

---

## 2. 架構關鍵決定：閘門放在「發 session」，不是放在每支 API

這是整份設計最重要的一點。

現況 `server/index.ts` 有 **25 處以上**呼叫 `resolveSession()`（各種上傳、下載、匯出、日曆、MCP、WebSocket）。如果裝置檢查放在「每個 API 進來時檢查」，就得一處處補 —— 而這個坑專案已經踩過一次：`mustChangePassword` 當初就是漏了 REST 端點，後來才補出 `resolveActiveSession()`（見 `server/services/auth.ts` 的 AUTH2-003 註解）。

**本設計改成：裝置沒通過驗證，就根本不發 session token。**

結果是：

- 所有既有 `resolveSession` 呼叫點 → **自動受保護，零改動**
- WebSocket（靠 session cookie）→ 自動受保護
- 未來新增的任何端點 → 自動受保護，不會有人忘記加閘門

唯一要改的是 `auth.login` 這一支，以及新增一支 `auth.verifyDevice`。

### 明確排除：MCP 金鑰

`mcp_tokens` 是給外部 AI 客戶端（Claude Desktop 等）的長期金鑰，不走瀏覽器、沒有 cookie，**不套用裝置綁定**（套了會直接打壞所有 MCP 連線）。

這不是漏洞：要建立 MCP 金鑰必須先登入網頁，而登入已被裝置閘門守住。所以「拿到帳密但過不了裝置關」的攻擊者，也沒辦法改走 MCP 繞過。MCP 金鑰自己的收緊手段是既有的短效期＋唯讀＋撤銷。

---

## 3. 資料表（新增 2 張、既有改 1 欄）

### 3.1 `user_devices` — 已信任的「人＋裝置」配對

```ts
export const userDevices = pgTable("user_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  /** SHA-256（非原文）：比照 sessions.tokenHash，DB 外洩不可直接冒用裝置 */
  tokenHash: text("token_hash").notNull().unique(),
  /** 給人看的裝置名稱，如「iPhone · Safari」「Windows · Chrome」 */
  label: text("label").notNull(),
  /** 穩定被動特徵的雜湊——只作異常訊號，不作主識別 */
  fingerprintHash: text("fingerprint_hash").notNull(),
  /** 最近一次以此裝置成功登入 */
  lastSeenAt: timestamp("last_seen_at"),
  /** HMAC 後的 IP（比照 rate_limit_buckets 慣例，原始 IP 不落 DB） */
  lastSeenIpHash: text("last_seen_ip_hash"),
  /** 信任到期時刻（null＝到撤銷為止）；預設 90 天 */
  expiresAt: timestamp("expires_at"),
  /** 撤銷時刻——非 null 即拒；不硬刪，保留審計歸屬 */
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("user_devices_user_idx").on(t.userId),
}));
```

注意是 **(人, 裝置) 配對**不是單純「裝置」：同一台辦公室電腦上，A 驗過不代表 B 也算驗過，各自驗一次。這是正確的行為。

### 3.2 `device_challenges` — 陌生裝置的信箱驗證挑戰

```ts
export const deviceChallenges = pgTable("device_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  /** 回給前端的一次性票根（非驗證碼）；DB 存 SHA-256 */
  ticketHash: text("ticket_hash").notNull().unique(),
  /** 6 位數驗證碼的 HMAC-SHA-256（見下方註記為何不用 bcrypt） */
  codeHash: text("code_hash").notNull(),
  /** 綁定發起的那台裝置：防「在 A 電腦觸發、把碼拿到 B 電腦兌換」 */
  fingerprintHash: text("fingerprint_hash").notNull(),
  label: text("label").notNull(),
  /** 錯誤嘗試次數，達上限即作廢 */
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at").notNull(),   // 10 分鐘
  consumedAt: timestamp("consumed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("device_challenges_user_idx").on(t.userId),
  expiresIdx: index("device_challenges_expires_idx").on(t.expiresAt),
}));
```

**為何驗證碼用 HMAC-SHA-256 不用 bcrypt**：6 位數只有 100 萬種組合，bcrypt 擋不住有 DB 的離線暴力（幾小時就掃完），卻會讓每次線上驗證多花 100ms。真正的防線是「10 分鐘過期＋最多 5 次嘗試＋限流」，那讓線上猜中機率是 5/1,000,000。HMAC 用來防「DB 外洩者直接讀到明碼」，這個目的 SHA-256 就夠。

### 3.3 `sessions` 加一欄

```sql
ALTER TABLE "sessions" ADD COLUMN "device_id" uuid;
```

Nullable，所以**上線時既有登入者不會被踢出去**（向前相容，比照專案既有 migration 慣例）。有了這欄，「撤銷某台裝置」就等於 `DELETE FROM sessions WHERE device_id = ?` —— 該裝置立刻登出。

---

## 4. 登入流程

### 4.1 `auth.login`（改）

```
1. 限流檢查（沿用現有 checkLoginRate，per-email + per-IP）
2. 密碼驗證（沿用現有 verifyPasswordOrDummy 防帳號枚舉）
3. 讀 aidos_device cookie
   ├─ 有 → 查 user_devices（token_hash 相符 ∧ user_id 相符 ∧ 未撤銷 ∧ 未過期）
   │   ├─ 命中 → ✅ 建 session（帶 deviceId）、更新 lastSeenAt → 回 AuthState
   │   │          ※ 若指紋和當初差異大 → 照樣放行，但寫審計＋寄提醒信（不擋，見 §6）
   │   └─ 未命中（別人的票／已撤銷／已過期）→ 當陌生裝置
   └─ 無 → 陌生裝置
4. 陌生裝置：
   ├─ 產 6 位數驗證碼、建 device_challenge（10 分鐘、綁指紋）
   ├─ 寄信到帳號 email
   ├─ ❌ 不建 session、不發 cookie
   └─ 回 { status: "device_verification_required", ticket, maskedEmail: "aa0***@gmail.com" }
```

**關鍵**：第 4 步「不建 session」就是整個安全性的來源。密碼對了也只拿到一張 ticket，ticket 沒有任何 API 權限。

### 4.2 `auth.verifyDevice`（新增）

```
1. 限流（新 scope auth:device-verify，per-ticket + per-IP）
2. 查 challenge：未過期 ∧ 未用過 ∧ attempts < 5
3. 比對指紋 —— 防「A 裝置發起、B 裝置兌換」
4. 常數時間比對驗證碼（timingSafeEqual，比照既有 MCP 金鑰比對）
   └─ 錯 → attempts++，回「還可以試 N 次」
5. 對 → 單一交易內完成：
   ├─ 標記 challenge consumed
   ├─ 建 user_devices 列、發新 device token
   ├─ 建 session（帶 deviceId）
   ├─ 設兩個 cookie：aidos_session（30 天）+ aidos_device（90 天）
   ├─ 寫審計
   └─ 若使用者已有其他裝置 → 對其他裝置寄「新裝置已加入」通知信
```

交易包起來的理由跟既有 `changePassword` 一樣：不能留下「裝置記了但 session 沒發」或反之的半套狀態。

### 4.3 `auth.resendDeviceCode`（新增）

60 秒冷卻、每張 ticket 最多重寄 3 次。重寄會換新碼並作廢舊碼。

---

## 5-A. 裝置細節：實際拿得到多細

「這台裝置」除了用來比對，也要讓人**認得出是哪一台**。辦公室裡每台都寫「Windows · Chrome」等於沒寫。

透過 **UA Client Hints** 取高熵資訊，各平台實際能拿到的差很多：

| 裝置 | 拿得到 | 拿不到 |
|---|---|---|
| **Android + Chrome/Edge** | **實際機型**（`Pixel 8`、`SM-S928B`＝三星 S24 Ultra，可推廠牌）、Android 版本、CPU 架構、核心數、記憶體 | IMEI、序號 |
| **Windows/macOS + Chrome/Edge** | **可分辨 Win10／Win11**、CPU 架構與位元數、核心數、記憶體、**顯示卡型號** | 主機板序號、MAC、電腦廠牌型號 |
| **iPhone / iPad（Safari）** | 只有 `iPhone`／`iPad` ＋ iOS 版本 | **機型 —— Apple 刻意封鎖，iPhone 12 與 16 在網頁上完全一樣** |
| **Firefox** | 螢幕／時區／語言／核心數 | 不支援 UA Client Hints |

實機（本專案開發機）抓到的樣子：

```
系統：Windows 11｜瀏覽器：Chrome 148.0.7778.280
處理器：X86 · 64 位元 · 16 核心｜記憶體：16 GB
螢幕：1466x825 @1.31x｜顯示卡：Intel(R) UHD Graphics
```

Apple 裝置會直接寫明「Apple 不對網頁公開機型」，免得被當成功能壞掉回報。

**硬體序號／IMEI／MAC 一律拿不到**（§0），這條沒有例外。

### ★ 細節與比對必須分開

這是本節最重要的一點：

| | 內容 | 用途 |
|---|---|---|
| **指紋**（`fingerprintOf`） | 機型、架構、位元數、記憶體、觸控點數、螢幕、時區、語言 —— **全是硬體特性** | 機器比對 |
| **細節**（`describeDevice` → `user_devices.details`） | OS 版本、瀏覽器版本、顯示卡、像素倍率 | 給人辨認 |

**顯示用細節一律不進指紋。** 這些值會隨每月的系統更新、瀏覽器更新、顯示卡驅動更新而漂移；只要有一個進了指紋，就等於每個月要求全公司重驗一次信箱 —— 使用者會被訓練成「看到驗證碼就無腦輸入」，那比不做驗證還危險。`deviceTrust.test.ts` 有三項測試專門守住這條界線。

---

## 5. 裝置特徵要用哪些欄位（以及不用哪些）

**要用**（都選穩定的，避免天天要求重驗）：

- 作業系統家族（Windows / macOS / iOS / Android / Linux）——**不含版本號**
- 瀏覽器家族（Chrome / Safari / Edge / Firefox）——**不含版本號**
- `screen.width × screen.height`（用 `screen` 不是 `window`，換視窗大小不影響）
- 時區（`Intl.DateTimeFormat().resolvedOptions().timeZone`）
- 語言（`navigator.language`）
- CPU 核心數（`navigator.hardwareConcurrency`）

**刻意不用**：Canvas 指紋、WebGL 指紋、AudioContext 指紋、字型列舉。理由有三：這類技術是廣告商追蹤用的手法、隱私侵入且瀏覽器正在積極封鎖（Safari 已部分擋掉）、結果不穩定會造成誤判。這也符合專案既有「原始識別值不落 DB」的隱私慣例。

**版本號一律排除**是重點：Chrome 每四週自動更新一次版本號，含版本號的指紋等於每個月讓全公司重驗一次，使用者會被訓練成「看到驗證碼就無腦輸入」—— 那比不做還危險。

---

## 6. 指紋不符時：提醒，不封鎖

device token 對、但指紋變了（例如換了外接螢幕、系統升級、出國換時區）——**照樣放行**，只寫審計＋寄一封提醒信。

理由：指紋本來就會漂移，拿它當封鎖條件會製造大量假警報。真正該擋的情境（憑證被偷到另一台機器）其實靠「偷 cookie」門檻已經很高，而且那種攻擊者連 session cookie 都偷得到，擋 device cookie 沒有意義。

---

## 7. 鎖死風險與救援機制 ⚠️ 本設計風險最高的部分

**最壞情況**：你換了新手機 → 要驗信箱 → 但信箱剛好登不進去／`RESEND_API_KEY` 過期 → **整個系統沒有人能登入，包含超管，且沒有任何後門**。

三道保險：

### 7.1 分段上線：`DEVICE_TRUST_MODE` 環境變數

| 值 | 行為 |
|---|---|
| `off` | 完全不啟用（預設值，程式上線但不生效） |
| `monitor` | **記錄＋寄通知信，但照樣放行** |
| `enforce` | 真的擋下陌生裝置 |

**強烈建議先跑 `monitor` 兩週**，觀察：實際每週產生多少次陌生裝置事件？指紋穩不穩？信真的寄得出去嗎？確認數字合理再切 `enforce`。直接上 `enforce` 是拿正式站賭博。

### 7.2 開機自檢

`boot.ts` 啟動時檢查：若 `DEVICE_TRUST_MODE=enforce` 但 `isEmailConfigured()` 為 false（沒設 `RESEND_API_KEY`／`EMAIL_FROM`），就 **拒絕以 enforce 啟動**，自動降級成 `monitor` 並在 log 大聲警告、管理頁顯示紅字。

沒有信箱機制卻開啟強制驗證 ＝ 保證把所有人鎖在門外，這一定要在開機時就攔下來。

### 7.3 管理員預先授信 ＋ 超管 break-glass

- **管理員**可對某位使用者按「允許下一次新裝置登入（30 分鐘內免驗）」，處理「同事在國外收不到信」這類日常狀況。此操作寫審計。
- **超管自己**另外保留 `DEVICE_TRUST_BREAKGLASS_UNTIL=<ISO 時間>` 環境變數：設一個未來時刻，該時刻前超管登入免裝置驗證。用完即刪。這是 Railway Variables 改一下就能自救的路，不需要進資料庫。

---

## 8. 使用者體驗

### 驗證頁
- 6 格數字輸入，自動聚焦、支援整串貼上、輸滿自動送出
- 「記住這台裝置 90 天」**預設勾選**；不勾選則只信任本次瀏覽器工作階段
- 「重寄驗證碼」按鈕（60 秒冷卻，顯示倒數）
- 顯示遮罩過的信箱：`aa0***@gmail.com`（確認信寄去哪，又不洩漏完整地址）

### 驗證信內容（人話，非技術用語）

```
主旨：AI Director OS 登入驗證碼 483920

有人正在用你的帳號登入 AI Director OS：

  裝置：iPhone · Safari
  時間：2026年7月31日 下午 2:35

如果是你本人 —— 請在畫面上輸入這 6 個數字：

  483920

這組號碼 10 分鐘後失效。

如果不是你 —— 代表有人知道了你的密碼。
請立刻登入系統改密碼，並通知管理員。
```

### 「我的裝置」管理頁
帳號設定新增一區，列出所有已信任裝置：名稱、最後使用時間、目前這台會標示「目前使用中」。每台可「移除」—— 移除即刻踢掉該裝置所有登入狀態（`DELETE sessions WHERE device_id`）。

### 兩個要在說明文字寫清楚的行為
1. **清除瀏覽器資料／無痕模式** → 會被當成新裝置要重驗。
2. **手機上的「Safari」和「加到主畫面的 App」是兩個獨立空間**（iOS 的限制），同一支手機會出現兩台裝置。UI 標籤要能區分：「iPhone · Safari」vs「iPhone · 主畫面App」。

---

## 9. 限流

新增兩個 scope（沿用既有 PostgreSQL 滑動視窗，跨 replica 持久）：

```ts
deviceVerify:    { limit: 10, windowMs: 15 * 60_000 },  // 驗證碼提交
deviceChallenge: { limit: 5,  windowMs: 60 * 60_000 },  // 每人每小時最多觸發 5 次挑戰
```

第二個是防「攻擊者拿正確密碼狂觸發，把受害者信箱洗版」（郵件轟炸）。

---

## 10. 實作順序

| # | 項目 | 檔案 |
|---|---|---|
| 1 | schema 兩張新表＋`sessions.device_id` | `server/db/schema/auth.ts` |
| 2 | migration `0012_device_trust.sql` | `drizzle/` |
| 3 | 裝置服務（發票、驗碼、信任、撤銷、指紋雜湊） | `server/services/deviceTrust.ts`（新） |
| 4 | 驗證信模板 | `server/services/email.ts` 沿用 |
| 5 | `auth.login` 改流程、`verifyDevice`／`resendDeviceCode` 新增 | `server/routers/auth.ts` |
| 6 | 限流 scope | `server/services/rateLimit.ts` |
| 7 | 開機自檢（enforce 但無信箱→降級） | `server/services/boot.ts` |
| 8 | 登入頁驗證碼步驟 | `client/src/pages/LoginPage.tsx` |
| 9 | 「我的裝置」管理頁 | `client/src/pages/`（新） |
| 10 | 管理員預先授信 | `server/routers/admin.ts` |
| 11 | 單元測試＋e2e | `*.test.ts`、`e2e/` |

前 7 項是後端，可獨立上線跑 `monitor` 模式；8–10 是使用者介面。

---

## 11. 已拍板（Bruce 2026-07-31）

| # | 問題 | 決定 |
|---|---|---|
| 1 | 每人裝置數上限 | **不設上限**，每台驗一次就好 |
| 2 | 信任期限 | **永久，直到手動移除**（故 `user_devices` 無 `expiresAt`；「我的裝置」移除鈕是唯一解除途徑，因此是必要功能不是加分項） |
| 3 | 上線模式 | **先 `monitor` 兩週再 `enforce`** |

---

## 12. 實作狀態（2026-07-31）

實作與本設計的差異，以及實際落點：

### 挑戰用獨立的 `device_challenges` 表（曾走過一次彎路）

實作中途曾改成「沿用既有的 `email_step_up_challenges`，只加兩個 nullable 欄位」，理由是少一張近乎重複的表。**CI 打回來了**，而且理由是對的：

`legacy adoption bridge`（讓舊 pushSchema 時代的資料庫接上 migration ledger 的機制）比對的是「drizzle 產生的整表 DDL」——那是**含全部欄位的單一 `CREATE TABLE`**。若在同一批 pending migration 裡「先 `CREATE TABLE` 再 `ALTER ADD COLUMN` 同一張表」，兩邊文字就對不起來，bridge 判為非預期 drift。

要讓那個做法成立，得去改**別人已發布的** `0014_email_step_up.sql` 並登記 `SUPERSEDED_MIGRATION_HASHES`。但那份清單的規則是「修正後的檔案在原版成功的每個資料庫上**可證明等價**」——我這個情況只有跑完整條鏈的最終狀態等價、中間狀態並不等價。放寬那條規則不該由這個功能來決定。

所以回到原設計：**獨立的 `device_challenges` 表**。除了避開上述問題，它本身也更正確：

- **語意不同**：step-up 是「已登入者要做敏感操作」，這裡是「還沒有 session 的登入關卡」
- **降級策略相反**：`consumeEmailStepUp` 在信箱未設定時直接放行，對敏感操作是合理的優雅降級；套到登入上卻等於「信箱一壞全世界免驗證進站」。登入的降級決策必須由 `DEVICE_TRUST_MODE` 明確表達，不能藏在共用函式裡
- step-up 沒有「綁定發起裝置指紋」的概念

**教訓寫進 migration 註解**：新表的所有欄位都要寫在 `CREATE TABLE` 裡，不要在同一批 pending migration 內用 `ALTER` 補欄位。

### monitor 模式會自動信任新裝置
原設計只說「記錄不擋」。實作讓 monitor **同時把裝置寫進信任名單**——這樣切到 `enforce` 那天，大家慣用的手機電腦都已在名單上，不會全公司同時被要求驗證。這是暖身期真正的價值。

### cookie 疊加
`setSessionCookie` 由 `res.setHeader` 改為 `res.append`。`setHeader` 會覆寫整個 `Set-Cookie` 標頭，session 與 device 兩個 cookie 會互相洗掉（症狀是每次登入都被當陌生裝置）。每條回應路徑最多設一次 session cookie，故對既有行為無影響。

### 落點
| 項目 | 檔案 |
|---|---|
| schema（`user_devices`、`sessions.device_id`、`users.device_grace_until`、step-up 兩欄） | `server/db/schema/auth.ts` |
| migration | `drizzle/0022_device_trust.sql`（全 `IF NOT EXISTS`，已納入 legacy bridge 允許清單） |
| 核心服務 | `server/services/deviceTrust.ts` |
| 登入流程／`verifyDevice`／`listDevices`／`revokeDevice` | `server/routers/auth.ts` |
| 管理員預先授信 | `server/routers/admin.ts`（`grantDeviceGrace`，與重設密碼共用 `assertCanAdministerMember` 權限階梯） |
| 開機告警＋系統自檢 | `server/index.ts` |
| 登入頁驗證碼步驟 | `client/src/pages/LoginPage.tsx` |
| 「信任裝置」管理 | `client/src/components/NotificationSettings.tsx` |
| 裝置特徵收集 | `client/src/deviceHint.ts` |
| 環境變數說明 | `.env.example` |

測試：`server/services/deviceTrust.test.ts`（27 項）、`client/src/pages/LoginPage.deviceTrust.test.tsx`（10 項）。

### 上線步驟
1. 部署（此時 `DEVICE_TRUST_MODE` 未設＝`off`，行為與過去完全相同）。
2. 管理頁按「寄測試信給自己」，確認信箱機制真的寄得出去。
3. Railway Variables 設 `DEVICE_TRUST_MODE=monitor` → redeploy。觀察兩週：
   系統自檢頁看模式、伺服器 log 搜 `[audit] deviceTrust` 看實際產生多少新裝置事件。
4. 確認大家的常用裝置都已進名單後，改 `DEVICE_TRUST_MODE=enforce` → redeploy。
