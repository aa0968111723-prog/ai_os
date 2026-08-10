import { DESTINATIONS } from "./navigation/navigationItems";

/**
 * 瀏覽器分頁標題（document.title）。
 *
 * 去處名稱一律以 DESTINATIONS（全站單一真相表）為準——分頁標題與選單同一個名字，
 * 避免「選單叫資料中心、分頁叫知識資料」的同頁兩名問題（見 navigationItems 檔頭註解）。
 * 管理／帳號層級頁面（不在去處表）另列 secondary 表補上各自標題，
 * 避免整顆分頁只剩裸「Aios」。
 */
export function pageTitle(pathname: string): string {
  // #273：與 brand.ts BRAND_NAME 對齊（Aios）
  if (pathname === "/") return "Aios｜把想法變成可執行的團隊計畫";
  if (pathname === "/login") return "登入｜Aios";
  if (pathname === "/dashboard") return "今日工作台｜Aios";
  if (pathname.startsWith("/p/")) return "專案｜Aios";
  // 分享連結的唯讀檢視：頁面自己會在拿到資料後改成專案名，這裡先給中性標題，
  // 不要讓外部訪客的分頁標題直接掛上產品名以外的內部字樣
  if (pathname.startsWith("/s/")) return "專案檢視｜Aios";
  // 只比 pathname 前綴：/databases、/studio/:id 等子路由同屬該去處。
  for (const dest of Object.values(DESTINATIONS)) {
    if (dest.href !== "/dashboard" && pathname.startsWith(dest.href)) {
      return `${dest.label}｜Aios`;
    }
  }
  const secondary: Array<[string, string]> = [
    ["/settings", "個人設定"],
    ["/admin", "團隊管理"],
    ["/members", "通訊錄"],
    ["/logs", "用量與活動紀錄"],
    ["/feedback", "使用回饋"],
    ["/my-reports", "我的回報"],
    ["/options", "選項整理"],
    ["/collab", "協作中心"],
    ["/workflows", "自動化工作流"],
    ["/share-target", "分享收件"],
  ];
  for (const [prefix, label] of secondary) {
    if (pathname.startsWith(prefix)) return `${label}｜Aios`;
  }
  return "Aios";
}
