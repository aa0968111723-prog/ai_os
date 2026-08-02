import { useMemo } from "react";
import { buildProactiveModelConversions } from "@shared/modelPromptConversion";
import type { CreationAction } from "./creationActions";
import { generateBringInAction } from "./creationActions";
import { Button, Card, Chip, Hint, Meta } from "../../components/ui";

export function ProactiveModelConverter({
  intent,
  onCreationAction,
}: {
  intent: string;
  onCreationAction?: (action: CreationAction) => void;
}) {
  const conversions = useMemo(
    () => buildProactiveModelConversions(intent, { scenarioLimit: 3, modelsPerScenario: 2 }),
    [intent],
  );
  const groups = conversions.reduce<Array<{ scenarioId: string; rows: typeof conversions }>>((result, row) => {
    const existing = result.find((group) => group.scenarioId === row.scenarioId);
    if (existing) existing.rows.push(row);
    else result.push({ scenarioId: row.scenarioId, rows: [row] });
    return result;
  }, []);

  return (
    <Card variant="quiet" data-testid="proactive-model-converter" style={{ marginTop: 10, padding: 12 }}>
      <strong>已自動配對模型、資料需求與提示詞</strong>
      <Hint as="p" layer="always" style={{ margin: "5px 0 10px" }}>
        這份結果直接由已驗證模型目錄與情境規則產生，不等待外部 AI；輸入內容改變時會立即重算。
      </Hint>
      <div style={{ display: "grid", gap: 10 }}>
        {groups.map((group) => {
          const primary = group.rows[0];
          if (!primary) return null;
          const alternatives = group.rows.slice(1);
          return (
            <div key={group.scenarioId} style={{ paddingTop: 8, borderTop: "1px solid var(--border-soft)" }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ fontSize: "var(--fs-13)" }}>{primary.scenarioTitle}</strong>
                <Chip selected>{primary.modelLabel}</Chip>
                <Chip>{primary.points} 點</Chip>
                <Chip>{primary.verified ? "已驗證" : "待驗證"}</Chip>
              </div>
              <Meta as="p" style={{ margin: "5px 0 0" }}>{primary.recommendation}</Meta>
              <Meta as="p" style={{ margin: "3px 0 0" }}>
                <b>模型資料：</b>{primary.outputKind}・{primary.tier}・{primary.cost}
              </Meta>
              <Meta as="p" style={{ margin: "3px 0 0" }}>
                <b>要準備：</b>{primary.requirements.length ? primary.requirements.join("＋") : "只要提示詞，不需來源檔"}
              </Meta>
              <div style={{ marginTop: 6, padding: 8, borderRadius: 8, background: "var(--card2)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "var(--fs-12)" }}>
                {primary.convertedPrompt}
              </div>
              <Hint as="p" style={{ margin: "5px 0 0" }}>注意：{primary.caution}</Hint>
              {alternatives.length ? (
                <Meta as="p" style={{ margin: "5px 0 0" }}>
                  替代：{alternatives.map((row) => `${row.modelLabel}（${row.points} 點）`).join("、")}
                </Meta>
              ) : null}
              {onCreationAction ? (
                <Button
                  type="button"
                  size="sm"
                  style={{ marginTop: 7 }}
                  onClick={() => onCreationAction(generateBringInAction({
                    prompt: primary.convertedPrompt,
                    modelId: primary.modelId,
                    goal: intent.trim() || primary.scenarioTitle,
                  }))}
                >
                  帶入直接生成
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
