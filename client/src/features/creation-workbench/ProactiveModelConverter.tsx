import { useCallback, useEffect, useMemo, useState } from "react";
import { buildProactiveModelConversions, type ModelPromptConversion } from "@shared/modelPromptConversion";
import type { CreationAction } from "./creationActions";
import { generateBringInAction, planBringInAction } from "./creationActions";
import { Button, Card, Chip, Hint, Meta } from "../../components/ui";

/** localStorage key helpers — scoped by project so dismissals don't leak across projects. */
function dismissedKey(projectId: string) {
  return `aios.proactive.dismissed:${projectId}`;
}
function collapsedKey(projectId: string) {
  return `aios.proactive.collapsed:${projectId}`;
}

function readStringArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeStringArray(key: string, value: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — ignore */
  }
}

function readBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeBool(key: string, value: boolean) {
  try {
    if (value) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

type ConversionRow = ModelPromptConversion;

/**
 * 已自動配對模型卡：
 * - 可略過單卡、可整組收合（依 projectId 記住）
 * - 替代模型可點選切換主推
 * - 帶入直接生成／建立多步開拍／存成分鏡草稿／存進提示詞庫（皆不扣點、不送出）
 */
export function ProactiveModelConverter({
  intent,
  projectId,
  onCreationAction,
  onSavePrompt,
  onSaveSceneDraft,
}: {
  intent: string;
  /** Used to scope dismiss/collapse preferences. Optional for backward-compat tests. */
  projectId?: string;
  onCreationAction?: (action: CreationAction) => void;
  onSavePrompt?: (text: string, modelId?: string) => void;
  onSaveSceneDraft?: (text: string) => void;
}) {
  const storageId = projectId?.trim() || "global";

  const [dismissed, setDismissed] = useState<string[]>(() => readStringArray(dismissedKey(storageId)));
  const [collapsed, setCollapsed] = useState(() => readBool(collapsedKey(storageId)));
  /** scenarioId → chosen modelId (overrides default primary). Session-only. */
  const [selectedModelByScenario, setSelectedModelByScenario] = useState<Record<string, string>>({});

  // Re-read preferences when project changes
  useEffect(() => {
    setDismissed(readStringArray(dismissedKey(storageId)));
    setCollapsed(readBool(collapsedKey(storageId)));
    setSelectedModelByScenario({});
  }, [storageId]);

  const conversions = useMemo(
    () => buildProactiveModelConversions(intent, { scenarioLimit: 3, modelsPerScenario: 2 }),
    [intent],
  );

  const groups = useMemo(() => {
    const result: Array<{ scenarioId: string; rows: ConversionRow[] }> = [];
    for (const row of conversions) {
      const existing = result.find((g) => g.scenarioId === row.scenarioId);
      if (existing) existing.rows.push(row);
      else result.push({ scenarioId: row.scenarioId, rows: [row] });
    }
    return result;
  }, [conversions]);

  const visibleGroups = useMemo(
    () => groups.filter((g) => !dismissed.includes(g.scenarioId)),
    [groups, dismissed],
  );

  const dismissScenario = useCallback(
    (scenarioId: string) => {
      setDismissed((prev) => {
        if (prev.includes(scenarioId)) return prev;
        const next = [...prev, scenarioId];
        writeStringArray(dismissedKey(storageId), next);
        return next;
      });
    },
    [storageId],
  );

  const restoreAll = useCallback(() => {
    setDismissed([]);
    writeStringArray(dismissedKey(storageId), []);
  }, [storageId]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeBool(collapsedKey(storageId), next);
      return next;
    });
  }, [storageId]);

  const selectModel = useCallback((scenarioId: string, modelId: string) => {
    setSelectedModelByScenario((prev) => ({ ...prev, [scenarioId]: modelId }));
  }, []);

  // Nothing matched
  if (groups.length === 0) return null;

  // All cards dismissed → slim restore strip
  if (visibleGroups.length === 0) {
    return (
      <Card variant="quiet" data-testid="proactive-model-converter" style={{ marginTop: 10, padding: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Meta as="span">已略過全部自動配對建議</Meta>
          <Button type="button" size="sm" variant="ghost" onClick={restoreAll}>
            恢復建議
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card variant="quiet" data-testid="proactive-model-converter" style={{ marginTop: 10, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ flex: "1 1 auto" }}>已自動配對模型、資料需求與提示詞</strong>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-expanded={!collapsed}
          title={collapsed ? "展開自動配對" : "收合自動配對（下次進入此專案仍保持收合）"}
          onClick={toggleCollapsed}
        >
          {collapsed ? "展開" : "收合"}
        </Button>
      </div>

      {collapsed ? (
        <Meta as="p" style={{ margin: "6px 0 0" }}>
          已收合（{visibleGroups.length} 則建議）。不需要時可繼續收合；單卡也可按「略過」。
        </Meta>
      ) : (
        <>
          <Hint as="p" style={{ margin: "5px 0 10px" }}>
            這份結果由已驗證模型目錄與情境規則產生，不等待外部 AI；輸入改變時會立即重算。
            不需要的卡可按「略過」；整組可「收合」。皆只帶入草稿，不送出、不扣點。
          </Hint>
          <div style={{ display: "grid", gap: 10 }}>
            {visibleGroups.map((group) => {
              const preferredId = selectedModelByScenario[group.scenarioId];
              const primary =
                (preferredId ? group.rows.find((r) => r.modelId === preferredId) : undefined) ??
                group.rows[0];
              if (!primary) return null;
              const alternatives = group.rows.filter((r) => r.modelId !== primary.modelId);

              const bringInGenerate = () => {
                onCreationAction?.(
                  generateBringInAction({
                    prompt: primary.convertedPrompt,
                    modelId: primary.modelId,
                    goal: intent.trim() || primary.scenarioTitle,
                  }),
                );
              };
              const bringInPlan = () => {
                onCreationAction?.(
                  planBringInAction(intent.trim() || primary.scenarioTitle, {
                    prompt: primary.convertedPrompt,
                    modelId: primary.modelId,
                    goal: intent.trim() || primary.scenarioTitle,
                  }),
                );
              };

              return (
                <div
                  key={group.scenarioId}
                  data-testid={`proactive-scenario-${group.scenarioId}`}
                  style={{ paddingTop: 8, borderTop: "1px solid var(--border-soft)" }}
                >
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: "var(--fs-13)", flex: "1 1 auto" }}>
                      {primary.scenarioTitle}
                    </strong>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      title="略過此建議（此專案會記住，可按「恢復建議」還原）"
                      onClick={() => dismissScenario(group.scenarioId)}
                    >
                      略過
                    </Button>
                  </div>

                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
                    <Chip selected>{primary.modelLabel}</Chip>
                    <Chip>{primary.points} 點</Chip>
                    <Chip>{primary.verified ? "已驗證" : "待驗證"}</Chip>
                  </div>

                  <Meta as="p" style={{ margin: "5px 0 0" }}>{primary.recommendation}</Meta>
                  <Meta as="p" style={{ margin: "3px 0 0" }}>
                    <b>模型資料：</b>{primary.outputKind}・{primary.tier}・{primary.cost}
                  </Meta>
                  <Meta as="p" style={{ margin: "3px 0 0" }}>
                    <b>要準備：</b>
                    {primary.requirements.length
                      ? primary.requirements.join("＋")
                      : "只要提示詞，不需來源檔"}
                  </Meta>

                  <div
                    style={{
                      marginTop: 6,
                      padding: 8,
                      borderRadius: 8,
                      background: "var(--card2)",
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                      fontSize: "var(--fs-12)",
                    }}
                  >
                    {primary.convertedPrompt}
                  </div>
                  <Hint as="p" style={{ margin: "5px 0 0" }}>注意：{primary.caution}</Hint>

                  {alternatives.length > 0 && (
                    <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <Meta as="span">替代：</Meta>
                      {alternatives.map((row) => (
                        <Chip
                          key={row.modelId}
                          selected={false}
                          title={`改用 ${row.modelLabel}（${row.points} 點）並更新提示詞`}
                          onClick={() => selectModel(group.scenarioId, row.modelId)}
                        >
                          {row.modelLabel}（{row.points} 點）
                        </Chip>
                      ))}
                    </div>
                  )}

                  {(onCreationAction || onSavePrompt || onSaveSceneDraft) && (
                    <div
                      style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}
                      role="group"
                      aria-label={`${primary.scenarioTitle} 後續動作`}
                    >
                      {onCreationAction && (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            title="填入出圖提示詞並切換模式，不送出、不扣點"
                            onClick={bringInGenerate}
                          >
                            帶入直接生成
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            title="帶入多步開拍目標並切換模式，不自動排程"
                            onClick={bringInPlan}
                          >
                            建立多步開拍
                          </Button>
                        </>
                      )}
                      {onSaveSceneDraft && (
                        <Button
                          type="button"
                          size="sm"
                          title="新增一格分鏡草稿（不生成、不扣點）"
                          onClick={() => onSaveSceneDraft(primary.convertedPrompt)}
                        >
                          存成分鏡草稿
                        </Button>
                      )}
                      {onSavePrompt && (
                        <Button
                          type="button"
                          size="sm"
                          title="存進提示詞庫，之後可再用"
                          onClick={() => onSavePrompt(primary.convertedPrompt, primary.modelId)}
                        >
                          存進提示詞庫
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {dismissed.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <Button type="button" size="sm" variant="ghost" onClick={restoreAll}>
                恢復已略過的建議（{dismissed.length}）
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
