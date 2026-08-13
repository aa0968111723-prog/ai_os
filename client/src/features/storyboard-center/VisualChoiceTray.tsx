/**
 * Visual Creative Choice Tray（PR #710）
 *
 * 勾選一或多鏡後出現的情境式視覺選擇面板。
 * - 不新建 selection store：直接吃 StoryboardStage 的 pickedShotIds
 * - 套用走既有 scenes.update + mapPresetToShotPatch（merge，不清掉其他欄位）
 * - 開啟時凍結目標鏡 id，避免套用途中選取變動造成「套到錯的鏡」
 * - 手機／窄螢幕：同 ResourceDock 的 sticky 面板，之後可再換成 bottom sheet
 */
import { useMemo, useState } from "react";
import {
  VISUAL_CHOICE_FAMILY_LABEL,
  VISUAL_CHOICE_PRESETS,
  listPresetsByFamily,
  mapPresetToShotPatch,
  type VisualChoiceFamily,
  type VisualChoicePreset,
} from "@shared/visualChoicePresets";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { Button, Chip, Hint, Meta } from "../../components/ui";

const FAMILY_ORDER: VisualChoiceFamily[] = [
  "action",
  "expression",
  "camera",
  "lighting",
  "style",
];

export function VisualChoiceTray({
  projectId,
  canEdit,
  pickedShotIds,
}: {
  projectId: string;
  canEdit: boolean;
  /** 當前勾選的分鏡；tray 開啟套用時會凍結一份副本 */
  pickedShotIds: string[];
}) {
  const [open, setOpen] = useState(true);
  const [family, setFamily] = useState<VisualChoiceFamily>("action");
  const [status, setStatus] = useState("");
  const [frozenIds, setFrozenIds] = useState<string[] | null>(null);
  const utils = trpc.useUtils();

  // 需要現有 camera / performance 才能正確 merge，避免覆寫其他欄位
  const shots = trpc.scenes.listByProject.useQuery(
    { projectId },
    { enabled: open && pickedShotIds.length > 0, staleTime: 15_000 },
  );

  const update = trpc.scenes.update.useMutation({
    onSuccess: () => {
      void utils.scenes.listByProject.invalidate({ projectId });
    },
    onError: (err) => setStatus(err.message),
  });

  const presets = useMemo(
    () => listPresetsByFamily(VISUAL_CHOICE_PRESETS, family),
    [family],
  );

  const shotMap = useMemo(() => {
    const map = new Map<
      string,
      {
        camera: Record<string, string | undefined> | null;
        performance: Record<string, string | undefined> | null;
        action: string | null;
      }
    >();
    for (const s of shots.data ?? []) {
      map.set(s.id, {
        camera: (s.camera as Record<string, string | undefined> | null) ?? null,
        performance: (s.performance as Record<string, string | undefined> | null) ?? null,
        action: (s.action as string | null) ?? null,
      });
    }
    return map;
  }, [shots.data]);

  const targetIds = frozenIds ?? pickedShotIds;
  const targetLabel =
    targetIds.length === 0
      ? "先勾選至少一鏡"
      : targetIds.length === 1
        ? "套用到選中的 1 鏡"
        : `套用到選中的 ${targetIds.length} 鏡`;

  const applyPreset = (preset: VisualChoicePreset) => {
    if (!canEdit || targetIds.length === 0 || update.isPending) return;

    // 凍結當下選取，避免套用過程中使用者改勾選
    const ids = frozenIds ?? [...pickedShotIds];
    if (!frozenIds) setFrozenIds(ids);

    setStatus("");
    let applied = 0;
    let styleOnly = 0;

    for (const sceneId of ids) {
      const current = shotMap.get(sceneId);
      const patch = mapPresetToShotPatch(preset, current);

      // style 目前沒有對應 shot 欄位——只記提示，不靜默改 prompt
      const hasStructured =
        patch.camera !== undefined ||
        patch.performance !== undefined ||
        patch.action !== undefined;

      if (!hasStructured) {
        if (patch.styleHint) styleOnly += 1;
        continue;
      }

      const payload: {
        sceneId: string;
        camera?: typeof patch.camera;
        performance?: typeof patch.performance;
        action?: string;
      } = { sceneId };

      if (patch.camera !== undefined) payload.camera = patch.camera;
      if (patch.performance !== undefined) payload.performance = patch.performance;
      if (patch.action !== undefined) payload.action = patch.action;

      update.mutate(payload);
      applied += 1;
    }

    const bits: string[] = [];
    if (applied > 0) bits.push(`✓ 「${preset.label}」已套用到 ${applied} 鏡`);
    if (styleOnly > 0) {
      bits.push(
        `風格「${preset.label}」已記下（生成時可作為提示；尚未寫入分鏡欄位）`,
      );
    }
    if (bits.length === 0) bits.push("沒有需要更新的鏡");
    setStatus(bits.join("・"));
  };

  // 沒有勾選時不佔版面（與 ResourceDock 的「先勾選」提示一致）
  if (pickedShotIds.length === 0 && !frozenIds) {
    return null;
  }

  return (
    <aside
      className={`visual-choice-tray${open ? " is-open" : ""}`}
      aria-label="視覺選擇"
      data-fb="視覺選擇 Tray"
      style={{
        flex: "0 0 260px",
        position: "sticky",
        top: 72,
        maxHeight: "calc(100vh - 96px)",
        overflow: "auto",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-12, 12px)",
        background: "var(--surface, var(--card))",
        padding: 8,
        minWidth: 220,
      }}
    >
      <div className="visual-choice-tray__head" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          title={open ? "收合視覺選擇" : "展開視覺選擇——動作／表情／鏡頭／光線／風格"}
        >
          <Icon name="Sparkles" size={14} />
          視覺選擇
        </Button>
        {open && (
          <Meta as="span" style={{ fontSize: "var(--fs-12)" }}>
            {targetLabel}
          </Meta>
        )}
        {frozenIds && (
          <Button
            size="sm"
            variant="ghost"
            type="button"
            title="解除凍結，改用目前勾選"
            onClick={() => {
              setFrozenIds(null);
              setStatus("");
            }}
          >
            解除凍結
          </Button>
        )}
      </div>

      {open && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-soft, var(--border))" }}>
          {!canEdit && <Hint>檢視者只能瀏覽，不能套用。</Hint>}

          <div
            role="tablist"
            aria-label="選擇類型"
            style={{ display: "flex", gap: 2, flexWrap: "wrap", marginBottom: 10 }}
          >
            {FAMILY_ORDER.map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={family === f}
                onClick={() => setFamily(f)}
                style={{
                  fontSize: "var(--fs-12)",
                  padding: "4px 10px",
                  border: 0,
                  borderRadius: 999,
                  background:
                    family === f
                      ? "var(--primary-soft, color-mix(in srgb, var(--primary-ink) 12%, transparent))"
                      : "transparent",
                  color: family === f ? "var(--primary-ink)" : "inherit",
                  fontWeight: family === f ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                {VISUAL_CHOICE_FAMILY_LABEL[f]}
              </button>
            ))}
          </div>

          <Meta as="p" style={{ margin: "0 0 8px", fontSize: "var(--fs-12)" }}>
            點卡片套用到選中鏡（會與現有鏡頭／表情合併，不會清掉其他欄位）
          </Meta>

          <div
            role="listbox"
            aria-label={VISUAL_CHOICE_FAMILY_LABEL[family]}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
            }}
          >
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                role="option"
                title={`${p.label}${p.description ? `—${p.description}` : ""}`}
                disabled={!canEdit || targetIds.length === 0 || update.isPending}
                onClick={() => applyPreset(p)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  padding: "10px 6px",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--r-10, 10px)",
                  background: "var(--surface-2, var(--field))",
                  cursor:
                    canEdit && targetIds.length > 0 ? "pointer" : "not-allowed",
                  opacity: !canEdit || targetIds.length === 0 ? 0.55 : 1,
                  textAlign: "center",
                  minHeight: 72,
                }}
              >
                <span style={{ fontSize: 22, lineHeight: 1 }} aria-hidden>
                  {p.preview ?? "•"}
                </span>
                <span style={{ fontSize: "var(--fs-12)", fontWeight: 600 }}>
                  {p.label}
                </span>
                {p.description && (
                  <Meta as="span" style={{ fontSize: "var(--fs-11)" }}>
                    {p.description}
                  </Meta>
                )}
              </button>
            ))}
          </div>

          {family === "style" && (
            <Hint style={{ marginTop: 8, fontSize: "var(--fs-11)" }}>
              風格目前作為生成提示記錄；尚未寫入分鏡專用欄位，避免靜默改掉畫面描述。
            </Hint>
          )}

          {status && (
            <Meta as="p" role="status" style={{ marginTop: 8, fontSize: "var(--fs-12)" }}>
              {status}
            </Meta>
          )}

          {targetIds.length > 0 && (
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
              <Meta as="span" style={{ fontSize: "var(--fs-11)" }}>
                目標：
              </Meta>
              {targetIds.slice(0, 6).map((id) => (
                <Chip key={id} className="visual-choice-tray__target-chip">
                  {id.slice(0, 6)}…
                </Chip>
              ))}
              {targetIds.length > 6 && (
                <Chip>+{targetIds.length - 6}</Chip>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
