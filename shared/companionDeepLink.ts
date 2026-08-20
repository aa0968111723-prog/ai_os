/**
 * Companion → 完整 Web 工作站的深連結。
 *
 * ## 為什麼手機 App 要有「去瀏覽器看」這條路
 *
 * Companion 的產品定位是**隨身 AI 夥伴**，不是把 27 吋的工作台塞進 390px。
 * 分鏡編輯器、時間軸、素材管理器留在 Web；App 負責把人**準確地送到那一段**，
 * 而不是丟一個首頁讓他自己找。
 *
 * ## 網址契約以既有路由為準，不另發明
 *
 * 站內的專案網址是 `/p/:id`（不是 `/projects/:id`），分鏡與生成是同一頁的
 * **錨點**（`#stage-board` / `#stage-create`），動畫創作室才是獨立路由 `/studio/:id`。
 * 這裡一律走既有契約——自創一組 `/projects/:id/storyboard` 只會得到 404，
 * 而且是使用者在別的裝置上才會發現的那種 404。
 *
 * 錨點字串不在這裡硬寫，改由呼叫端從 `mobile/stages.ts` 的 `anchorForSection()`
 * 取（那份又是從 `STORY_INLINE_SECTIONS` 推導的）——本檔只認 section 名。
 *
 * ## 安全
 *
 * `companionDeepLink()` 只組**站內相對路徑**。要開外部瀏覽器時由呼叫端接上
 * origin，而 origin 只能來自 `location.origin` 或設定檔，永不來自模型輸出：
 * 讓 LLM 指定 host 等於讓它把使用者的 session 導去任何地方。
 */

export const COMPANION_DEEP_LINK_TARGETS = [
  "project",
  "storyboard",
  "assets",
  "production",
  "delivery",
  "characters",
  "scenes",
  "studio",
  "tasks",
  "projects",
  "notifications",
] as const;
export type CompanionDeepLinkTarget = typeof COMPANION_DEEP_LINK_TARGETS[number];

export interface CompanionDeepLinkInput {
  target: CompanionDeepLinkTarget;
  projectId?: string;
  /** 專案頁區段的實際 DOM 錨點；呼叫端用 anchorForSection() 取得 */
  anchorId?: string;
}

