import { useMemo, useState } from "react";
import { Icon } from "./Icon";
import { assistantCapabilityGuide, type CapabilityGuideItem } from "../lib/assistantCapabilityGuide";
import { readCapabilityUsage, recordCapabilityUse } from "../lib/assistantCapabilityUsage";
import type { AssistantPageContext } from "../lib/assistantContext";

/** 建議區的後果標籤（完整清單靠組標題說明，這裡靠標籤——同一件事的兩種說法要一致） */
const TAG: Record<string, string> = { auto: "直接做", confirm: "要你確認", cost: "會花點" };

/**
 * 「AI 能做什麼・怎麼講它才聽得懂」——助手 sheet 裡唯一的說明書。
 *
 * ## 為什麼需要它
 *
 * 助手的畫面刻意只留「能按的東西」（見 AICreativeCopilot 的檔內註解），結果是一個輸入框
 * ＋三顆快捷鍵。對已經知道它會什麼的人這很乾淨；對第一次打開的人，這是一個沒有說明的空盒子。
 * 實機回報就是這句：「使用者根本不知道怎麼操作，他可以做到什麼能力」。
 *
 * ## 為什麼不是把二十幾個能力一次攤開
 *
 * 那樣是一張固定清單，對誰都不合身：在分鏡頁盯著第 3 鏡的人要滑過「讀取組員與工作負荷」
 * 才看到相關的那幾行。所以預設只給**跟你現在這一頁有關、以及你自己常用**的幾行
 * （排序規則在 assistantCapabilityGuide），例句也直接套上眼前那個東西的名字；
 * 想看全部的人按「看全部能力」一鍵展開，能力一個都沒少，少的只是滑動距離。
 *
 * ## 另外兩個刻意的取捨
 *
 * 1. **預設收合**。展開後即使只有五行，加上說明也有半個螢幕；助手 sheet 上一次被回報
 *    「字太多」就是把整版說明壓在問答上面（見 GroupCampaignPanel 的 collapsible 註解）。
 * 2. **只在還沒開口前出現**。對話一開始它就讓位——說明書的用途是「起頭」，
 *    對話進行中還佔著版面就變成噪音。
 */
export function AssistantCapabilityGuide({
  ctx,
  onPick,
  disabled = false,
}: {
  /** 目前頁面／正在看的東西：決定先推薦哪幾行、例句要不要對著眼前的東西講 */
  ctx?: AssistantPageContext;
  /** 按下某一行時送出的例句 */
  onPick: (prompt: string) => void;
  disabled?: boolean;
}) {
  const [recent, setRecent] = useState(readCapabilityUsage);
  const [showAll, setShowAll] = useState(false);
  // ctx 每次頁面／選取變動都是新物件，重算成本又極低（22 筆 map + sort）——
  // 依 primitive 欄位入 deps，避免「物件同內容但新參考」造成的每次 render 重算。
  const guide = useMemo(
    () => assistantCapabilityGuide({ ctx, recent }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx?.pageType, ctx?.entityType, ctx?.entityId, ctx?.entityLabel, recent],
  );

  /** 按下去：先記一筆（下次這一行會浮上來），再把例句當成使用者說的那句送出 */
  const pick = (item: CapabilityGuideItem) => {
    setRecent(recordCapabilityUse(item.id));
    onPick(item.example);
  };

  const row = (item: CapabilityGuideItem, withTag: boolean) => (
    <li key={item.id}>
      <button type="button" className="assistant-guide__item" disabled={disabled} onClick={() => pick(item)}>
        <span className="assistant-guide__item-label">
          {item.label}
          {/* 完整清單有組標題講後果，建議區沒有——那裡混著四種後果，
              不標的話「生成圖片或影片」看起來會跟「讀取分鏡」一樣無害。 */}
          {withTag && item.group !== "read" ? (
            <span className={`assistant-guide__tag is-${item.group}`}>{TAG[item.group]}</span>
          ) : null}
        </span>
        {/* 例句就是「怎麼講」的答案，所以它是這一行的主體而不是 tooltip：
            藏在 title 裡等於手機使用者永遠看不到。 */}
        <span className="assistant-guide__item-example">「{item.example}」</span>
      </button>
    </li>
  );

  return (
    <details className="assistant-guide" data-fb="助手能力說明">
      <summary className="assistant-guide__summary">
        <Icon name="HelpCircle" size={15} />
        <strong>能做什麼</strong>
        <span>問進度、記筆記、開專案、派工給 AI——點一行就照著問</span>
        <Icon name="ChevronDown" size={15} className="assistant-guide__chevron" />
      </summary>

      {/* 展開後（尤其是「看全部能力」的二十幾行）給自己的捲軸：
          不設限的話輸入框會被推到視窗外，而 sheet 的捲動本來是留給對話的。
          內層捲動與整面下滑關閉不打架——useSheetSwipeDismiss 會讓路給已捲離頂部的祖先。 */}
      <div className="assistant-guide__body">
        <p className="assistant-guide__how">
          直接用講話的方式說你要什麼就好，不用記指令。它會先看你現在開著哪一頁，
          再決定要查什麼、做什麼。
        </p>

        {!showAll && (
          <section className="assistant-guide__group">
            <h4 className="assistant-guide__group-title">
              {ctx?.entityLabel ? `在「${ctx.entityLabel}」上可以叫它做` : "現在這一頁可以叫它做"}
            </h4>
            <ul className="assistant-guide__list">{guide.suggested.map((item) => row(item, true))}</ul>
            <button type="button" className="assistant-guide__more" onClick={() => setShowAll(true)}>
              看全部能力（{guide.groups.reduce((n, g) => n + g.items.length, 0)} 項）
            </button>
          </section>
        )}

        {showAll &&
          guide.groups.map((group) => (
            <section key={group.id} className={`assistant-guide__group is-${group.id}`}>
              <h4 className="assistant-guide__group-title">{group.title}</h4>
              <p className="assistant-guide__group-note">{group.note}</p>
              <ul className="assistant-guide__list">{group.items.map((item) => row(item, false))}</ul>
            </section>
          ))}
        {showAll && (
          <button type="button" className="assistant-guide__more" onClick={() => setShowAll(false)}>
            收起，只看這一頁相關的
          </button>
        )}
      </div>
    </details>
  );
}
