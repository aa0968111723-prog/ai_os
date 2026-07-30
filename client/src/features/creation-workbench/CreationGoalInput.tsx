import { useId } from "react";

export function CreationGoalInput({
  goal,
  onGoalChange,
  disabled = false,
  inputId,
}: {
  goal: string;
  onGoalChange: (goal: string) => void;
  disabled?: boolean;
  /** Optional stable id from parent; defaults to useId() for multi-instance safety */
  inputId?: string;
}) {
  const autoId = useId();
  const id = inputId ?? `creation-goal-${autoId.replace(/:/g, "")}`;

  return (
    <div className="creation-goal-input" style={{ marginTop: 8 }}>
      <label htmlFor={id} style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
        想完成什麼？
      </label>
      <textarea
        id={id}
        rows={2}
        value={goal}
        disabled={disabled}
        placeholder="用一句話說目標，例如：把腳本拆成 6 鏡並逐鏡出圖"
        onChange={(e) => onGoalChange(e.target.value)}
        style={{ width: "100%", resize: "vertical", minHeight: 56 }}
      />
      <p className="hint creation-goal-persist-hint" style={{ margin: "4px 0 0" }}>
        目標會跨模式保留；切換「問 AI / 直接生成 / 製作範本 / 執行計畫」不會清空。
      </p>
    </div>
  );
}