export interface CompanionDeepLink {
  /** 站內相對路徑（含 hash）。永遠以 "/" 開頭。 */
  path: string;
  /** 按鈕上的字 */
  label: string;
  /** 需要 projectId 卻沒拿到時為 true——呼叫端不該渲染這顆按鈕 */
  incomplete: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TARGET_LABEL: Record<CompanionDeepLinkTarget, string> = {
  project: "開啟完整專案",
  storyboard: "開啟分鏡",
  assets: "開啟素材",
  production: "開啟生成",
  delivery: "開啟交付",
  characters: "開啟角色",
  scenes: "開啟場景",
  studio: "開啟動畫創作室",
  tasks: "開啟任務中心",
  projects: "開啟全部專案",
  notifications: "開啟通知",
};

/** 需要專案才成立的目標；其餘是站級去處。 */
const NEEDS_PROJECT = new Set<CompanionDeepLinkTarget>([
  "project", "storyboard", "assets", "production", "delivery", "characters", "scenes", "studio",
]);

/**
 * 組出站內相對路徑。
 *
 * projectId 一定驗 UUID：這個值常常來自模型輸出或使用者語音轉出來的文字，
 * 沒驗就接進網址等於把任意字串塞進路由（`/p/../../admin` 之類）。
 * 驗不過就回 `incomplete`，呼叫端不渲染按鈕——不猜、不退回首頁假裝成功。
 */
export function companionDeepLink(input: CompanionDeepLinkInput): CompanionDeepLink {
  const label = TARGET_LABEL[input.target];
  const projectId = input.projectId && UUID_RE.test(input.projectId) ? input.projectId : undefined;
  if (NEEDS_PROJECT.has(input.target) && !projectId) {
    return { path: "/dashboard", label, incomplete: true };
  }
  switch (input.target) {
    case "studio":
      return { path: `/studio/${projectId}`, label, incomplete: false };
    case "project":
      return { path: `/p/${projectId}`, label, incomplete: false };
    case "tasks":
      return { path: "/collab", label, incomplete: false };
    case "projects":
      return { path: "/dashboard#projects", label, incomplete: false };
    case "notifications":
      return { path: "/collab", label, incomplete: false };
    default: {
      // 專案頁區段＝同一頁的錨點。沒拿到 anchorId 就退回專案頁本身：
      // 少捲一段比連到一個不存在的錨點好（後者看起來像按鈕壞了）。
      const hash = input.anchorId ? `#${input.anchorId}` : "";
      return { path: `/p/${projectId}${hash}`, label, incomplete: false };
    }
  }
}

/**
 * 相對路徑 → 可以交給系統瀏覽器的絕對網址。
 *
 * `origin` 必須由呼叫端提供（`location.origin`／設定），本函式不從輸入裡撈 host。
 * 傳進來的 path 只接受以單一 "/" 開頭者：`//evil.example` 會被瀏覽器當成
 * protocol-relative 的**外站**網址，那是這個檢查唯一想擋的東西。
 */
export function companionAbsoluteUrl(origin: string, path: string): string | null {
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  try {
    const base = new URL(origin);
    if (base.protocol !== "https:" && base.protocol !== "http:") return null;
    return new URL(path, base.origin).toString();
  } catch {
    return null;
  }
}

/**
 * aios:// 自訂 scheme → 站內相對路徑。
 *
 * ## 為什麼 App Links 優先、scheme 只是備援
 *
 * https App Links 在「未安裝 App」時自然退回瀏覽器；aios:// 在未安裝時
 * 什麼都不會發生（死連結）。所以站內所有對外分享、通知一律發 https 連結，
 * aios:// 只給「已知 App 在場」的表面用（桌面捷徑、Widget、App 內部）。
 *
 * ## 白名單解析，不是字串拼接
 *
 * scheme 的 host/path 可能來自任何發 intent 的 App——一律過白名單，
 * 對不上就回 null（呼叫端落到首頁），絕不把未知字串拼進路由。
 *
 * 這份對照表在 Java 端有一份鏡像（android/…/AiosSchemeRouter.java，
 * App 冷啟動時 WebView 還沒起來，只能在原生層轉譯）——兩邊要一起改，
 * companionDeepLink.test.ts 有一條測試盯著。
 *
 * 支援：
 *   aios://project/:id      → /p/:id
 *   aios://storyboard/:id   → /p/:id#stage-board
 *   aios://studio/:id       → /studio/:id
 *   aios://generation/:id   → /collab（生成細節的既有落點）
 *   aios://voice            → /?voice=1
 *   aios://tasks            → /?tab=tasks
 *   aios://home             → /
 */
export function parseAiosUri(uri: string): string | null {
  const m = /^aios:\/\/([a-z]+)(?:\/([0-9a-f-]{36}))?\/?$/i.exec(uri.trim());
  if (!m) return null;
  const [, host, id] = m;
  switch (host.toLowerCase()) {
    case "project":
      return id && UUID_RE.test(id) ? `/p/${id}` : null;
    case "storyboard":
      return id && UUID_RE.test(id) ? `/p/${id}#stage-board` : null;
    case "studio":
      return id && UUID_RE.test(id) ? `/studio/${id}` : null;
    case "generation":
      return id && UUID_RE.test(id) ? `/collab` : null;
    case "voice":
      return "/?voice=1";
    case "tasks":
      return "/?tab=tasks";
    case "home":
      return "/";
    default:
      return null;
  }
}

/**
 * 「這件事在瀏覽器看比較完整」的一句話。
 *
 * 講的是**理由**（畫面比較大／要拖曳），不是「App 不支援」——後者會讓人覺得
 * 買到了半成品。
 */
export function companionHandoffReason(target: CompanionDeepLinkTarget): string {
  switch (target) {
    case "storyboard":
      return "整份分鏡在大螢幕上看比較清楚，我幫你用瀏覽器打開。";
    case "assets":
      return "素材庫要一次看很多張，瀏覽器比較好挑。";
    case "studio":
      return "動畫創作室要拖曳與細調，用瀏覽器比較順手。";
    case "production":
      return "生成設定的選項比較多，瀏覽器上一次看得完。";
    default:
      return "這個畫面用瀏覽器看會比較完整。";
  }
}
