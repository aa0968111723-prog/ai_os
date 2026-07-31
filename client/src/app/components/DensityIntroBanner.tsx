import { useState } from "react";
import { Button, Hint, useDensity } from "../../components/ui";
import { writeUiDensity } from "../../lib/densityPreference";
import { UI_DENSITY_LABEL } from "@shared/uiDensity";
import { Icon } from "../../components/Icon";
import { trpc } from "../../api";

/**
 * 密度功能的一次性介紹（2026-07-31 使用者回饋：「不知道怎麼切換精簡與引導」）。
 *
 * 功能做了但沒人找得到＝沒做。入口藏在帳號選單深處，第一次用的人不會去翻——
 * 這條橫幅只出現到使用者做出反應為止：按「知道了」或直接「改用精簡」都會記住
 * （localStorage），之後永不再擾。刻意不做成 modal：它是可有可無的知識，
 * 不該擋住正事。
 */
const SEEN_KEY = "aios.densityIntroSeen";

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true; // 讀不到儲存（隱私模式）＝寧可不打擾
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* 存不進去就這次不打擾，下次再出現 */
  }
}

export function DensityIntroBanner() {
  const density = useDensity();
  const [seen, setSeen] = useState(readSeen);
  const utils = trpc.useUtils();
  const setUiDensity = trpc.auth.setUiDensity.useMutation({
    onSuccess: () => utils.auth.me.invalidate(),
    onError: () => {/* 本機已生效，帳號同步下次切換再補 */},
  });
  if (seen) return null;

  const dismiss = () => {
    markSeen();
    setSeen(true);
  };
  const switchToConcise = () => {
    writeUiDensity("concise");
    setUiDensity.mutate({ density: "concise" });
    dismiss();
  };

  return (
    <div className="density-intro" role="region" aria-label="介面密度介紹">
      <Icon name="HelpCircle" size={16} style={{ flexShrink: 0, color: "var(--primary-ink)" }} />
      <Hint as="span" layer="always" style={{ margin: 0 }}>
        介面有兩種密度：<strong>{UI_DENSITY_LABEL.guide}</strong>（每個功能附說明，現在這樣）與
        <strong>{UI_DENSITY_LABEL.concise}</strong>（說明收成「？」，畫面更乾淨）。
        之後隨時可從右上角「帳號選單 → 介面說明密度」切換。
      </Hint>
      <span style={{ display: "inline-flex", gap: 6, marginLeft: "auto", flexShrink: 0 }}>
        {density === "guide" && (
          <Button size="sm" variant="tonal" onClick={switchToConcise}>
            改用精簡
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={dismiss}>
          知道了
        </Button>
      </span>
    </div>
  );
}
