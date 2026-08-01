/**
 * Thin app entry (TD-06): providers live in main.tsx; shell + routes compose here.
 */
import { AppShell } from "./app/AppShell";
import { StorageAlertBanner } from "./components/StorageAlertBanner";

export function App() {
  return (
    <>
      {/* 素材儲存警示（素材保護）：刻意掛在 AppShell 外、整個版面最上方——
          儲存降級時「任何頁面」都要第一眼看到，而不是只有逛到某頁的人才知道。
          未登入／狀態正常／查詢失敗時它自己渲染 null，不佔任何版面。 */}
      <StorageAlertBanner />
      <AppShell />
    </>
  );
}
