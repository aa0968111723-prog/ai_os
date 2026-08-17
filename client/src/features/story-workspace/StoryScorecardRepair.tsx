/**
 * Invisible Complexity 修復流（closure §11–§12）。
 *
 * 第一層人話：「N 鏡因上游變更而過期」「聲線已更新」——點「修復」才動作。
 * 資料唯一來源＝server 的 workspace.scorecard；這裡不重算任何一致性，
 * 不顯示 fingerprint／UUID／adapter 等內部細節。
 * 修復動作＝既有機制（重生成選定鏡→Candidate→Compare→明確 Adopt），
 * 沒有 silent regenerate。
 */
import { Button, Chip, Hint, Meta } from "../../components/ui";
import type { ScorecardRow } from "@shared/projectConsistencyGraph";

const STATUS_LABELS: Record<ScorecardRow["status"], string> = {
  ok: "正常",
  warning: "可加強",
  blocker: "擋交付",
  stale: "需更新",
  unresolved: "需確認",
  capability_downgrade: "已降級",
};

const DIMENSION_LABELS: Record<ScorecardRow["dimension"], string> = {
  identity: "人物",
  look: "造型",
  scene: "場景",
  prop: "道具",
  style: "風格",
  continuity: "連戲",
  voice: "聲線",
  sound_world: "聲音",
  lineage: "血緣",
  delivery: "交付",
};

export function StoryScorecardRepair({
  rows,
  canEdit,
  onRepairShots,
}: {
  rows: ScorecardRow[];
  canEdit: boolean;
  /**
   * 修復＝把受影響鏡送「對的軌」重生成（結果進 Candidate，不動 current）。
   * 帶 row 而非只有 shotIds——voice/sound_world 要走音訊重生，不是視覺批次（稽核修正）。
   */
  onRepairShots?: (row: ScorecardRow) => void;
}) {
  if (!rows.length) return null;
  return (
    <div className="story-scorecard" data-fb="一致性修復">
      {rows.map((row) => (
        <div key={`${row.dimension}:${row.status}`} className="story-scorecard__row">
          <Chip data-status={row.status}>
            {DIMENSION_LABELS[row.dimension]}・{STATUS_LABELS[row.status]}
          </Chip>
          <Meta as="span" className="story-scorecard__reason">{row.reason}</Meta>
          {canEdit && onRepairShots && row.affectedShotIds.length > 0
            && (row.status === "stale" || row.status === "warning") && (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => onRepairShots(row)}
            >
              修復 {row.affectedShotIds.length} 鏡
            </Button>
          )}
        </div>
      ))}
      <Hint as="p" className="story-scorecard__hint">
        修復只重做受影響的鏡；新結果會先當候選，由你比較後採用。
      </Hint>
    </div>
  );
}
