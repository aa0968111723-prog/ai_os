/**
 * Thin app entry (TD-06): providers live in main.tsx; shell + routes compose here.
 */
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import { AppShell } from "./app/AppShell";
import { StorageAlertBanner } from "./components/StorageAlertBanner";

/**
 * PROTOTYPE ONLY — 設計原型刻意掛在 SessionGate **之外**。
 *
 * 理由：它是純 fixture 的版面研究，沒有任何 API 呼叫，也不該需要登入或資料庫
 * 才能看到；設計討論的人不一定有帳號。它 lazy 載入、不進主 bundle、
 * 不出現在任何導覽，只有知道網址的人進得來。定案接線後這段連同 prototypes/ 一起刪。
 */
const VisibleCreativeWorkspacePrototype = lazy(() =>
  import("./prototypes/visible-workspace/VisibleCreativeWorkspacePrototype").then((m) => ({
    default: m.VisibleCreativeWorkspacePrototype,
  })),
);

export function App() {
  return (
    <Switch>
      <Route path="/prototype/visible-workspace">
        <Suspense fallback={<p style={{ padding: 24 }}>載入設計原型…</p>}>
          <VisibleCreativeWorkspacePrototype />
        </Suspense>
      </Route>
      <Route>
        {/* 素材儲存警示（素材保護）：刻意掛在 AppShell 外、整個版面最上方——
            儲存降級時「任何頁面」都要第一眼看到，而不是只有逛到某頁的人才知道。
            未登入／狀態正常／查詢失敗時它自己渲染 null，不佔任何版面。 */}
        <StorageAlertBanner />
        <AppShell />
      </Route>
    </Switch>
  );
}
