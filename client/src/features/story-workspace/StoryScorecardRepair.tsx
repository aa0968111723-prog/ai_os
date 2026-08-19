/**
 * Invisible Complexity 修復流（closure §11–§12）。
 *
 * 第一層人話：「N 鏡因上游變更而過期」「聲線已更新」——點「修復」才動作。
 * 資料唯一來源＝server 的 workspace.scorecard；這裡不重算任何一致性，
 * 不顯示 fingerprint／UUID／adapter 等內部細節。
 * 修復動作＝既有機制（重生成選定鏡→Candidate→Compare→明確 Adopt），
 * 沒有 silent regenerate。
 *
 * 風格／聲音世界未 pin 是專案級訊號（affectedShotIds 空）——不能假裝修復鏡，
 * 要給「固定目前畫風／設定聲音世界」去真的 pin project canon。
 */
import { useState } from "react";
import { Button, Chip, Hint, Meta } from "../../components/ui";
import { scorecardNeedsSetupCta, type ScorecardRow } from "@shared/projectConsistencyGraph";

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
  temporal: "前後連貫",
  physics: "動作",
  output_identity: "成品人物",
  output_style: "成品畫風",
  asset_state: "成品素材",
  voice: "聲線",
  sound_world: "聲音",
  lineage: "血緣",
  delivery: "交付",
};

export function StoryScorecardRepair({
  rows,
  canEdit,
  onRepairShots,
  onSetupDimension,
  hasWorldviewStyles = false,
  suggestedSound,
}: {
  rows: ScorecardRow[];
  canEdit: boolean;
  /**
   * 修復＝把受影響鏡送「對的軌」重生成（結果進 Candidate，不動 current）。
   * 帶 row 而非只有 shotIds——voice/sound_world 要走音訊重生，不是視覺批次（稽核修正）。
   */
  onRepairShots?: (row: ScorecardRow) => void;
  /** 風格／聲音世界還沒 pin：固定目前畫風，或寫環境音後固定聲音世界。 */
  onSetupDimension?: (row: ScorecardRow, draft?: { ambience?: string; music?: string }) => void;
  /** 世界觀已有 styles 才能一鍵 pin；否則 CTA 帶去選畫風。 */
  hasWorldviewStyles?: boolean;
  /** 各鏡已寫的環境音／配樂——有就能一鍵固定聲音世界。 */
  suggestedSound?: { ambience?: string; music?: string };
}) {
  const [soundDraft, setSoundDraft] = useState(suggestedSound?.ambience ?? "");
  const canOneClickSound = Boolean(suggestedSound?.ambience || suggestedSound?.music);
  if (!rows.length) return null;
  const hasSetup = rows.some(scorecardNeedsSetupCta);
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
          {canEdit && onSetupDimension && scorecardNeedsSetupCta(row) && row.dimension === "style" && (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => onSetupDimension(row)}
            >
              {hasWorldviewStyles ? "固定目前畫風" : "去選畫風"}
            </Button>
          )}
          {canEdit && onSetupDimension && scorecardNeedsSetupCta(row) && row.dimension === "sound_world" && (
            canOneClickSound ? (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => onSetupDimension(row, suggestedSound)}
              >
                固定聲音世界
              </Button>
            ) : (
              <>
                <input
                  aria-label="環境音"
                  className="story-scorecard__ambience"
                  value={soundDraft}
                  onChange={(event) => setSoundDraft(event.target.value)}
                  placeholder="淡大校門口日間人聲與車流"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={!soundDraft.trim()}
                  onClick={() => onSetupDimension(row, { ambience: soundDraft.trim() })}
                >
                  固定聲音世界
                </Button>
              </>
            )
          )}
        </div>
      ))}
      <Hint as="p" className="story-scorecard__hint">
        {hasSetup
          ? "風格與聲音還沒固定時，先設定；修復只重做受影響的鏡，新結果會先當候選。"
          : "修復只重做受影響的鏡；新結果會先當候選，由你比較後採用。"}
      </Hint>
    </div>
  );
}
