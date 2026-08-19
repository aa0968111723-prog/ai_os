import { MAX_GENERATE_CHARACTERS } from "@shared/cardLimits";
import {
  characterHasLiveSheet,
  selectableBringInIds,
  type StudioCharacterRef,
} from "@shared/studioReferenceImage";
import { Hint, Meta } from "./ui";

/**
 * 單格工作室「生成時帶入」：只勾該角色自己的同專案定裝圖。
 * 0 own refs → 已選 0/6，文字錨點；不得把 1/50  stray 掛上來。
 */
export function HonorSheetControl({
  characters,
  selectedIds,
  onToggle,
  maxSelect = MAX_GENERATE_CHARACTERS,
  readOnly = false,
}: {
  characters: readonly StudioCharacterRef[];
  selectedIds: readonly string[];
  onToggle: (id: string) => void;
  maxSelect?: number;
  readOnly?: boolean;
}) {
  const honored = selectableBringInIds(characters, selectedIds, maxSelect);
  const atMax = honored.length >= maxSelect;

  return (
    <div role="group" aria-label="生成時帶入角色參考圖" style={{ margin: "8px 0" }}>
      <Meta as="div">
        生成時帶入 · 已選 {honored.length}/{maxSelect}
        {honored.length === 0 ? " · 沒有自己的定裝圖＝只靠文字錨點" : ""}
      </Meta>
      {characters.length === 0 ? (
        <Hint>這個專案還沒有角色卡。未設定裝圖時重畫只走文字鎖定。</Hint>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          {characters.map((card) => {
            const hasSheet = characterHasLiveSheet(card);
            const on = honored.includes(card.id);
            const disabled = readOnly || !hasSheet || (atMax && !on);
            return (
              <label
                key={card.id}
                style={{
                  fontSize: "var(--fs-12)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  opacity: disabled && !on ? 0.55 : 1,
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
                title={
                  !hasSheet
                    ? "沒有自己的定裝參考圖——只靠文字錨點，不掛別人的 1/50"
                    : undefined
                }
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={disabled}
                  onChange={() => {
                    if (disabled || !hasSheet) return;
                    onToggle(card.id);
                  }}
                />
                {card.name}
                {hasSheet ? "" : "（0 張）"}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
