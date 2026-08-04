import { useId } from "react";
import { Button, Hint, Meta } from "../../components/ui";
import { focusAndReveal } from "../../lib/scrollIntoViewForChrome";
import { CreationSkillPicker } from "./CreationSkillPicker";

export function CreationGoalInput({
  goal,
  onGoalChange,
  skillIds = [],
  onSkillIdsChange,
  disabled = false,
  inputId,
  onSubmit,
  submitLabel,
  submitHint,
  /**
   * P1 (#400) 選項 A：generate 模式下縮成可選輔助列（單行 + 帶入），
   * 主輸入改在下方 #gen-prompt，降低「兩個大輸入框不知按哪個」。
   */
  compact = false,
}: {
  goal: string;
  onGoalChange: (goal: string) => void;
  /** ＋ 技能（可選；有 onSkillIdsChange 才顯示選單） */
  skillIds?: string[];
  onSkillIdsChange?: (ids: string[]) => void;
  disabled?: boolean;
  /** Optional stable id from parent; defaults to useId() for multi-instance safety */
  inputId?: string;
  /**
   * 送出（QA 2026-08-01）：這個框先前只把字鏡射到下面的模式面板，本身沒有任何送出行為——
   * 使用者打完字找不到按鈕，回報「上面那個框不能用」。給它一顆會做事的按鈕。
   */
  onSubmit?: () => void;
  submitLabel?: string;
  /** 按下去會發生什麼（免費提問／只帶入不扣點…），按鈕旁一句話講清楚 */
  submitHint?: string;
  compact?: boolean;
}) {
  const autoId = useId();
  const id = inputId ?? `creation-goal-${autoId.replace(/:/g, "")}`;

  if (compact) {
    return (
      <div className="creation-goal-input creation-goal-input--compact" style={{ marginTop: 8 }}>
        <label htmlFor={id} style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
          這次想完成什麼（可選）
        </label>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <input
            id={id}
            type="text"
            value={goal}
            disabled={disabled}
            maxLength={1000}
            placeholder="一句話想法，可帶入下方提示詞（不會扣點）"
            onChange={(e) => onGoalChange(e.target.value)}
            onFocus={(e) => focusAndReveal(e.currentTarget)}
            onKeyDown={(e) => {
              if (onSubmit && e.key === "Enter" && goal.trim() && !disabled) {
                e.preventDefault();
                onSubmit();
              }
            }}
            style={{ flex: "1 1 12rem", minWidth: 0 }}
          />
          {onSubmit ? (
            <Button variant="ghost" size="sm" disabled={disabled || !goal.trim()} onClick={onSubmit}>
              {submitLabel ?? "帶入提示詞"}
            </Button>
          ) : null}
        </div>
        {submitHint ? (
          <Meta as="p" style={{ margin: "4px 0 0" }}>
            {submitHint}
          </Meta>
        ) : null}
        {onSkillIdsChange ? (
          <CreationSkillPicker
            selectedIds={skillIds}
            onChange={onSkillIdsChange}
            disabled={disabled}
          />
        ) : null}
      </div>
    );
  }

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
        /* 與 server/routers/agents.ts 的 goal 上限同源（合併後這格也是排步驟的目標） */
        maxLength={1000}
        placeholder="例如：把腳本拆成 6 鏡，每鏡出一張定裝一致的圖"
        onChange={(e) => onGoalChange(e.target.value)}
        onFocus={(e) => focusAndReveal(e.currentTarget)}
        onKeyDown={(e) => {
          // Ctrl/⌘+Enter 送出：長目標常要換行，所以不用單獨 Enter
          if (onSubmit && (e.metaKey || e.ctrlKey) && e.key === "Enter" && goal.trim() && !disabled) {
            e.preventDefault();
            onSubmit();
          }
        }}
        style={{ width: "100%", resize: "vertical", minHeight: 64 }}
      />
      {onSubmit && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
          <Button variant="primary" size="sm" disabled={disabled || !goal.trim()} onClick={onSubmit}>
            {submitLabel ?? "送出"}
          </Button>
          {submitHint && <Hint style={{ margin: 0 }}>{submitHint}</Hint>}
        </div>
      )}
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
