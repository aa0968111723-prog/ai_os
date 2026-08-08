/**
 * 「＋ 新增鏡」不是一顆按鈕，是一個決定：這一鏡要從哪裡長出來。
 *
 * 舊版只有「加一鏡」＝永遠開一格空白，於是「延續上一鏡的設定」與「讓 AI 依劇本
 * 接下去」這兩件最常做的事，都要靠使用者自己重打一次。選單把它們攤開，
 * 但**每一項都對應真的做得到的後端動作**（見 AnimationStudio 的 createShot）。
 */
import { useState } from "react";
import { Icon } from "../../components/Icon";
import type { IconName } from "../../components/Icon";
import { Button } from "../../components/ui";

export type NewShotKind = "blank" | "continue" | "ai-script" | "ai-next";

interface Option {
  kind: NewShotKind;
  label: string;
  detail: string;
  icon: IconName;
}

/**
 * 四個選項都有實作：
 * - blank／continue 走 scenes.addDraft（continue 帶上一鏡的卡片與鏡頭語言）
 * - ai-script 走 director.splitScript（貼腳本一次拆整份）
 * - ai-next 走 director.suggest（依專案背景建議下一鏡並直接建成草稿）
 *
 * 「從圖片建立／從素材建立」刻意不放：把素材變成一鏡的路徑已經在分鏡中心的
 * 「＋加入分鏡」與單格工作室裡，在這裡再開第二個入口只會多一套要維護的分歧。
 */
const OPTIONS: readonly Option[] = [
  { kind: "blank", label: "空白鏡", detail: "開一格什麼都沒有的", icon: "Square" },
  { kind: "continue", label: "延續上一鏡", detail: "帶上一鏡的角色、場景與鏡頭語言", icon: "Copy" },
  { kind: "ai-next", label: "AI 推薦下一鏡", detail: "依專案背景與前一鏡，建議接下來拍什麼", icon: "Sparkles" },
  { kind: "ai-script", label: "AI 依腳本建立", detail: "貼一段腳本，一次拆成整份分鏡", icon: "FileText" },
];

export function NewShotMenu({ onPick, busy }: { onPick: (kind: NewShotKind) => void; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="studio-newshot">
      <Button
        size="sm"
        variant="primary"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="Plus" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
        {busy ? "建立中…" : "新增鏡"}
      </Button>
      {open && (
        <>
          <button type="button" className="studio-menu__scrim" aria-label="關閉選單" onClick={() => setOpen(false)} />
          <div className="studio-menu studio-menu--newshot" role="menu">
            {OPTIONS.map((opt) => (
              <button
                key={opt.kind}
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); onPick(opt.kind); }}
              >
                <Icon name={opt.icon} size={14} />
                <span className="studio-menu__text">
                  <b>{opt.label}</b>
                  <small>{opt.detail}</small>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
