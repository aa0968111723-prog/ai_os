import { useMemo } from "react";
import { Button, Card, Chip, Hint, Meta } from "../../components/ui";
import { VisualJourney, type VisualJourneyStep } from "../../components/VisualJourney";
import {
  CO_CREATE_PHASES,
  coCreateJourneyStates,
  coCreatePhaseById,
  type CoCreatePhaseId,
} from "./coCreatePhases";

/**
 * G0 共創殼：進度四段 + 本步焦點 + 方向 chips + 退出。
 * 對話／runAction 接線屬 G2；此殼只提供可跳 phase 的骨架與入口體驗（#404 G0、#408 D1–D2）。
 */
export function CoCreateShell({
  phase,
  onPhaseChange,
  onExit,
  onPickChip,
  canEdit = true,
}: {
  phase: CoCreatePhaseId;
  onPhaseChange: (phase: CoCreatePhaseId) => void;
  onExit: () => void;
  /** 選 chip → 上層可帶入目標／問 AI（G0 可選；G2 再接 runAction） */
  onPickChip?: (text: string) => void;
  canEdit?: boolean;
}) {
  const current = coCreatePhaseById(phase);
  const states = coCreateJourneyStates(phase);

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

      <Meta as="p" style={{ margin: "10px 0 0" }}>
        G0 殼：選方向會帶入上方目標；完整引導對話與自動推進 phase 接 G2。
      </Meta>
    </Card>
  );
}
