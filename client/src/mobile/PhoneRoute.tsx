import { Suspense } from "react";
import { RouteFallback } from "../components/RouteFallback";
import { lazyWithRetry } from "../lib/lazyWithRetry";
import { useIsPhone } from "../lib/viewport";

/**
 * 首頁與專案頁的 Phone/Desktop 產品切換。
 *
 * ## 為什麼是**元件層**的分岔，不是 CSS
 *
 * 用 CSS 藏起來的話，手機仍要下載並掛載桌面版：`ProjectPage` 是 234KB gzip、
 * 掛載時打十一支查詢（兩支輪詢）。`display: none` 一個 byte 都省不到，
 * 反而多付了掛載成本。分岔在**路由層**才真的讓手機不下載桌面版那一包。
 *
 * ## 為什麼兩邊都 lazy
 *
 * 兩支都是 `lazyWithRetry`，所以：
 * - 手機只抓 `MobileHome`／`MobileProjectPage`（小），桌面那包完全不進網路
 * - 桌面只抓既有的 `Launchpad`／`ProjectPage`，與重構前一模一樣的 chunk
 *
 * 桌面的 chunk 邊界因此沒有任何改變——`AppRoutes` 的路由表、網址契約、
 * `key={id}` 的重建語義全部原樣保留，只是多了一層「先看寬度再決定 import 誰」。
 *
 * ## 轉向（rotate）與縮放
 *
 * `useIsPhone` 跟著 `matchMedia` 即時更新，所以手機轉橫向、或桌機把視窗拖窄到
 * 768 以下，會直接換成另一套 UI（並在那一刻才去抓對應的 chunk）。
 * 這是刻意的：產品模式由可用寬度決定，不是進站時決定一次就鎖住。
 */

const MobileHome = lazyWithRetry(() => import("./MobileHome").then((m) => ({ default: m.MobileHome })));
const MobileProjectPage = lazyWithRetry(() =>
  import("./MobileProjectPage").then((m) => ({ default: m.MobileProjectPage })),
);
const Launchpad = lazyWithRetry(() => import("../pages/Launchpad").then((m) => ({ default: m.Launchpad })));
const ProjectPage = lazyWithRetry(() => import("../pages/ProjectPage").then((m) => ({ default: m.ProjectPage })));

/** `/dashboard`：手機 → AI-first 首頁；≥768px → 既有作業台 */
export function HomeRoute({ groupId }: { groupId: string }) {
  const phone = useIsPhone();
  return (
    <Suspense fallback={<RouteFallback />}>
      {phone ? <MobileHome groupId={groupId} /> : <Launchpad groupId={groupId} />}
    </Suspense>
  );
}

/**
 * `/p/:id`：手機 → 簡化專案頁（完整工作台按需載入）；≥768px → 既有專案頁。
 *
 * `key={id}` 由呼叫端（AppRoutes）保留，語義不變：換專案強制重建。
 */
export function ProjectRoute({ id }: { id: string }) {
  const phone = useIsPhone();
  return (
    <Suspense fallback={<RouteFallback />}>
      {phone ? <MobileProjectPage id={id} /> : <ProjectPage id={id} />}
    </Suspense>
  );
}
