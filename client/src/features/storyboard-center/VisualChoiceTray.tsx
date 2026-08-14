/**
 * Visual Creative Inspector (Visual Creative UX v2)
 *
 * Current state first, contextual editing second. Project entities are real
 * project truth; starter presets are developer-seeded vocabulary. Selection is
 * frozen only at Apply time and approved shots are protected from batch edits.
 */
import { useEffect, useMemo, useState } from "react";
import {
  VISUAL_CHOICE_FAMILY_LABEL,
  VISUAL_CHOICE_PRESETS,
  listPresetsByFamily,
  mapPresetToShotPatch,
  type VisualChoiceFamily,
  type VisualChoicePreset,
} from "@shared/visualChoicePresets";
import { parseWorldviewSafe } from "@shared/parseWorldviewSafe";
import { proposalHeadline, proposeCreativeDirections } from "@shared/creativeProposals";
import { formatWorldviewStylesLabel, parseWorldviewStyleSlots, selectWorldviewStyle } from "@shared/worldview";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { AssetImg, AssetVideo } from "../../components/MediaFallback";
import { Button, Chip, Hint, Meta, Pill } from "../../components/ui";
import { VisualChoicePreview } from "./VisualChoicePreview";
import {
  buildMixedCreativeState,
  presetMatchesShot,
  snapshotOperationTargets,
  summarizeTargetImpact,
  type CreativeStateFamily,
} from "./visualCreativeState";
import {
  CHOICE_OPERATION_LABEL,
  choicePresent,
  projectChoiceChange,
  type ProjectChoice,
  type ProjectChoiceFamily,
} from "./visualCreativeSemantics";

type ProjectFamily = ProjectChoiceFamily;
type InspectorFamily = VisualChoiceFamily | ProjectFamily;
type PendingChoice =
  | { source: "preset"; preset: VisualChoicePreset }
  | { source: "project"; family: ProjectFamily; id: string; label: string; ownerCharacterId?: string };

const FAMILY_ORDER: Array<{ id: InspectorFamily; label: string; group: "project" | "starter" }> = [
  { id: "character", label: "角色", group: "project" },
  { id: "look", label: "Look", group: "project" },
  { id: "scene", label: "Scene", group: "project" },
  { id: "prop", label: "道具", group: "project" },
  { id: "asset", label: "素材", group: "project" },
  { id: "action", label: "動作", group: "starter" },
  { id: "expression", label: "表情", group: "starter" },
  { id: "camera", label: "Camera", group: "starter" },
  { id: "lighting", label: "Lighting", group: "starter" },
  { id: "style", label: "Style", group: "starter" },
];

const STATE_TO_INSPECTOR: Record<CreativeStateFamily, InspectorFamily> = {
  character: "character",
  look: "look",
  action: "action",
  expression: "expression",
  scene: "scene",
  prop: "prop",
  lighting: "lighting",
  camera: "camera",
  style: "style",
};

/**
 * 逐鏡套用（#725 P1-9）。
 *
 * 原本是 `Promise.all`：任何一鏡衝突就整組 reject，**但已經提交的寫入仍然成立**——
 * 於是使用者看到「套用失敗」，實際上有幾鏡已經改了，畫面卻還顯示舊值與過期的 rev，
 * 之後每一次重試都會再失敗。改成 allSettled：全部都跑完，回報成功／衝突筆數，
 * 呼叫端無論如何都會重新抓一次。
 */
async function applyPerShot<T>(
  rows: readonly T[],
  fn: (row: T) => Promise<"applied" | "skipped" | "incompatible">,
): Promise<{ applied: number; incompatible: number; failed: string[] }> {
  const settled = await Promise.allSettled(rows.map((row) => fn(row)));
  let applied = 0;
  let incompatible = 0;
  const failed: string[] = [];
  for (const result of settled) {
    if (result.status === "rejected") {
      failed.push(result.reason instanceof Error ? result.reason.message : "套用失敗");
    } else if (result.value === "applied") applied += 1;
    else if (result.value === "incompatible") incompatible += 1;
  }
  return { applied, incompatible, failed };
}

