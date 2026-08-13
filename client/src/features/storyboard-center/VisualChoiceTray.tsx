/**
 * Visual Creative Choice Tray（PR #710）
 *
 * 勾選一或多鏡後出現的情境式視覺選擇面板。
 * - 不新建 selection store：直接吃 StoryboardStage 的 pickedShotIds
 * - 套用走既有 scenes.update + mapPresetToShotPatch（merge，不清掉其他欄位）
 * - 多選時先顯示 impact preview（describeDirectionChange），再確認套用
 * - 可被 ShotCard 以 initialFamily / forceOpen 深鏈開啟
 */
import { useEffect, useMemo, useState } from "react";
import { describeDirectionChange } from "@shared/story";
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
  initialFamily,
  forceOpen,
  onOpened,
}: {
  projectId: string;
  canEdit: boolean;
  /** 當前勾選的分鏡；tray 開啟套用時會凍結一份副本 */
  pickedShotIds: string[];
  /** ShotCard 深鏈：打開時切到指定 family */
  initialFamily?: VisualChoiceFamily | null;
  /** 外部要求展開（例如從 ShotCard 點「視覺選擇」） */
  forceOpen?: boolean;
  /** forceOpen 被消費後回呼，讓父層清掉 flag */
  onOpened?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [family, setFamily] = useState<VisualChoiceFamily>("action");
  const [status, setStatus] = useState("");
  const [frozenIds, setFrozenIds] = useState<string[] | null>(null);
  const [pending, setPending] = useState<{
    preset: VisualChoicePreset;
    ids: string[];
    summaryLines: string[];
  } | null>(null);
  const utils = trpc.useUtils();

  useEffect(() => {
    if (initialFamily) setFamily(initialFamily);
  }, [initialFamily]);

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      onOpened?.();
    }
  }, [forceOpen, onOpened]);

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

  const buildImpactSummary = (preset: VisualChoicePreset, ids: string[]): string[] => {
    const lines: string[] = [];
    const sampleId = ids[0];
    const current = sampleId ? shotMap.get(sampleId) : undefined;
    const patch = mapPresetToShotPatch(preset, current);

    if (patch.camera) {
      lines.push(
        ...describeDirectionChange(current?.camera ?? null, patch.camera as Record<string, string | undefined>),
      );
    }
    if (patch.performance) {
      lines.push(
        ...describeDirectionChange(
          current?.performance ?? null,
          patch.performance as Record<string, string | undefined>,
        ),
      );
    }
    if (patch.action !== undefined) {
      const before = current?.action?.trim() || "－";
      const after = patch.action.trim() || "－";
      if (before !== after) lines.push(`動作 ${before}→${after}`);
    }
    if (patch.styleHint) {
      lines.push(`風格提示 → ${patch.styleHint}（僅記錄，不改畫面描述）`);
    }
    if (ids.length > 1) {
      lines.unshift(`將影響 ${ids.length} 鏡（以下以第一鏡為例）`);
    }
    return lines.length ? lines : ["沒有可預覽的變更"];
  };

  const commitApply = (preset: VisualChoicePreset, ids: string[]) => {
    setStatus("");
    let applied = 0;
    let styleOnly = 0;

    for (const sceneId of ids) {
      const current = shotMap.get(sceneId);
      const patch = mapPresetToShotPatch(preset, current);

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
      bits.push(`風格「${preset.label}」已記下（生成時可作為提示；尚未寫入分鏡欄位）`);
    }
    if (bits.length === 0) bits.push("沒有需要更新的鏡");
    setStatus(bits.join("・"));
    setPending(null);
  };

  const requestApply = (preset: VisualChoicePreset) => {
    if (!canEdit || targetIds.length === 0 || update.isPending) return;

    const ids = frozenIds ?? [...pickedShotIds];
    if (!frozenIds) setFrozenIds(ids);

    // 多選或會改動既有欄位 → 先預覽再確認；單選且無衝突可直接套用
    if (ids.length > 1) {
      setPending({
        preset,
        ids,
        summaryLines: buildImpactSummary(preset, ids),
      });
      return;
    }

    commitApply(preset, ids);
  };

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
              setPending(null);
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
                onClick={() => {
                  setFamily(f);
                  setPending(null);
                }}
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

          {pending ? (
            <div
              role="dialog"
              aria-label="套用影響預覽"
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--r-10, 10px)",
                padding: 10,
                background: "var(--surface-2, var(--field))",
                marginBottom: 10,
              }}
            >
              <Meta as="p" style={{ margin: "0 0 6px", fontWeight: 600 }}>
                確認套用「{pending.preset.label}」？
              </Meta>
              <ul style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: "var(--fs-12)" }}>
                {pending.summaryLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Button
                  size="sm"
                  variant="primary"
                  type="button"
                  disabled={update.isPending}
                  onClick={() => commitApply(pending.preset, pending.ids)}
                >
                  {update.isPending ? "套用中…" : `套用到 ${pending.ids.length} 鏡`}
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setPending(null)}>
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Meta as="p" style={{ margin: "0 0 8px", fontSize: "var(--fs-12)" }}>
                點卡片套用到選中鏡（會與現有鏡頭／表情合併；多選會先預覽影響）
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
                    onClick={() => requestApply(p)}
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
            </>
          )}

          {family === "style" && !pending && (
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
              {targetIds.length > 6 && <Chip>+{targetIds.length - 6}</Chip>}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
