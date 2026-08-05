import {
  worldviewQuickExampleForKind,
  applyWorldviewFullExample,
  formatWorldviewStylesLabel,
  type Worldview,
} from "@shared/worldview";
import { parseWorldviewSafe } from "@shared/parseWorldviewSafe";
import { PROJECT_KINDS } from "@shared/models";
import { Button, Card, Chip, EmptyState, Meta } from "./ui";
import { WorldviewPreview } from "./WorldviewPreview";

/**
 * 空專案的「先抄這一份」範例卡。
 *
 * 進階層早有一鍵範例，但空的快速層只有 placeholder——最需要範例的地方反而沒有。
 * 這裡除了展示範例欄位，更關鍵的是**接一個 WorldviewPreview 餵入假想的合併結果**：
 * 讓人在按下去之前就看到「填了這些，AI 每次會收到什麼」。
 * 那是把「世界觀很抽象」變具體的最後一哩——範例不只是字，是可以預先看到後果的字。
 */
export function WorldviewExampleCard({
  wv,
  kind,
  canEdit,
  onApply,
  onApplyAndGoStudio,
  onDismiss,
}: {
  wv: Worldview;
  kind?: string | null;
  canEdit: boolean;
  /** 單一 patch 一次送出——連發 mutate 會讓樂觀合併在同一 tick 互相 race */
  onApply: (patch: ReturnType<typeof applyWorldviewFullExample>) => void;
  /**
   * C3.2：套用範例後直接進創作台（套用 + reveal studio）。
   * 未傳時主按鈕退回「整份填進去」。
   */
  onApplyAndGoStudio?: (patch: ReturnType<typeof applyWorldviewFullExample>) => void;
  onDismiss: () => void;
}) {
  const ex = worldviewQuickExampleForKind(kind);
  const patch = applyWorldviewFullExample(wv, kind, false);
  const hypothetical = parseWorldviewSafe({ ...wv, ...patch });
  const kindLabel = PROJECT_KINDS.find((k) => k.id === kind)?.label;

  return (
    <Card variant="quiet" className="wv-example" data-testid="wv-example-card">
      <EmptyState
        title="不知道要填什麼？先抄這一份"
        description={
          kindLabel
            ? `這是「${kindLabel}」的範例，填進去之後每一欄都還能改。`
            : "這是一份通用範例，填進去之後每一欄都還能改。"
        }
        action={
          canEdit ? (
            <div className="wv-example__actions">
              {onApplyAndGoStudio ? (
                <>
                  <Button
                    variant="primary"
                    data-testid="wv-example-apply-studio"
                    onClick={() => onApplyAndGoStudio(patch)}
                  >
                    套用後去創作台
                  </Button>
                  <Button variant="ghost" onClick={() => onApply(patch)}>
                    只套用、先不生成
                  </Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => onApply(patch)}>
                  整份填進去
                </Button>
              )}
              <Button variant="ghost" onClick={onDismiss}>
                我自己填
              </Button>
            </div>
          ) : undefined
        }
      />

      <dl className="wv-example__fields">
        <dt>這支片在講什麼</dt>
        <dd>{ex.logline}</dd>
        <dt>看完要記得哪一句</dt>
        <dd>{ex.message}</dd>
        <dt>氣氛</dt>
        <dd className="wv-example__chips">
          {ex.tones.map((t) => (
            <Chip key={t} as="span" selected>
              {t}
            </Chip>
          ))}
        </dd>
        <dt>畫風</dt>
        <dd>{formatWorldviewStylesLabel(ex.styles) || ex.styles.join("、")}</dd>
      </dl>

      <Meta as="p" className="wv-example__lead">
        填下去之後，AI 每次生成會收到這些：
      </Meta>
      <WorldviewPreview wv={hypothetical} defaultOpen={false} id="wv-example-preview" />
    </Card>
  );
}
