import { useMemo, type ReactNode } from "react";
import { Button, Card, Chip, Hint, Meta } from "../../components/ui";
import { VisualJourney, type VisualJourneyStep } from "../../components/VisualJourney";
import {
  CO_CREATE_PHASES,
  coCreateJourneyStates,
  coCreatePhaseById,
  type CoCreatePhaseId,
} from "./coCreatePhases";

/**
 * G0–G2 共創殼：進度四段 + 本步焦點 + 方向 chips + 退出。
 * G1：progressStates／workSummary（伺服器完成條件 + 作品摘要）。
 * G2：children 嵌入 ProjectAssistant；wrapHint 收斂提示；chip → 問 AI。
 */
export function CoCreateShell({
  phase,
  onPhaseChange,
  onExit,
  onPickChip,
  canEdit = true,
  /** G1：由 coCreateJourneyStatesWithProgress 算出；未傳則退回 G0 相對 current */
  progressStates,
  /** G1：作品摘要一行 */
  workSummary,
  /** G2：wrap 階段下一步提示（送審／打包，不新 API） */
  wrapHint,
  /** G2：嵌入引導對話（ProjectAssistant） */
  children,
}: {
  phase: CoCreatePhaseId;
  onPhaseChange: (phase: CoCreatePhaseId) => void;
  onExit: () => void;
  /** 選 chip → 上層帶入助手輸入／送出（G2 Confirm → runAction） */
  onPickChip?: (text: string) => void;
  canEdit?: boolean;
  progressStates?: Array<"done" | "current" | "upcoming">;
  workSummary?: string | null;
  wrapHint?: string | null;
  children?: ReactNode;
}) {
  const current = coCreatePhaseById(phase);
  const states = progressStates ?? coCreateJourneyStates(phase);

  const steps: VisualJourneyStep[] = useMemo(
    () =>
      CO_CREATE_PHASES.map((p, i) => ({
        id: p.id,
        label: p.label,
        detail: p.focus,
        state: states[i]!,
      })),
    [states],
  );

  return (
    <Card
      className="co-create-shell"
      style={{ marginTop: 10, padding: 12 }}
      data-testid="co-create-shell"
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <div style={{ flex: "1 1 12rem", minWidth: 0 }}>
          <strong style={{ fontSize: "var(--fs-14)" }}>陪你做完</strong>
          <Meta as="p" style={{ margin: "2px 0 0" }}>
            同一條引導：定調 → 分鏡 → 畫面 → 收斂。扣點仍會再確認。
          </Meta>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onExit}
          data-testid="co-create-exit"
        >
          退出共創
        </Button>
      </div>

      <VisualJourney
        ariaLabel="共創進度"
        compact
        steps={steps}
        onSelect={(step) => {
          if (step.id === "theme" || step.id === "structure" || step.id === "visuals" || step.id === "wrap") {
            onPhaseChange(step.id);
          }
        }}
      />

      {workSummary ? (
        <Meta
          as="p"
          data-testid="co-create-work-summary"
          style={{ margin: "8px 0 0", fontSize: 12 }}
        >
          作品進度：{workSummary}
        </Meta>
      ) : null}

      <Hint style={{ margin: "10px 0 6px" }} data-testid="co-create-focus">
        {current.focus}
      </Hint>

      <div
        role="group"
        aria-label="這一步可選方向"
        style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
      >
        {current.chips.map((chip) => (
          <Chip
            key={chip}
            data-testid="co-create-chip"
            onClick={
              canEdit && onPickChip
                ? () => {
                    onPickChip(chip);
                  }
                : undefined
            }
          >
            {chip}
          </Chip>
        ))}
      </div>

      {phase === "wrap" && wrapHint ? (
        <Hint style={{ margin: "10px 0 0" }} data-testid="co-create-wrap-hint">
          {wrapHint}
        </Hint>
      ) : null}

      {children ? (
        <div style={{ marginTop: 12 }} data-testid="co-create-assistant">
          {children}
        </div>
      ) : (
        <Meta as="p" style={{ margin: "10px 0 0" }}>
          選方向後在下方對話確認執行；扣點動作都會再按一次確認。
        </Meta>
      )}
    </Card>
  );
}