export function VisualChoiceTray({
  projectId,
  canEdit,
  pickedShotIds,
  onOpenStudio,
}: {
  projectId: string;
  canEdit: boolean;
  pickedShotIds: string[];
  onOpenStudio: (sceneId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [family, setFamily] = useState<InspectorFamily>("action");
  const [pending, setPending] = useState<PendingChoice | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [instruction, setInstruction] = useState("");
  const utils = trpc.useUtils();

  const shots = trpc.scenes.listByProject.useQuery(
    { projectId },
    { enabled: pickedShotIds.length > 0, staleTime: 15_000 },
  );
  const characters = trpc.characters.list.useQuery({ projectId }, { enabled: open, staleTime: 60_000 });
  const looks = trpc.characterLooks.list.useQuery({ projectId }, { enabled: open, staleTime: 60_000 });
  const scenes = trpc.scenePresets.list.useQuery({ projectId }, { enabled: open, staleTime: 60_000 });
  const props = trpc.props.list.useQuery({ projectId }, { enabled: open, staleTime: 60_000 });
  const assets = trpc.projects.assets.useQuery({ projectId }, { enabled: open && family === "asset", staleTime: 30_000 });
  const project = trpc.projects.get.useQuery({ id: projectId }, { enabled: open, staleTime: 30_000 });

  const update = trpc.scenes.update.useMutation();
  const setCards = trpc.scenes.setCards.useMutation();
  const setVisual = trpc.scenes.setVisualFromAsset.useMutation();
  const updateWorldview = trpc.projects.updateWorldview.useMutation();

  const shotRows = shots.data ?? [];
  const targetRows = useMemo(() => {
    const ids = new Set(pickedShotIds);
    return shotRows.filter((shot) => ids.has(shot.id));
  }, [shotRows, pickedShotIds]);
  const focusShot = targetRows.length === 1 ? targetRows[0] : undefined;
  const focusNumber = focusShot ? shotRows.findIndex((shot) => shot.id === focusShot.id) + 1 : 0;

  const characterNames = useMemo(
    () => new Map((characters.data ?? []).map((row) => [row.id, row.name])),
    [characters.data],
  );
  const lookNames = useMemo(
    () => new Map((looks.data ?? []).map((row) => [row.id, row.name])),
    [looks.data],
  );
  const sceneNames = useMemo(
    () => new Map((scenes.data ?? []).map((row) => [row.id, row.name])),
    [scenes.data],
  );
  const propNames = useMemo(
    () => new Map((props.data ?? []).map((row) => [row.id, row.name])),
    [props.data],
  );
  const lookOwnerById = useMemo(
    () => new Map((looks.data ?? []).map((row) => [row.id, row.characterId])),
    [looks.data],
  );
  const worldview = parseWorldviewSafe(project.data?.worldview);
  const projectStyle = worldview.styles[0] ?? null;
  const projectStyleLabel = formatWorldviewStylesLabel(worldview.styles) || null;
  const currentState = buildMixedCreativeState({
    shots: targetRows,
    characterNames,
    lookNames,
    sceneNames,
    propNames,
    projectStyle: projectStyleLabel,
  });
  const impact = summarizeTargetImpact(shotRows, pickedShotIds);
  const selectionKey = pickedShotIds.join("|");
  /**
   * Aios 的視覺方向提案。純函式、零成本、可預測——打開面板不會偷偷生成或扣點。
   * 只有單鏡聚焦時才給：多鏡批次的「方向」該在單格工作室一鏡一鏡看。
   */
  const proposals = useMemo(
    () => focusShot
      ? proposeCreativeDirections({
          camera: focusShot.camera,
          performance: focusShot.performance,
          action: focusShot.action,
          hasVisual: !!focusShot.assetId,
          reviewStatus: focusShot.reviewStatus,
        })
      : [],
    [focusShot],
  );

  useEffect(() => {
    setPending(null);
    setStatus("");
  }, [selectionKey]);

  useEffect(() => {
    setInstruction(focusShot?.prompt ?? "");
  }, [focusShot?.id, focusShot?.prompt]);

  const starterPresets = useMemo(
    () => family === "character" || family === "look" || family === "scene" || family === "prop" || family === "asset"
      ? []
      : listPresetsByFamily(VISUAL_CHOICE_PRESETS, family),
    [family],
  );

  const writableRows = targetRows.filter((shot) => shot.reviewStatus !== "approved");
  const pendingProjectStyle = pending?.source === "preset" && pending.preset.family === "style";
  const pendingProjectChoice: ProjectChoice | null = pending?.source === "project"
    ? { family: pending.family, id: pending.id, ownerCharacterId: pending.ownerCharacterId }
    : null;
  const pendingPresent = pendingProjectChoice
    ? writableRows.filter((shot) => choicePresent(shot, pendingProjectChoice)).length
    : 0;
  const removeEverywhere = !!pendingProjectChoice
    && (pendingProjectChoice.family === "character" || pendingProjectChoice.family === "look" || pendingProjectChoice.family === "prop")
    && writableRows.length > 0
    && pendingPresent === writableRows.length;
  const pendingOperations = pendingProjectChoice
    ? writableRows.map((shot) => projectChoiceChange({ shot, choice: pendingProjectChoice, lookOwnerById, removeEverywhere }))
    : [];
  const operationKinds = [...new Set(pendingOperations.filter((change) => change.changed).map((change) => change.operation))];
  /**
   * 「移除最後一張卡」的隱性副作用：generationCore 的 resolveSceneCards 規定
   * 三排全空的鏡改用生成台當下的勾選（fallback）。所以在這裡按下移除，
   * 不是「這一鏡沒有角色」，而是「這一鏡改吃生成台的全域勾選」——
   * 那通常正好是使用者想避免的事。先講清楚，不要等出圖才發現多了一個人。
   */
  const emptiesCardBinding = pendingProjectChoice
    && (pendingProjectChoice.family === "character" || pendingProjectChoice.family === "scene" || pendingProjectChoice.family === "prop")
    && pendingOperations.some((change, index) => {
      if (!change.changed || change.operation !== "remove") return false;
      const shot = writableRows[index];
      if (!shot) return false;
      const after = {
        characterIds: change.field === "characterIds" ? (change.value as string[]) : (shot.characterIds ?? []),
        scenePresetIds: change.field === "scenePresetIds" ? (change.value as string[]) : (shot.scenePresetIds ?? []),
        propIds: change.field === "propIds" ? (change.value as string[]) : (shot.propIds ?? []),
      };
      return after.characterIds.length === 0 && after.scenePresetIds.length === 0 && after.propIds.length === 0;
    });
  const pendingOperation = pendingProjectStyle
    ? "設為專案主風格"
    : pending?.source === "preset"
      ? "替換"
      : operationKinds.length === 0
        ? "保持"
        : operationKinds.length === 1
          ? CHOICE_OPERATION_LABEL[operationKinds[0]!]
          : "統一";

  async function applyPending() {
    if (!pending || !canEdit || busy || pickedShotIds.length === 0) return;
    const targetIds = snapshotOperationTargets(pickedShotIds);
    const targets = shotRows.filter((shot) => targetIds.includes(shot.id));
    const editable = targets.filter((shot) => shot.reviewStatus !== "approved");
    setBusy(true);
    setStatus("");
    try {
      let applied = 0;
      let incompatible = 0;
      /** 逐鏡失敗（多半是夥伴剛改過、rev 衝突）；不再讓一鏡失敗把整批講成失敗 */
      let conflicts: string[] = [];
      if (pending.source === "preset" && pending.preset.family === "style") {
        /*
         * selectWorldviewStyle 是**切換**語意：再點一次目前的主風格會清空。
         * 這張卡叫「設為專案主風格」，清空從來不是使用者按下去的意思。
         *
         * 舊的防呆比 `styles[0]`，但 styles 是 [look, texture?] 而歷史資料的順序不保證——
         * texture 排在前面時 styles[0] 不是主風格，防呆漏接、切換生效、Style 被清成 []，
         * 畫面卻顯示「✓ 已採用」。改用解析出來的 look 比對，最後再補一道不接受清空的閘。
         */
        const currentLook = parseWorldviewStyleSlots(worldview.styles).look;
        const nextStyles = currentLook === pending.preset.label
          ? worldview.styles
          : selectWorldviewStyle(worldview.styles, pending.preset.label);
        const styles = nextStyles.length === 0 && worldview.styles.length > 0 ? worldview.styles : nextStyles;
        if (styles.join("\u0000") !== worldview.styles.join("\u0000")) {
          await updateWorldview.mutateAsync({ id: projectId, worldview: { styles } });
          applied = 1;
        }
        await utils.projects.get.invalidate({ id: projectId });
      } else if (pending.source === "preset") {
        const outcome = await applyPerShot(editable, async (shot) => {
          const patch = mapPresetToShotPatch(pending.preset, {
            camera: shot.camera,
            performance: shot.performance,
            action: shot.action,
          });
          await update.mutateAsync({
            sceneId: shot.id,
            ...(patch.camera !== undefined ? { camera: patch.camera } : {}),
            ...(patch.performance !== undefined ? { performance: patch.performance } : {}),
            ...(patch.action !== undefined ? { action: patch.action } : {}),
            expectedRev: shot.rev,
            baseline: {
              ...(patch.camera !== undefined ? { camera: shot.camera } : {}),
              ...(patch.performance !== undefined ? { performance: shot.performance } : {}),
              ...(patch.action !== undefined ? { action: shot.action } : {}),
            },
          });
          return "applied";
        });
        applied = outcome.applied;
        incompatible = outcome.incompatible;
        conflicts = outcome.failed;
      } else if (pending.family === "asset") {
        const outcome = await applyPerShot(editable, async (shot) => {
          const change = projectChoiceChange({ shot, choice: pending });
          if (!change.changed) return "skipped";
          // 批次套用刻意不帶 acknowledgeApproved／syncShotDirection：
          // 已通過的鏡換不動畫面，也不會用一張圖的凍結設定覆寫 N 鏡的鏡頭語言。
          await setVisual.mutateAsync({ sceneId: shot.id, assetId: String(change.value) });
          return "applied";
        });
        applied = outcome.applied;
        incompatible = outcome.incompatible;
        conflicts = outcome.failed;
      } else if (pending.family === "look") {
        const choice: ProjectChoice = pending;
        const remove = editable.length > 0 && editable.every((shot) => choicePresent(shot, choice));
        const outcome = await applyPerShot(editable, async (shot) => {
          const change = projectChoiceChange({ shot, choice, lookOwnerById, removeEverywhere: remove });
          if (!change.compatible) return "incompatible";
          if (!change.changed) return "skipped";
          await update.mutateAsync({ sceneId: shot.id, lookIds: change.value as string[], expectedRev: shot.rev, baseline: { lookIds: shot.lookIds } });
          return "applied";
        });
        applied = outcome.applied;
        incompatible = outcome.incompatible;
        conflicts = outcome.failed;
      } else {
        const choice: ProjectChoice = pending;
        const remove = editable.length > 0 && editable.every((shot) => choicePresent(shot, choice));
        const outcome = await applyPerShot(editable, async (shot) => {
          // lookOwnerById 是移除角色時判斷「哪些 Look 會變孤兒」的依據（#725 P1-12）
          const change = projectChoiceChange({ shot, choice, lookOwnerById, removeEverywhere: remove });
          if (!change.compatible) return "incompatible";
          if (!change.changed) return "skipped";
          const field = change.field as "characterIds" | "scenePresetIds" | "propIds";
          // 移除角色時一併清掉它留下的孤兒 Look（#725 P1-12）——與卡片同一次寫入。
          // 曾經是分兩支（setCards 再 scenes.update），第二支失敗就留下一個沒有主人的
          // 造型：看得到、生成時被忽略、刪不掉，角色加回來還會復活。setCards 現在收
          // lookIds，兩者一起走同一個 applyWithRevision，要嘛全成立要嘛全不動。
          const orphaned = change.orphanedLookIds ?? [];
          await setCards.mutateAsync({
            sceneId: shot.id,
            [field]: change.value as string[],
            ...(orphaned.length
              ? { lookIds: (shot.lookIds ?? []).filter((id) => !orphaned.includes(id)) }
              : {}),
            expectedRev: shot.rev,
            baseline: {
              [field]: shot[field],
              ...(orphaned.length ? { lookIds: shot.lookIds } : {}),
            },
          });
          return "applied";
        });
        applied = outcome.applied;
        incompatible = outcome.incompatible;
        conflicts = outcome.failed;
      }
      await utils.scenes.listByProject.invalidate({ projectId });
      const messages = [
        pending.source === "preset" && pending.preset.family === "style"
          ? applied > 0
            ? `✓ 專案主風格已採用「${pending.preset.label}」；相容質感會保留並進入既有生成 context`
            : "專案已是這個主風格，保持不變"
          : applied > 0
            ? `✓ 「${pending.source === "preset" ? pending.preset.label : pending.label}」已套用到 ${applied} 鏡`
            : "沒有鏡需要更新",
      ];
      if (targets.length - editable.length > 0) messages.push(`${targets.length - editable.length} 鏡已通過，未修改`);
      if (incompatible > 0) messages.push(`${incompatible} 鏡已達上限，或 Look 所屬角色不在鏡中`);
      // 部分失敗如實講出來：成功的那幾鏡是真的寫進去了，不能一概說「套用失敗」
      if (conflicts.length > 0) messages.push(`${conflicts.length} 鏡沒改成（夥伴剛動過，已重新讀取）：${conflicts[0]}`);
      setStatus(messages.join("・"));
      setPending(null);
    } catch (error) {
      /*
       * 批次是 Promise.all：一鏡失敗（rev 衝突／夥伴剛改過）會讓整段跳到這裡，
       * 但**先前成功的那幾鏡已經寫進去了**。舊版在這條路上不 invalidate，
       * 於是畫面繼續顯示舊值——使用者看到「套用失敗」，實際上部分已經生效，
       * 而且 Mixed State 這個「唯一真相的投影」正在說謊。
       * 一律重新拉一次，讓畫面回到伺服器現況再顯示錯誤。
       */
      await utils.scenes.listByProject.invalidate({ projectId }).catch(() => undefined);
      setStatus(`${error instanceof Error ? error.message : "套用失敗"}（部分鏡可能已更新，上方狀態已重新讀取）`);
    } finally {
      setBusy(false);
    }
  }

  async function saveInstruction() {
    if (!focusShot || !canEdit || busy || instruction === (focusShot.prompt ?? "")) return;
    setBusy(true);
    try {
      await update.mutateAsync({ sceneId: focusShot.id, prompt: instruction, expectedRev: focusShot.rev, baseline: { prompt: focusShot.prompt } });
      await utils.scenes.listByProject.invalidate({ projectId });
      setStatus("✓ 自然語言微調已儲存，會和結構化選擇、專案 references 一起進入生成 context");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  }

  if (pickedShotIds.length === 0) return null;

  const targetLabel = pickedShotIds.length === 1 ? `Shot ${String(focusNumber).padStart(2, "0")}` : `已選 ${pickedShotIds.length} 鏡`;
  const projectOptions = family === "character"
    ? (characters.data ?? []).map((row) => ({ ...row, label: row.name, description: row.appearance, previewUrl: row.referenceUrl }))
    : family === "look"
      ? (looks.data ?? [])
          .filter((row) => !focusShot || (focusShot.characterIds ?? []).includes(row.characterId))
          .map((row) => ({ ...row, label: row.name, description: row.costume, previewUrl: row.referenceUrl, ownerCharacterId: row.characterId }))
      : family === "scene"
        ? (scenes.data ?? []).map((row) => ({ ...row, label: row.name, description: [row.palette, row.lighting].filter(Boolean).join("・"), previewUrl: row.referenceUrl }))
        : family === "prop"
          ? (props.data ?? []).map((row) => ({ ...row, label: row.name, description: row.appearance, previewUrl: row.referenceUrl }))
          : family === "asset"
            ? (assets.data ?? [])
                .filter((row) => (row.kind === "image" || row.kind === "video") && row.url)
                .slice(0, 24)
                .map((row) => ({ ...row, label: row.title, description: row.kind === "video" ? "影片素材" : "圖片素材", previewUrl: row.url }))
            : [];

  return (
    <aside className={`visual-creative-inspector${open ? " is-open" : ""}`} aria-label="Shot 創作控制" data-fb="Visual Creative Inspector">
      <header className="visual-creative-inspector__head">
        <div>
          <Meta as="div">CURRENT CREATIVE STATE</Meta>
          <strong>{targetLabel}{focusShot?.title ? `・${focusShot.title}` : ""}</strong>
        </div>
        <Button size="sm" variant="ghost" type="button" aria-expanded={open} aria-label={open ? "收合創作控制" : "展開創作控制"} onClick={() => setOpen((value) => !value)}>
          <Icon name={open ? "ChevronDown" : "SlidersHorizontal"} size={15} />
        </Button>
      </header>

      {open && (
        <>
          {currentState.length > 0 ? (
            <div className="creative-state-grid" role="list" aria-label={`${targetLabel} 目前創作狀態`}>
              {currentState.map((item) => (
                <button
                  key={item.family}
                  type="button"
                  role="listitem"
                  className={`creative-state-item${family === STATE_TO_INSPECTOR[item.family] ? " is-active" : ""}${item.empty ? " is-empty" : ""}${item.mode === "mixed" ? " is-mixed" : ""}`}
                  onClick={() => { setFamily(STATE_TO_INSPECTOR[item.family]); setPending(null); }}
                  aria-label={`${item.label}：${item.value}。${item.detail}。點擊修改`}
                >
                  <Meta as="span">{item.label}</Meta>
                  <strong>{item.value}</strong>
                  {item.mode === "mixed" && <small>{item.detail}</small>}
                </button>
              ))}
            </div>
          ) : (
            <Hint>正在讀取這 {pickedShotIds.length} 鏡的目前狀態；套用時才會擷取精確目標。</Hint>
          )}

          <div className="visual-family-strip" role="tablist" aria-label="創作選擇類型">
            {FAMILY_ORDER.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={family === item.id}
                className={family === item.id ? "is-active" : undefined}
                onClick={() => { setFamily(item.id); setPending(null); }}
              >
                {index === 0 || FAMILY_ORDER[index - 1]?.group !== item.group ? <small>{item.group === "project" ? "PROJECT" : "STARTER"}</small> : null}
                {item.label}
              </button>
            ))}
          </div>

          <div className="visual-choice-context-head">
            <div>
              <strong>{FAMILY_ORDER.find((item) => item.id === family)?.label ?? VISUAL_CHOICE_FAMILY_LABEL[family as VisualChoiceFamily]}</strong>
              <Meta as="div">{["character", "look", "scene", "prop", "asset"].includes(family) ? "PROJECT CHOICES・來自本專案真實資料" : "PRODUCT STARTER CHOICES・可再用文字自由微調"}</Meta>
            </div>
            {family === "style" && projectStyleLabel && <Chip>Project Style：{projectStyleLabel}</Chip>}
          </div>

          <div className="visual-choice-grid" role="listbox" aria-label={String(family)}>
            {starterPresets.map((preset) => {
              const selected = pending?.source === "preset" && pending.preset.id === preset.id;
              const current = targetRows.length > 0 && targetRows.every((shot) => presetMatchesShot(preset, shot, projectStyle));
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="option"
                  aria-selected={selected || current}
                  className={`visual-choice-option${selected ? " is-selected" : ""}${current ? " is-current" : ""}`}
                  disabled={!canEdit}
                  onClick={() => setPending({ source: "preset", preset })}
                >
                  {preset.previewResource ? <VisualChoicePreview resource={preset.previewResource} /> : <span className="visual-choice-preview__fallback">{preset.preview ?? "•"}</span>}
                  <span className="visual-choice-option__copy"><strong>{preset.label}</strong>{preset.description && <Meta as="span">{preset.description}</Meta>}</span>
                  {current && <Pill status="done">CURRENT</Pill>}
                  {selected && !current && <Pill status="queued">候選</Pill>}
                </button>
              );
            })}

            {projectOptions.map((option) => {
              const selected = pending?.source === "project" && pending.family === family && pending.id === option.id;
              const choice = { family: family as ProjectFamily, id: option.id, ownerCharacterId: "ownerCharacterId" in option ? option.ownerCharacterId : undefined };
              const currentCount = targetRows.filter((shot) => choicePresent(shot, choice)).length;
              const current = targetRows.length > 0 && currentCount === targetRows.length;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={selected || current}
                  className={`visual-choice-option visual-choice-option--project${selected ? " is-selected" : ""}${current ? " is-current" : ""}`}
                  disabled={!canEdit}
                  onClick={() => setPending({ source: "project", family: family as ProjectFamily, id: option.id, label: option.label, ownerCharacterId: "ownerCharacterId" in option ? option.ownerCharacterId : undefined })}
                >
                  {option.previewUrl ? (
                    "kind" in option && option.kind === "video"
                      ? <AssetVideo src={option.previewUrl} muted preload="none" className="visual-choice-preview__image" fallbackLabel="影片" />
                      : <AssetImg src={option.previewUrl} alt={option.label} loading="lazy" className="visual-choice-preview__image" fallbackLabel="參考" />
                  ) : <span className="visual-choice-preview__project-fallback"><Icon name={family === "character" || family === "look" ? "User" : family === "scene" ? "Image" : family === "asset" ? "LayoutGrid" : "Box"} size={24} /></span>}
                  <span className="visual-choice-option__copy"><strong>{option.label}</strong>{option.description && <Meta as="span">{option.description}</Meta>}</span>
                  {current && <Pill status="done">CURRENT</Pill>}
                  {!current && !selected && currentCount > 0 && <Pill status="queued">{currentCount}/{targetRows.length}</Pill>}
                  {selected && !current && <Pill status="queued">候選</Pill>}
                </button>
              );
            })}
          </div>

          {family === "style" && (
            <Hint>Style 卡會設定專案主風格，並保留同媒材的既有質感描述；只想這一鏡暫時不同，請用下方自然語言微調，不會污染專案 Style。</Hint>
          )}

          {projectOptions.length === 0 && starterPresets.length === 0 && (
            <Hint>{family === "look" && focusShot ? "目前角色還沒有可用 Look；可先選角色或到定裝建立 reference。" : "本專案尚無這類資料。"}</Hint>
          )}

          {pickedShotIds.length > 1 && (
            <div className="choice-impact" aria-label="套用影響">
              <strong>{pendingProjectStyle ? "將更新專案 Style" : pending ? `${pendingOperation}・檢查 ${impact.total} 鏡` : `將檢查 ${impact.total} 鏡`}</strong>
              {pendingProjectStyle
                ? <Meta>Style 是專案層級的生成 context；既有畫面與通過狀態不會被覆寫。</Meta>
                : <Meta>草稿 {impact.draft}・已有畫面 {impact.withVisual}・已通過 {impact.approved}</Meta>}
              {!pendingProjectStyle && impact.approved > 0 && <Hint>已通過鏡會保留，不參與這次批次修改。</Hint>}
            </div>
          )}

          {focusShot && proposals.length > 0 && (
            <section className="creative-proposals" aria-label="Aios 視覺方向提案">
              <Meta as="div">AIOS 提案</Meta>
              <strong>{proposalHeadline({ hasVisual: !!focusShot.assetId }, proposals.length)}</strong>
              <div className="creative-proposals__list">
                {proposals.map((proposal) => (
                  <button
                    key={`${proposal.intentId}.${proposal.direction.id}`}
                    type="button"
                    className="creative-proposal-chip"
                    disabled={!canEdit}
                    title={proposal.because}
                    onClick={() => onOpenStudio(focusShot.id)}
                  >
                    <strong>{proposal.direction.label}</strong>
                    <Meta as="span">{proposal.because}</Meta>
                  </button>
                ))}
              </div>
              {/*
                提案不等於已修改：這幾顆按鈕只把單格工作室打開到「換個方向再試一次」，
                方向要不要生成、生成完要不要採用，都還是使用者按下去才發生。
                這裡沒有任何 mutation，也沒有任何生成請求。
              */}
              <Hint>點一個方向會打開單格工作室；還沒有任何東西被修改，也還沒有花點數。</Hint>
            </section>
          )}

          {focusShot && (
            <div className="creative-refine-box">
              <label htmlFor={`visual-refine-${focusShot.id}`}>自然語言微調</label>
              <textarea
                id={`visual-refine-${focusShot.id}`}
                value={instruction}
                maxLength={4000}
                disabled={!canEdit || busy}
                placeholder="例：風再大一點，但人物臉不要變。"
                onChange={(event) => setInstruction(event.target.value)}
              />
              <div>
                <Button size="sm" variant="ghost" type="button" disabled={!canEdit || busy || instruction === (focusShot.prompt ?? "")} onClick={saveInstruction}>儲存微調</Button>
                <Button size="sm" variant="tonal" type="button" onClick={() => onOpenStudio(focusShot.id)}><Icon name="Sparkles" size={13} /> 生成／比較變體</Button>
              </div>
            </div>
          )}

          {emptiesCardBinding && (
            <Hint role="alert">
              移除後這一鏡會沒有任何角色／場景／道具綁定，出圖時會改用生成台當下的勾選。
              想讓這一鏡真的「沒有人」，請改在提示詞裡寫明。
            </Hint>
          )}

          {currentState.some((item) => item.unresolved > 0) && (
            <Hint role="status">
              有綁定的卡片還沒讀到名稱（可能正在載入或已被刪除）；上方顯示的是實際綁定，不是「尚未設定」。
            </Hint>
          )}

          {status && <Meta as="p" role="status" className="visual-choice-status">{status}</Meta>}

          <footer className="visual-choice-apply-bar">
            <div>
              <Meta as="div">{pending ? pendingOperation : "先選一個方向"}</Meta>
              <strong>{pending ? (pending.source === "preset" ? pending.preset.label : pending.label) : targetLabel}</strong>
            </div>
            <Button variant="primary" type="button" disabled={!pending || !canEdit || busy || (pending?.source !== "preset" || pending.preset.family !== "style") && writableRows.length === 0} onClick={applyPending}>
              {busy ? "套用中…" : pendingProjectStyle ? "設為專案主風格" : `${pendingOperation}${pickedShotIds.length > 1 ? `到 ${pickedShotIds.length} 鏡` : ""}`}
            </Button>
          </footer>
        </>
      )}
    </aside>
  );
}
