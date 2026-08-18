import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { AssetImg } from "../components/MediaFallback";
import { Button, Meta, Skeleton } from "../components/ui";
import { useSheetSwipeDismiss } from "../lib/useSheetSwipeDismiss";
import { registerAssistantFocus } from "../lib/assistantContext";
import { AddDataSheet } from "../components/AddDataSheet";
import { MobileAiBar } from "./MobileAiBar";

/** 一次抓幾張。24 張在 390px 上約四螢，足夠翻但不會一次拖垮弱網。 */
const PAGE = 24;

/**
 * 手機素材抽屜：點「素材」才 import 的貼底 sheet。
 *
 * ## 為什麼要分頁
 *
 * 桌面 `AssetLibrary` 一次抓 100 筆並且一次把 100 張 `<img>` 放進 DOM。
 * 在 4G 手機上那是一百個平行請求搶同一條管線，第一屏的縮圖反而最後才到。
 * 這裡一次 24 張、按「載入更多」再加一頁，圖片一律 `loading="lazy"`，
 * 且每個格子有固定 `aspect-ratio`（見 mobile.css）——圖到位前版位就佔好了，
 * 不會出現「捲到一半整頁往下跳」的 layout shift。
 *
 * ## 助手感知
 *
 * 開著抽屜時註冊 `focus` 層為 `assets`，AI 輸入列的快捷因此自動變成
 *「找缺素材／整理素材／推薦用哪張」——同一份 `getAssistantQuickActions`，
 * 不另外寫一組手機的字。
 */
export function MobileAssetSheet({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [limit, setLimit] = useState(PAGE);
  const [addOpen, setAddOpen] = useState(false);
  const utils = trpc.useUtils();
  const sheetRef = useRef<HTMLElement | null>(null);
  useSheetSwipeDismiss(sheetRef, onClose, true);
  // 抽屜開著時助手的視野就是素材（關閉時 cleanup 自動歸零）
  useEffect(() => registerAssistantFocus({ pageType: "assets", entityType: "asset" }), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const assets = trpc.projects.assets.useQuery(
    { projectId, limit },
    {
      staleTime: 30_000,
      /**
       * `limit` 在 query key 裡，所以按「載入更多」等於換一支全新的查詢，
       * data 會瞬間變 undefined、isLoading 變 true。沒有這行的話，下面那個
       * `isLoading && !data` 分支會把**已經載好的整面縮圖**換成六格骨架——
       * 而 `.m-sheet` 自己就是捲動容器，內容從八列縮成兩列時捲動位置被夾回頂端。
       * 使用者按「載入更多」的結果是畫面清空、捲回最上面，再重新捲過同樣那 24 張。
       * 保留前一份，新的到了才接上去，才是分頁該有的樣子。
       */
      placeholderData: (previous) => previous,
    },
  );
  const rows = assets.data ?? [];
  // 拿滿一頁就代表「可能還有」；不滿就是到底了（不用另外打一支 count）
  const maybeMore = rows.length >= limit;

  return createPortal(
    <>
      <button type="button" className="menu-surface__scrim" aria-hidden tabIndex={-1} onClick={onClose} />
      <aside className="m-sheet" aria-label="專案素材" ref={sheetRef}>
        <div className="menu-surface__grip" aria-hidden />
        <div className="m-sheet__head">
          <strong>素材</strong>
          <div className="m-sheet__head-actions">
            <Button variant="tonal" size="sm" onClick={() => setAddOpen(true)}>
              <Icon name="Upload" size={16} />
              加入素材
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="關閉素材">
              <Icon name="X" size={16} />
            </Button>
          </div>
        </div>

        <MobileAiBar placeholder="問 Aios：這些素材可以怎麼用？" />

        {assets.isLoading && !assets.data ? (
          <div className="m-thumbs">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={0} className="m-thumbs__skeleton" />)}
          </div>
        ) : rows.length === 0 ? (
          <Meta as="p">這個專案還沒有素材。按「加入素材」上傳。</Meta>
        ) : (
          <>
            <ul className="m-thumbs m-thumbs--grid">
              {rows.map((asset) => (
                <li key={asset.id}>
                  <AssetImg
                    src={asset.url}
                    alt={asset.title}
                    loading="lazy"
                    decoding="async"
                    fallbackHeight="100%"
                  />
                </li>
              ))}
            </ul>
            {maybeMore && (
              <Button
                variant="tonal"
                className="m-sheet__more"
                disabled={assets.isFetching}
                onClick={() => setLimit((n) => n + PAGE)}
              >
                {assets.isFetching ? "載入中…" : "載入更多"}
              </Button>
            )}
          </>
        )}
      </aside>
      <AddDataSheet
        open={addOpen}
        destination={{ kind: "project", projectId }}
        onClose={() => setAddOpen(false)}
        onAdded={() => {
          void utils.projects.assets.invalidate({ projectId });
          setAddOpen(false);
        }}
      />
    </>,
    document.body,
  );
}

export default MobileAssetSheet;
