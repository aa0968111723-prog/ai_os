/**
 * 前後鏡導航（重構需求 §4／§5）：`< 02  [03]  04 >`。
 *
 * 製作時使用者的心智是「我在做第幾鏡、還剩幾鏡」，不是「我要去哪個頁面」。
 * 這條導航讓他不必關掉工作室、回分鏡表、再點下一鏡——那三步會把「連續製作」
 * 切成一段一段。
 *
 * 狀態點吃 shared/shotCompletion 的同一份判斷：分鏡卡說缺配音，這裡就一定也說缺。
 */
import { Icon } from "../../components/Icon";
import { Button, Meta } from "../../components/ui";
import { computeShotCompletion, type ShotCompletionInput } from "@shared/shotCompletion";

/** 一鏡在導航列上的樣子 */
const STATE_MARK: Record<string, { mark: string; label: string }> = {
  done: { mark: "✓", label: "已完成" },
  running: { mark: "●", label: "製作中" },
  blocked: { mark: "!", label: "需要修改" },
  todo: { mark: "○", label: "尚未開始" },
};

export function ShotNavigator({
  shots,
  currentId,
  onGo,
}: {
  /** 全片的鏡（依 orderIndex 排好）；直接吃 scenes.listByProject 的列 */
  shots: ShotCompletionInput[];
  currentId: string;
  onGo: (shotId: string) => void;
}) {
  const ordered = [...shots].sort((a, b) => a.orderIndex - b.orderIndex);
  const idx = ordered.findIndex((s) => s.id === currentId);
  if (idx < 0) return null;
  const prev = ordered[idx - 1] ?? null;
  const next = ordered[idx + 1] ?? null;
  const completions = ordered.map(computeShotCompletion);
  const cur = completions[idx];

  return (
    <div className="shot-nav" role="group" aria-label="前後鏡切換">
      <Button
        variant="ghost"
        size="sm"
        disabled={!prev}
        onClick={() => prev && onGo(prev.id)}
        aria-label={prev ? `上一鏡：第 ${idx} 鏡` : "已經是第一鏡"}
        title={prev ? prev.title : "已經是第一鏡"}
      >
        <Icon name="ArrowLeft" size={14} />
      </Button>

      {/* 整條片的狀態一次看完：哪幾鏡還沒開始、哪一鏡卡住 */}
      <div className="shot-nav__strip">
        {completions.map((c, i) => {
          const m = STATE_MARK[c.state] ?? STATE_MARK.todo;
          const isCur = i === idx;
          return (
            <button
              key={c.shotId}
              type="button"
              className={`shot-nav__dot${isCur ? " is-current" : ""} shot-nav__dot--${c.state}`}
              aria-current={isCur ? "true" : undefined}
              aria-label={`第 ${i + 1} 鏡 ${c.title || ""}：${m.label}，完成度 ${c.percent}%`}
              title={`第 ${i + 1} 鏡・${m.label}・${c.percent}%`}
              onClick={() => onGo(c.shotId)}
            >
              <span aria-hidden="true">{isCur ? i + 1 : m.mark}</span>
            </button>
          );
        })}
      </div>

      <Button
        variant="ghost"
        size="sm"
        disabled={!next}
        onClick={() => next && onGo(next.id)}
        aria-label={next ? `下一鏡：第 ${idx + 2} 鏡` : "已經是最後一鏡"}
        title={next ? next.title : "已經是最後一鏡"}
      >
        <Icon name="ArrowRight" size={14} />
      </Button>

      <Meta as="span" className="shot-nav__meta">
        第 {idx + 1} / {ordered.length} 鏡・{cur.percent}%
      </Meta>
    </div>
  );
}
