/**
 * Thin app entry (TD-06): providers live in main.tsx; shell + routes compose here.
 */
import { Suspense, lazy } from "react";
import { AppShell } from "./app/AppShell";

/**
 * 素材儲存警示橫幅：登入前渲染 null、儲存正常時也渲染 null——也就是說**絕大多數
 * 開站它都不顯示任何東西**，卻靜態佔著首屏 entry chunk 約 13KB。改 lazy 之後
 * 首屏不必等它；真的降級時它照樣掛在版面最上方（fallback 是 null，沒有版位變化）。
 */
const StorageAlertBanner = lazy(() =>
  import("./components/StorageAlertBanner").then((m) => ({ default: m.StorageAlertBanner })),
);

export function App() {
  return (
    <>
      {/* 素材儲存警示（素材保護）：刻意掛在 AppShell 外、整個版面最上方——
          儲存降級時「任何頁面」都要第一眼看到，而不是只有逛到某頁的人才知道。
          未登入／狀態正常／查詢失敗時它自己渲染 null，不佔任何版面。 */}
      <Suspense fallback={null}><StorageAlertBanner /></Suspense>
      <AppShell />
    </>
  );
}
