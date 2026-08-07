import { useState } from "react";
import { buildAblationVariants } from "@shared/ablation";
import { SEED_SUPPORTED } from "@shared/models";
import type { PromptSectionKey } from "@shared/promptSections";
import { trpc } from "../../api";
import { Button, Card, Hint, Meta } from "../../components/ui";
import { AblationResultGrid } from "./AblationResultGrid";

/**
 * 消融偵測（影響力實測）的入口。
 *
 * 這是「注意力」在拿不到內部權重時唯一能實測的版本：固定其他條件、只拿掉一段重跑，
 * 差得多＝這一段真的在起作用；幾乎沒差＝它其實沒發揮。
 *
 * 兩件事一定要先講清楚，講不清楚這個功能就是在誤導人：
 * 1. **每一輪都是真的生成，照常扣點**——所以送出前先把總花費算給使用者看。
 * 2. **seed 固定不了的模型，差異裡混著隨機噪聲**——結論只能當參考，不能拿來刪設定。
 */
export interface AblationSubmitInput {
  projectId: string;
  modelId: string;
  prompt: string;
  sourceUrl?: string;
  sourceAssetId?: string;
  secondarySourceUrl?: string;
  secondarySourceAssetId?: string;
  characterIds?: string[];
  scenePresetIds?: string[];
  propIds?: string[];
  continuityMode?: boolean;
}

export function AblationPanel({
  input,
  positivePrompt,
  pointsPerRun,
}: {
  input: AblationSubmitInput;
  positivePrompt: string;
  pointsPerRun?: number;
}) {
  const variants = buildAblationVariants(positivePrompt);
  const [selected, setSelected] = useState<PromptSectionKey[]>([]);
  const ablation = trpc.generation?.ablation?.useMutation?.() ?? {
    data: undefined,
    error: null,
    isPending: false,
    mutate: (_input: unknown) => undefined,
  };

  if (!variants.length) return null;

  const seedPinned = SEED_SUPPORTED.has(input.modelId);
  const chosen = selected.length ? selected : variants.map((variant) => variant.section);
  // 基準 1 輪 + 每個被拿掉的段落各 1 輪
  const runCount = chosen.length + 1;
  const totalPoints = pointsPerRun != null ? pointsPerRun * runCount : undefined;

  const toggle = (section: PromptSectionKey) => {
    setSelected((current) => {
      const base = current.length ? current : variants.map((variant) => variant.section);
      return base.includes(section) ? base.filter((key) => key !== section) : [...base, section];
    });
  };

  return (
    <details data-testid="ablation-panel" style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>實測：這一段到底有沒有影響？</summary>
      <Hint style={{ marginTop: 6 }}>
        送出「完整版」與「各拿掉一段」的版本，用結果差異量出每一段真正的影響力。
        模型不會回傳注意力權重，這是拿不到內部權重時的實測替代做法。
      </Hint>

      <div style={{ marginTop: 8, display: "grid", gap: 5 }}>
        {variants.map((variant) => {
          const on = chosen.includes(variant.section);
          return (
            <label
              key={variant.section}
              style={{ display: "flex", gap: 8, alignItems: "center", margin: 0, padding: "5px 9px", borderRadius: 8, border: "1px solid var(--border-soft)", background: on ? "var(--card2)" : "transparent", fontSize: 13, color: "var(--fg)" }}
            >
              <input type="checkbox" checked={on} onChange={() => toggle(variant.section)} style={{ width: "auto" }} />
              拿掉「{variant.title}」跑一輪
            </label>
          );
        })}
      </div>

      <Meta as="p" style={{ margin: "8px 0 0" }}>
        共 {runCount} 輪（含基準）
        {totalPoints != null ? `・約 ${totalPoints} 點（每輪 ${pointsPerRun} 點）` : ""}
      </Meta>
      <Hint as="p" style={{ margin: "4px 0 0", color: seedPinned ? undefined : "var(--gold-ink)" }}>
        {seedPinned
          ? "這顆模型可固定隨機噪聲：各輪共用同一顆 seed，差異才歸因得到被拿掉的那一段。"
          : "這顆模型固定不了隨機噪聲：各輪的差異裡混著噪聲，結果只能當參考，不要據此直接刪掉設定。"}
      </Hint>

      <div style={{ marginTop: 8 }}>
        <Button
          type="button"
          size="sm"
          disabled={ablation.isPending || !chosen.length}
          onClick={() => ablation.mutate({ ...input, sections: chosen })}
        >
          {ablation.isPending ? "送出中…" : `送出 ${runCount} 輪實測`}
        </Button>
      </div>

      {ablation.error ? <p className="error">{ablation.error.message}</p> : null}
      {ablation.data ? (
        <Card variant="quiet" data-testid="ablation-result" style={{ marginTop: 8, padding: 10 }}>
          <strong style={{ fontSize: 13 }}>已送出 {ablation.data.runs.length} 輪</strong>
          <Meta as="p" style={{ margin: "4px 0 0" }}>
            {ablation.data.seedPinned ? "已固定同一顆 seed" : "未固定 seed（差異含噪聲）"}
            ・結果會直接並排在下面
          </Meta>
          <AblationResultGrid
            projectId={input.projectId}
            runId={ablation.data.runId}
            seedPinned={ablation.data.seedPinned}
          />
          {ablation.data.failed.length ? (
            <Meta as="p" style={{ margin: "6px 0 0", color: "var(--gold-ink)" }}>
              {ablation.data.failed.length} 輪沒送出：{ablation.data.failed.map((row) => `${row.title}（${row.message}）`).join("；")}
            </Meta>
          ) : null}
        </Card>
      ) : null}
    </details>
  );
}
