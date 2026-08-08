/**
 * 併發衝突提示卡（P0 的前端面）。
 *
 * 為什麼不是一句「儲存失敗」：那句話只告訴使用者「你剛才白做了」，沒說發生什麼事，
 * 也沒給任何出路——結果是他重打一次，然後再撞一次。這張卡要回答三件事：
 *   1. 誰動了什麼？        →「韋澔剛剛更新了這一鏡」
 *   2. 他改成什麼樣？      → [查看新版]（就地展開現值，不必跳頁）
 *   3. 我的東西怎麼辦？    → [重新套用我的修改]（把我的草稿套到新版上再送一次）
 *
 * 「重新套用我的修改」是真的重送、真的再過一次併發檢查——不是把我的值硬寫回去。
 * 硬寫回去只是把靜默覆蓋換個按鈕名字，那正是這整套機制要消滅的東西。
 */
import { useState } from "react";
import {
  readRevisionConflict,
  revisionConflictMessage,
  revisionFieldLabel,
  type RevisionConflict,
} from "../../../shared/revision";
import { Button, Hint } from "./ui";

/** 從 tRPC 的錯誤物件取出結構化衝突（不是衝突就回 null，呼叫端照舊顯示原訊息） */
export function conflictFromError(error: unknown): RevisionConflict | null {
  if (!error || typeof error !== "object") return null;
  return readRevisionConflict((error as { data?: unknown }).data);
}

export function ConflictNotice({
  conflict,
  onReapply,
  onViewLatest,
  reapplying,
}: {
  conflict: RevisionConflict;
  /** 重新以新版的 rev 送出我的修改；不給＝只顯示訊息與現值 */
  onReapply?: () => void;
  /** 「查看新版」：把畫面上的草稿換成對方的版本（呼叫端決定怎麼套） */
  onViewLatest?: () => void;
  reapplying?: boolean;
}) {
  const [showDiff, setShowDiff] = useState(false);
  const contested = conflict.contestedFields ?? [];
  const current = (conflict.currentData ?? {}) as Record<string, unknown>;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="conflict-notice"
      style={{
        border: "1px solid var(--warn-border, var(--border-soft))",
        background: "var(--warn-tint, var(--card2))",
        borderRadius: 10,
        padding: "10px 12px",
        display: "grid",
        gap: 8,
        marginTop: 8,
      }}
    >
      <strong style={{ fontSize: 13 }}>{revisionConflictMessage(conflict)}</strong>
      <Hint as="p" style={{ margin: 0, fontSize: 12 }}>
        {contested.length > 0
          ? `你們同時改了${contested.map(revisionFieldLabel).join("、")}。你剛才打的字還在下面的輸入框裡，沒有被覆蓋。`
          : "你剛才打的字還在下面的輸入框裡，沒有被覆蓋。"}
      </Hint>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={showDiff}
          onClick={() => setShowDiff((v) => !v)}
          /* 手機也點得到：44px 是主要 touch target 的下限 */
          style={{ minHeight: 44 }}
        >
          {showDiff ? "收起比較" : "比較差異"}
        </Button>
        {onViewLatest && (
          <Button size="sm" variant="ghost" onClick={onViewLatest} style={{ minHeight: 44 }}>
            查看新版
          </Button>
        )}
        {onReapply && (
          <Button size="sm" disabled={reapplying} onClick={onReapply} style={{ minHeight: 44 }}>
            {reapplying ? "重新套用中…" : "重新套用我的修改"}
          </Button>
        )}
      </div>

      {showDiff && (
        <div style={{ display: "grid", gap: 6 }}>
          {(contested.length > 0 ? contested : Object.keys(current).slice(0, 4)).map((field) => (
            <div key={field} style={{ fontSize: 12 }}>
              <Hint as="span" style={{ fontSize: 11 }}>
                {revisionFieldLabel(field)}（夥伴的版本）
              </Hint>
              <p
                style={{
                  margin: "2px 0 0",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  background: "var(--card)",
                  borderRadius: 6,
                  padding: "6px 8px",
                }}
              >
                {formatValue(current[field])}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value == null) return "（空白）";
  if (typeof value === "string") return value.length > 0 ? value : "（空白）";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "（無法顯示）";
  }
}
