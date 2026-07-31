import { useId } from "react";
import { Hint } from "../../components/ui";
import { CreationSkillPicker } from "./CreationSkillPicker";

export function CreationGoalInput({
  goal,
  onGoalChange,
  skillIds = [],
  onSkillIdsChange,
  disabled = false,
  inputId,
}: {
  goal: string;
  onGoalChange: (goal: string) => void;
  /** ＋ 技能（可選；有 onSkillIdsChange 才顯示選單） */
  skillIds?: string[];
  onSkillIdsChange?: (ids: string[]) => void;
  disabled?: boolean;
  /** Optional stable id from parent; defaults to useId() for multi-instance safety */
  inputId?: string;
}) {
  const autoId = useId();
  const id = inputId ?? `creation-goal-${autoId.replace(/:/g, "")}`;

  return (
    <div className="creation-goal-input" style={{ marginTop: 8 }}>
      <label htmlFor={id} style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
        你想完成什麼畫面？
      </label>
      <textarea
        id={id}
        rows={2}
        value={goal}
        disabled={disabled}
        placeholder="例如：把腳本拆成 6 鏡，每鏡出一張定裝一致的圖"
        onChange={(e) => onGoalChange(e.target.value)}
        style={{ width: "100%", resize: "vertical", minHeight: 64 }}
      />
      {onSkillIdsChange && (
        <CreationSkillPicker
          selectedIds={skillIds}
          onChange={onSkillIdsChange}
          disabled={disabled}
        />
      )}
      {/* 說明介面行為（切模式不會清空），熟手不需要 → 預設 guide 層，精簡模式可收 */}
      <Hint className="creation-goal-persist-hint" style={{ margin: "4px 0 0" }}>
        {onSkillIdsChange
          ? "目標與已請的劇組會跟著你切換能力，不會清空。"
          : "目標會跨模式保留。"}
      </Hint>
    </div>
  );
}
