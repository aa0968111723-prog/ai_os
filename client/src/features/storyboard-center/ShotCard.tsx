/**
 * 分鏡卡（Shot Card；PE 計畫 §10 + Progressive Disclosure）：
 *
 * 預設緊湊面（face）：編號／標題／時長、完成度點、大預覽、已綁定摘要 chips、必要操作。
 * 展開區（details）：世界引用、鏡頭語言、表演、素材操作（素材庫／拖放／外部成果）。
 *
 * 資料流與 mutation 不變：SceneCardBinding、cardAnchors、referenceAssetId、setVisualFromAsset 全沿用。
 * Shot 只存自己獨有的 Override——共用資料一律引用（卡片綁定），不複製。
 */
import { useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { createShotFieldSaveGate } from "@shared/shotFieldSaveGate";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { ConfirmButton } from "../../components/interactions";
import { SceneCardBinding } from "../../components/SceneCardBinding";
import { AssetImg, AssetVideo } from "../../components/MediaFallback";
import { Button, Card, Chip, Hint, Meta, Pill } from "../../components/ui";
import {
  SHOT_ANGLE_OPTIONS,
  SHOT_MOVEMENT_OPTIONS,
  SHOT_SIZE_OPTIONS,
  type ShotCamera,
  type ShotPerformance,
} from "@shared/story";
import { computeShotCompletion, COMPLETION_TRACKS, TRACK_LABEL, type ShotCompletionInput } from "@shared/shotCompletion";
import { hasSceneCardBinding } from "@shared/sceneCards";
import { formatPropDisplayName } from "@shared/propOwnership";
import type { ShotAssetSuggestionItem } from "@shared/shotAssetSuggestions";
import type { BoardMode } from "./boardPrefs";
import { ExternalAssetIntake } from "../external-intake/ExternalAssetIntake";
import { ExternalGenerationLauncher } from "../external-intake/ExternalGenerationLauncher";
import { readLocalMediaMetadata } from "../external-intake/mediaMetadata";
import { PHONE_MQ } from "../../lib/viewport";

export interface ShotRow {
  id: string;
  title: string;
  orderIndex: number;
  durationSec: number;
  status: string;
  prompt: string | null;
  action: string | null;
  dialogue: string | null;
  voiceover: string | null;
  /** 現用畫面素材 id——完成度看的是它（assetUrl 只是顯示用，簽名網址會變） */
  assetId: string | null;
  assetUrl: string | null;
  assetKind: string | null;
  characterIds: string[] | null;
  scenePresetIds: string[] | null;
  propIds: string[] | null;
  storySceneId: string | null;
  camera: ShotCamera | null;
  performance: ShotPerformance | null;
  lookIds: string[] | null;
  pendingGenStatus: "queued" | "running" | "awaiting_approval" | null;
  /** 完成度五軌所需（其餘欄位上面都有）；後端 listByProject 已回傳 */
  narrationUrl?: string | null;
  ambienceUrl?: string | null;
  pendingNarrationStatus?: string | null;
  pendingAmbienceStatus?: string | null;
  reviewStatus?: ShotCompletionInput["reviewStatus"];
  /** listByProject already returns rev — board blur must send it or Shot Inspector wins LWW */
  rev?: number;
}

export interface LookRow {
  id: string;
  characterId: string;
  name: string;
}

/** 手機／窄螢幕：預設更積極收合展開區，減少捲動距離 */
function preferDetailsOpen(mode: BoardMode): boolean {
  if (typeof window === "undefined") return mode === "pro";
  try {
    const mobile = window.matchMedia(PHONE_MQ).matches;
    // 專業模式桌機預設開；簡單模式與手機一律預設關
    return mode === "pro" && !mobile;
  } catch {
    return mode === "pro";
  }
}

const BOUND_CHIP_LIMIT = 4;

export function ShotCard({
  projectId,
  shot,
  shotNumber,
  canEdit,
  mode,
  looks,
  characterNames,
  outdatedReason,
  onOpenStudio,
  picked,
  onTogglePick,
  assetHints = [],
}: {
  projectId: string;
  shot: ShotRow;
  /** 全片第幾鏡（1 起算；與交付區同一套序號） */
  shotNumber: number;
  canEdit: boolean;
  mode: BoardMode;
  /** 專案全部造型（依 characterId 過濾出本鏡可選的） */
  looks: LookRow[];
  characterNames: Map<string, string>;
  /** 這一鏡的畫面已經跟卡片對不上的原因（§23）；空＝沒過時 */
  outdatedReason?: string;
  onOpenStudio: (sceneId: string) => void;
  /** 是否被勾選（多選交給 AI 助手一起處理）；未提供 onTogglePick 時整個勾選欄不渲染 */
  picked?: boolean;
  onTogglePick?: (sceneId: string) => void;
  /**
   * 專業模式相關素材。由 StoryboardStage 一次批次載入後注入，
   * 卡片本身不再發 suggestion query。
   */
  assetHints?: ShotAssetSuggestionItem[];
}) {
  const utils = trpc.useUtils();
  const refreshBoard = () => {
    void utils.scenes.listByProject.invalidate({ projectId });
    void utils.story.shotAssetSuggestionsBatch.invalidate({ projectId });
  };
  const update = trpc.scenes.update.useMutation({
    onSuccess: (row) => {
      gateRef.current?.onAck(row?.rev);
      refreshBoard();
    },
    onError: () => {
      gateRef.current?.reset();
    },
  });
  const updateMutateRef = useRef(update.mutate);
  updateMutateRef.current = update.mutate;
  const shotRef = useRef(shot);
  shotRef.current = shot;
  const gateRef = useRef<ReturnType<typeof createShotFieldSaveGate> | undefined>(undefined);
  if (!gateRef.current) {
    gateRef.current = createShotFieldSaveGate({
      send: (req) => {
        updateMutateRef.current({
          sceneId: shot.id,
          ...req.patch,
          expectedRev: req.expectedRev,
          baseline: req.baseline,
        } as Parameters<typeof update.mutate>[0]);
      },
      getRev: () => shotRef.current.rev,
    });
  }
  const removeShot = trpc.scenes.remove.useMutation({
    onSuccess: refreshBoard,
  });
  /** §8 連戲：把上一鏡的角色／造型／場景／攝影風格接過來（一次性套用，不是隱形跟隨） */
  const inherit = trpc.scenes.inheritFromPrevious.useMutation({
    onSuccess: refreshBoard,
  });
  const setVisual = trpc.scenes.setVisualFromAsset.useMutation({
    onSuccess: () => {
      refreshBoard();
      setLibraryOpen(false);
      setDropStatus("✓ 已從素材庫套用到這一鏡");
    },
  });
  const confirmImported = trpc.externalIntake.confirm.useMutation({
    onSuccess: () => {
      refreshBoard();
      void utils.externalIntake.inbox.invalidate({ projectId });
      setDropResult(null);
      setDropStatus("✓ 已套用到這一鏡");
    },
  });
  const [dropBusy, setDropBusy] = useState(false);
  const [dropStatus, setDropStatus] = useState("");
  const [dropDuplicateUrl, setDropDuplicateUrl] = useState<string | null>(null);
  const [dropResult, setDropResult] = useState<{ assetId: string; bindingId?: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(() => preferDetailsOpen(mode));

  const libraryAssets = trpc.projects.assets.useQuery(
    { projectId },
    { enabled: libraryOpen && canEdit, staleTime: 30_000 },
  );
  const libraryVisuals = useMemo(
    () => (libraryAssets.data ?? []).filter((a) => (a.kind === "image" || a.kind === "video") && a.url),
    [libraryAssets.data],
  );

  const importDroppedFiles = async (files: FileList) => {
    if (!canEdit || dropBusy || !files.length) return;
    setDropBusy(true);
    setDropStatus("");
    setDropDuplicateUrl(null);
    setDragOver(false);
    let imported = 0;
    for (const [index, file] of Array.from(files).entries()) {
      setDropStatus(`正在安全保存 ${index + 1}/${files.length}：${file.name}`);
      try {
        const mediaMetadata = await readLocalMediaMetadata(file);
        const form = new FormData();
        form.append("projectId", projectId);
        form.append("intake", "1");
        form.append("source", "external-ai");
        form.append("importMethod", "drag-drop");
        form.append("context", JSON.stringify({ currentProjectId: projectId, currentSceneId: shot.id }));
        form.append("mediaMetadata", JSON.stringify(mediaMetadata));
        form.append("file", file);
        const response = await fetch("/api/upload", { method: "POST", body: form, credentials: "same-origin" });
        const data = await response.json() as {
          ok?: boolean;
          error?: string;
          asset?: { id: string };
          suggestion?: { bindingId?: string } | null;
          duplicate?: { url: string; title: string };
        };
        if (response.status === 409 && data.duplicate) {
          setDropDuplicateUrl(data.duplicate.url);
          setDropStatus(`這個素材似乎已存在：${data.duplicate.title}`);
          continue;
        }
        if (!response.ok || !data.ok || !data.asset) throw new Error(data.error ?? "帶入失敗");
        imported += 1;
        setDropResult({ assetId: data.asset.id, bindingId: data.suggestion?.bindingId });
      } catch (caught) {
        setDropStatus(caught instanceof Error ? caught.message : "帶入失敗");
      }
    }
    if (imported) {
      setDropStatus(imported === 1 ? `成果已安全保存。要設為第 ${shotNumber} 鏡成果嗎？` : `${imported} 個成果已安全保存，請到匯入收件匣批次確認。`);
      void utils.externalIntake.inbox.invalidate({ projectId });
      void utils.projects.assets.invalidate({ projectId });
      void utils.story.shotAssetSuggestionsBatch.invalidate({ projectId });
    }
    setDropBusy(false);
  };

  const saveFields = (patch: Record<string, unknown>) => {
    const baseline: Record<string, unknown> = {};
    const live = shotRef.current as unknown as Record<string, unknown>;
    for (const key of Object.keys(patch)) baseline[key] = live[key] ?? null;
    gateRef.current?.save(patch, baseline);
  };
  const saveCamera = (field: keyof ShotCamera, value: string) => {
    const next: ShotCamera = { ...(shot.camera ?? {}), [field]: value.trim() || undefined };
    saveFields({ camera: next });
  };
  const savePerformance = (field: keyof ShotPerformance, value: string) => {
    const next: ShotPerformance = { ...(shot.performance ?? {}), [field]: value.trim() || undefined };
    saveFields({ performance: next });
  };

  /** 本鏡可選造型＝綁定角色名下的造型；沒綁角色就沒得選（造型跟人走） */
  const availableLooks = looks.filter((l) => (shot.characterIds ?? []).includes(l.characterId));
  const toggleLook = (lookId: string) => {
    const cur = shot.lookIds ?? [];
    const next = cur.includes(lookId) ? cur.filter((x) => x !== lookId) : [...cur, lookId];
    saveFields({ lookIds: next });
  };

  const generating = shot.pendingGenStatus === "queued" || shot.pendingGenStatus === "running";
  // 與成片頁、前後鏡導航同一支純函式——不會出現「這裡說缺、那裡說有」
  const completion = computeShotCompletion(shot);
  const boundLocked = hasSceneCardBinding(shot) || (shot.lookIds ?? []).length > 0;

  const openLibrary = (e?: MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (!canEdit) return;
    setLibraryOpen(true);
    if (!detailsOpen) setDetailsOpen(true);
  };

  const applyLibraryAsset = (assetId: string) => {
    if (!canEdit || setVisual.isPending) return;
    setVisual.mutate({ sceneId: shot.id, assetId });
  };

  const onDragOverCard = (event: DragEvent) => {
    if (!canEdit || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragOver(true);
  };
  const onDragLeaveCard = (event: DragEvent) => {
    // 只在真正離開卡片時清狀態（避免子元素 bubble 造成閃爍）
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setDragOver(false);
  };
  const onDropCard = (event: DragEvent) => {
    if (!canEdit) return;
    event.preventDefault();
    setDragOver(false);
    void importDroppedFiles(event.dataTransfer.files);
  };

  return (
    <Card
      as="article"
      className={`shot-card${dropBusy ? " shot-card--importing" : ""}${dragOver ? " shot-card--drag-over" : ""}`}
      id={`board-shot-${shot.id}`}
      data-fb="分鏡卡"
      data-picked={picked ? "1" : undefined}
      data-mode={mode}
      onDragOver={canEdit ? onDragOverCard : undefined}
      onDragLeave={canEdit ? onDragLeaveCard : undefined}
      onDrop={canEdit ? onDropCard : undefined}
    >
      {/* ── 緊湊面：永遠可見 ── */}
      <div className="shot-card__face">
        <div className="shot-card__head">
          {onTogglePick && (
            <label className="shot-card__pick" title={`選取第 ${shotNumber} 鏡（可多選，交給 AI 助手一起處理）`}>
              <input
                type="checkbox"
                checked={!!picked}
                aria-label={`選取第 ${shotNumber} 鏡`}
                onChange={() => onTogglePick(shot.id)}
              />
            </label>
          )}
          <span className="shot-card__num">#{shotNumber}</span>
          <input
            key={`title-${shot.id}-${shot.title}`}
            className="shot-card__title"
            aria-label={`第 ${shotNumber} 鏡標題`}
            defaultValue={shot.title}
            readOnly={!canEdit}
            maxLength={60}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (canEdit && v && v !== shot.title) saveFields({ title: v });
            }}
          />
          <label className="shot-card__dur">
            <input
              key={`dur-${shot.id}-${shot.durationSec}`}
              type="number"
              min={1}
              max={60}
              defaultValue={shot.durationSec}
              readOnly={!canEdit}
              aria-label="秒數"
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (canEdit && Number.isInteger(v) && v >= 1 && v <= 60 && v !== shot.durationSec) {
                  saveFields({ durationSec: v });
                }
              }}
            />
            秒
          </label>
          {generating && <Pill status="running">生成中</Pill>}
          {shot.pendingGenStatus === "awaiting_approval" && <Pill status="queued">待核價</Pill>}
          {outdatedReason && <Pill status="failed">畫面過時</Pill>}
          {shot.reviewStatus === "approved" && <Pill status="done">已通過</Pill>}
          {shot.reviewStatus === "changes" && <Pill status="failed">需要修改</Pill>}
        </div>

        {/* §15 完成度：五個點就講完「這一鏡還缺什麼」 */}
        <div className="shot-card__completion" role="group" aria-label={`完成度 ${completion.percent}%`}>
          {COMPLETION_TRACKS.map((t) => (
            <span
              key={t}
              className={`shot-card__dot shot-card__dot--${completion.tracks[t]}`}
              title={`${TRACK_LABEL[t]}：${completion.tracks[t] === "done" ? "已完成" : completion.tracks[t] === "running" ? "進行中" : "尚未完成"}`}
            >
              {TRACK_LABEL[t]}
            </span>
          ))}
          <Meta as="span">{completion.percent}%</Meta>
        </div>

        {shot.reviewStatus === "approved" && (
          <Meta as="p" className="shot-card__approved-note">
            <Icon name="Check" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
            已通過：重新生成只會存新版本，不會自動換掉現用畫面。
          </Meta>
        )}

        {outdatedReason && (
          <Meta as="p" role="status" className="shot-card__outdated">
            <Icon name="TriangleAlert" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
            這張圖是舊設定畫的（{outdatedReason}後來改過）——要更新請打開單格工作室重畫。
          </Meta>
        )}

        {/* 預覽區：有圖顯示圖；無圖＝拖放／素材庫／生成入口 */}
        <div
          className={`shot-card__preview-wrap${dragOver ? " is-drag-over" : ""}`}
          data-has-asset={shot.assetUrl ? "1" : undefined}
        >
          <button
            type="button"
            className="shot-card__preview"
            onClick={() => onOpenStudio(shot.id)}
            title={shot.assetUrl ? "打開單格工作室（重畫／修正／配音／版本）" : "還沒有畫面——打開單格工作室生成，或拖入現有素材"}
          >
            {shot.assetUrl ? (
              shot.assetKind === "video" ? (
                <AssetVideo
                  src={shot.assetUrl}
                  muted
                  preload="metadata"
                  className="shot-card__preview-media"
                  fallbackLabel="畫面素材遺失"
                />
              ) : (
                <AssetImg
                  src={shot.assetUrl}
                  alt={`第 ${shotNumber} 鏡畫面`}
                  loading="lazy"
                  fallbackLabel="畫面素材遺失"
                />
              )
            ) : (
              <span className="shot-card__preview-empty">
                <Icon name="Image" size={20} />
                <Meta as="span">
                  {canEdit
                    ? dragOver
                      ? "放開以帶入素材"
                      : "拖入現有素材或點擊生成"
                    : "尚無畫面"}
                </Meta>
              </span>
            )}
          </button>
          {canEdit && (
            <div className="shot-card__preview-actions">
              <Button
                size="sm"
                variant="tonal"
                type="button"
                title="從專案素材庫選用圖片／影片，套用為這一鏡現用畫面"
                onClick={openLibrary}
              >
                <Icon name="LayoutGrid" size={13} /> 從素材庫選用
              </Button>
            </div>
          )}
        </div>

        {/* 已綁定摘要 chips（最多 4，多出 +N）；有鎖定定裝時加視覺提示 */}
        <BoundSummaryChips
          projectId={projectId}
          shot={shot}
          characterNames={characterNames}
          looks={looks}
          locked={boundLocked}
        />

        {/* 必要操作（精簡） */}
        <div className="shot-card__face-actions">
          <Button size="sm" variant="primary" onClick={() => onOpenStudio(shot.id)}>
            <Icon name="SlidersHorizontal" size={13} /> 單格工作室
          </Button>
          {canEdit && shotNumber > 1 && (
            <ConfirmButton
              triggerClassName="btn-sm btn-ghost"
              triggerAriaLabel={`第 ${shotNumber} 鏡：從上一鏡承接連戲設定`}
              message={`把上一鏡的角色、造型、場景與攝影風格（光線／構圖／焦段）接到第 ${shotNumber} 鏡？鏡別與運鏡不會動——那是每一鏡該不一樣的地方。`}
              confirmLabel="承接"
              disabled={inherit.isPending}
              onConfirm={() =>
                inherit.mutate({
                  sceneId: shot.id,
                  aspects: ["characters", "looks", "location", "camera"],
                  expectedRev: shot.rev,
                })
              }
            >
              <Icon name="Copy" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
              {inherit.isPending ? "承接中…" : "從上一鏡承接"}
            </ConfirmButton>
          )}
          {inherit.data && (
            <Meta as="span" role="status">
              {inherit.data.changed ? `已承接：${inherit.data.changes.join("、")}` : "跟上一鏡已經一致"}
            </Meta>
          )}
          {inherit.error && <span className="error">{inherit.error.message}</span>}
        </div>
      </div>

      {/* ── 展開區：素材與設定 ── */}
      <details
        className="shot-card__details"
        open={detailsOpen}
        onToggle={(e) => setDetailsOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="shot-card__details-summary">
          <Icon name="ChevronDown" size={14} className="shot-card__details-chevron" />
          素材與設定
          <Meta as="span" className="shot-card__details-hint">
            世界引用・鏡頭語言・素材操作
          </Meta>
        </summary>

        <div className="shot-card__details-body">
          <textarea
            key={`prompt-${shot.id}-${shot.prompt ?? ""}`}
            className="shot-card__prompt"
            aria-label="畫面描述"
            placeholder="這一鏡的靜態畫面（構圖、光線、氣氛）…"
            defaultValue={shot.prompt ?? ""}
            readOnly={!canEdit}
            rows={2}
            onBlur={(e) => {
              const v = e.target.value;
              if (canEdit && v !== (shot.prompt ?? "")) saveFields({ prompt: v });
            }}
          />

          {/* World Refs：完整綁定 + 造型 */}
          <div className="shot-card__refs">
            <Meta as="span" className="shot-card__section-label">世界引用</Meta>
            <SceneCardBinding
              projectId={projectId}
              scene={{
                id: shot.id,
                characterIds: shot.characterIds,
                scenePresetIds: shot.scenePresetIds,
                propIds: shot.propIds,
                lookIds: shot.lookIds,
                rev: shot.rev,
              }}
              canEdit={canEdit}
              onSaved={refreshBoard}
            />
            {availableLooks.length > 0 && (
              <span className="shot-card__looks" role="group" aria-label="造型">
                {availableLooks.map((l) => {
                  const onIt = (shot.lookIds ?? []).includes(l.id);
                  const owner = characterNames.get(l.characterId);
                  return (
                    <Chip
                      key={l.id}
                      selected={onIt}
                      onClick={canEdit ? () => toggleLook(l.id) : undefined}
                      title={`${owner ? `${owner}的` : ""}造型：勾選後生成鎖定此造型`}
                    >
                      {owner ? `${owner}·${l.name}` : l.name}
                    </Chip>
                  );
                })}
              </span>
            )}
          </div>

          {/* 鏡頭語言 */}
          <div className="shot-card__direction" role="group" aria-label="鏡頭語言">
            <Meta as="span" className="shot-card__section-label">鏡頭語言</Meta>
            <label>
              鏡別
              <select
                aria-label="鏡別"
                value={shot.camera?.shotSize ?? ""}
                disabled={!canEdit}
                onChange={(e) => saveCamera("shotSize", e.target.value)}
              >
                <option value="">（未定）</option>
                {SHOT_SIZE_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
            {mode === "pro" && (
              <>
                <label>
                  角度
                  <select aria-label="角度" value={shot.camera?.angle ?? ""} disabled={!canEdit} onChange={(e) => saveCamera("angle", e.target.value)}>
                    <option value="">（未定）</option>
                    {SHOT_ANGLE_OPTIONS.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </label>
                <label>
                  運鏡
                  <select aria-label="運鏡" value={shot.camera?.movement ?? ""} disabled={!canEdit} onChange={(e) => saveCamera("movement", e.target.value)}>
                    <option value="">（未定）</option>
                    {SHOT_MOVEMENT_OPTIONS.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </label>
                <label>
                  焦段
                  <input
                    key={`focal-${shot.id}-${shot.camera?.focalLength ?? ""}`}
                    defaultValue={shot.camera?.focalLength ?? ""}
                    placeholder="50mm"
                    maxLength={20}
                    readOnly={!canEdit}
                    onBlur={(e) => saveCamera("focalLength", e.target.value)}
                  />
                </label>
                <label>
                  光線
                  <input
                    key={`light-${shot.id}-${shot.camera?.lighting ?? ""}`}
                    defaultValue={shot.camera?.lighting ?? ""}
                    placeholder="逆光、柔光…"
                    maxLength={60}
                    readOnly={!canEdit}
                    onBlur={(e) => saveCamera("lighting", e.target.value)}
                  />
                </label>
                <label>
                  構圖
                  <input
                    key={`comp-${shot.id}-${shot.camera?.composition ?? ""}`}
                    defaultValue={shot.camera?.composition ?? ""}
                    placeholder="三分法、留白…"
                    maxLength={60}
                    readOnly={!canEdit}
                    onBlur={(e) => saveCamera("composition", e.target.value)}
                  />
                </label>
              </>
            )}
          </div>

          {/* 表演：簡單模式也放表情（收在展開區不佔預設高度）；專業再加視線 */}
          <div className="shot-card__performance" role="group" aria-label="表演">
            <Meta as="span" className="shot-card__section-label">表演</Meta>
            <label>
              表情
              <input
                key={`emo-${shot.id}-${shot.performance?.emotion ?? ""}`}
                defaultValue={shot.performance?.emotion ?? ""}
                placeholder="平靜、若有所思…"
                maxLength={60}
                readOnly={!canEdit}
                onBlur={(e) => savePerformance("emotion", e.target.value)}
              />
            </label>
            {mode === "pro" && (
              <label>
                視線
                <input
                  key={`gaze-${shot.id}-${shot.performance?.gaze ?? ""}`}
                  defaultValue={shot.performance?.gaze ?? ""}
                  placeholder="看向遠方…"
                  maxLength={60}
                  readOnly={!canEdit}
                  onBlur={(e) => savePerformance("gaze", e.target.value)}
                />
              </label>
            )}
          </div>

          {mode === "pro" && (
            <textarea
              key={`action-${shot.id}-${shot.action ?? ""}`}
              className="shot-card__action"
              aria-label="動作走位"
              placeholder="動作走位：誰做了什麼、從哪到哪（只注入影片模型）"
              defaultValue={shot.action ?? ""}
              readOnly={!canEdit}
              rows={1}
              onBlur={(e) => {
                const v = e.target.value;
                if (canEdit && v !== (shot.action ?? "")) saveFields({ action: v });
              }}
            />
          )}

          {/* 素材操作：帶入我的素材 vs 外部 AI 成果 */}
          <div className="shot-card__asset-ops" role="group" aria-label="素材操作">
            <Meta as="span" className="shot-card__section-label">素材操作</Meta>
            <Hint as="p" className="shot-card__asset-ops-lede">
              {dragOver
                ? "放開檔案即可帶入這一鏡"
                : "可拖放檔案到卡片，或從素材庫選用現有圖／影。外部 AI 成果請用「帶入成果」。"}
            </Hint>
            <div className="shot-card__asset-ops-row">
              {canEdit && (
                <Button
                  size="sm"
                  variant="tonal"
                  type="button"
                  title="帶入我的素材：從專案素材庫選用"
                  onClick={() => setLibraryOpen((v) => !v)}
                  aria-expanded={libraryOpen}
                >
                  <Icon name="LayoutGrid" size={13} /> {libraryOpen ? "收起素材庫" : "從素材庫選用"}
                </Button>
              )}
              {canEdit && (
                <ExternalAssetIntake
                  projectId={projectId}
                  sceneId={shot.id}
                  sceneLabel={`第 ${shotNumber} 鏡「${shot.title}」`}
                  triggerLabel="帶入外部成果"
                  triggerVariant="ghost"
                  onImported={() => { void utils.scenes.listByProject.invalidate({ projectId }); }}
                />
              )}
              {canEdit && (
                <ExternalGenerationLauncher
                  projectId={projectId}
                  sceneId={shot.id}
                  sceneLabel={`第 ${shotNumber} 鏡「${shot.title}」`}
                  targetType="video"
                  prompt={[shot.prompt, shot.action, shot.dialogue].filter(Boolean).join("\n")}
                  referenceAssetIds={shot.assetId ? [shot.assetId] : []}
                />
              )}
            </div>

            {libraryOpen && canEdit && (
              <div className="shot-card__library" role="listbox" aria-label="從素材庫選用畫面">
                {libraryAssets.isLoading ? (
                  <Meta as="p">
                    <Icon name="Loader" className="spin" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                    載入素材庫…
                  </Meta>
                ) : libraryVisuals.length === 0 ? (
                  <Hint as="p">素材庫還沒有圖片／影片——可拖檔案到這一卡，或到專案素材庫上傳。</Hint>
                ) : (
                  <div className="shot-card__library-grid">
                    {libraryVisuals.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        role="option"
                        aria-selected={a.id === shot.assetId}
                        title={`${a.title}${a.id === shot.assetId ? "（目前使用）" : "—套用為這一鏡畫面"}`}
                        disabled={setVisual.isPending}
                        className={`shot-card__library-item${a.id === shot.assetId ? " is-current" : ""}`}
                        onClick={() => applyLibraryAsset(a.id)}
                      >
                        {a.kind === "video" ? (
                          <AssetVideo src={a.url!} muted preload="metadata" className="shot-card__library-thumb" fallbackLabel="影" />
                        ) : (
                          <AssetImg src={a.url!} alt={a.title} loading="lazy" className="shot-card__library-thumb" fallbackLabel="圖" />
                        )}
                        <span className="shot-card__library-label">{a.title.slice(0, 18)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {setVisual.error && <p className="error" role="alert">{setVisual.error.message}</p>}
              </div>
            )}

            {mode === "pro" && assetHints.length > 0 && (
              <div className="shot-card__assets">
                <Meta as="span">
                  <Icon name="Paperclip" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                  專案素材裡名稱或標籤對得上的：
                </Meta>
                {assetHints.map((a) => (
                  <Chip
                    key={a.id}
                    title={`符合：${a.matched.join("、")}（點擊套用為這一鏡畫面）`}
                    onClick={canEdit ? () => applyLibraryAsset(a.id) : undefined}
                  >
                    {a.title.slice(0, 14)}
                  </Chip>
                ))}
              </div>
            )}
          </div>

          <div className="shot-card__foot">
            <Button size="sm" variant="primary" onClick={() => onOpenStudio(shot.id)}>
              <Icon name="Sparkles" size={13} /> {shot.assetUrl ? "重畫／修正" : "生成畫面"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onOpenStudio(shot.id)} title="配音、環境音、版本都在單格工作室">
              <Icon name="Volume2" size={13} /> 聲音
            </Button>
            <span style={{ flex: "1 1 auto" }} />
            {canEdit && (
              <ConfirmButton
                triggerClassName="btn-sm btn-ghost"
                triggerAriaLabel={`刪除第 ${shotNumber} 鏡`}
                message={`刪除第 ${shotNumber} 鏡？會移到回收桶，可還原。`}
                confirmLabel="刪除"
                disabled={removeShot.isPending}
                onConfirm={() => removeShot.mutate({ sceneId: shot.id })}
              >
                <Icon name="Trash2" size={13} />
              </ConfirmButton>
            )}
          </div>
        </div>
      </details>

      {dropStatus && (
        <Hint as="div" role="status" className="shot-card__import-status">
          {dropStatus}
          {dropDuplicateUrl && <a className="btn-ghost btn-sm" href={dropDuplicateUrl} target="_blank" rel="noreferrer">查看原素材</a>}
          {dropResult && (
            <Button
              size="sm"
              variant="primary"
              disabled={confirmImported.isPending}
              onClick={() => confirmImported.mutate({ assetId: dropResult.assetId, sceneId: shot.id, bindingId: dropResult.bindingId })}
            >
              套用到第 {shotNumber} 鏡
            </Button>
          )}
        </Hint>
      )}
      {update.error && <p className="error">{update.error.message}</p>}
    </Card>
  );
}

/**
 * 緊湊面綁定摘要：角色／場景／道具／造型最多 4 顆 chip，其餘 +N。
 * 與 SceneCardBinding 同快取鍵讀名字——面板收合時也能掃讀「這一鏡用誰」。
 */
function BoundSummaryChips({
  projectId,
  shot,
  characterNames,
  looks,
  locked,
}: {
  projectId: string;
  shot: ShotRow;
  characterNames: Map<string, string>;
  looks: LookRow[];
  locked: boolean;
}) {
  const scenePresets = trpc.scenePresets.list.useQuery({ projectId });
  const props = trpc.props.list.useQuery({ projectId });

  const chips = useMemo(() => {
    const items: Array<{ key: string; label: string; kind: "char" | "scene" | "prop" | "look" }> = [];
    for (const id of shot.characterIds ?? []) {
      const name = characterNames.get(id);
      items.push({ key: `c-${id}`, label: name ?? "角色", kind: "char" });
    }
    for (const id of shot.scenePresetIds ?? []) {
      const name = scenePresets.data?.find((s) => s.id === id)?.name;
      items.push({ key: `s-${id}`, label: name ?? "場景", kind: "scene" });
    }
    for (const id of shot.propIds ?? []) {
      const row = props.data?.find((p) => p.id === id);
      items.push({
        key: `p-${id}`,
        label: row ? formatPropDisplayName(row.name, row.ownerName) : "道具",
        kind: "prop",
      });
    }
    for (const id of shot.lookIds ?? []) {
      const look = looks.find((l) => l.id === id);
      if (!look) continue;
      const owner = characterNames.get(look.characterId);
      items.push({
        key: `l-${id}`,
        label: owner ? `${owner}·${look.name}` : look.name,
        kind: "look",
      });
    }
    return items;
  }, [shot.characterIds, shot.scenePresetIds, shot.propIds, shot.lookIds, characterNames, scenePresets.data, props.data, looks]);

  if (chips.length === 0) {
    return (
      <div className="shot-card__bound-summary shot-card__bound-summary--empty" aria-label="尚未鎖定定裝">
        <Meta as="span">未鎖定定裝・沿用生成台勾選</Meta>
      </div>
    );
  }

  const shown = chips.slice(0, BOUND_CHIP_LIMIT);
  const extra = chips.length - shown.length;

  return (
    <div
      className={`shot-card__bound-summary${locked ? " shot-card__bound-summary--locked" : ""}`}
      role="group"
      aria-label={locked ? "已鎖定定裝" : "已綁定引用"}
      title={locked ? "這一鏡已鎖定定裝：生成時只用這些卡片／造型" : undefined}
    >
      {locked && (
        <span className="shot-card__lock-badge" title="已鎖定定裝">
          <Icon name="Lock" size={11} />
        </span>
      )}
      {shown.map((c) => (
        <Chip key={c.key} className={`shot-card__bound-chip shot-card__bound-chip--${c.kind}`}>
          {c.label}
        </Chip>
      ))}
      {extra > 0 && (
        <Chip className="shot-card__bound-chip shot-card__bound-chip--more" title={chips.slice(BOUND_CHIP_LIMIT).map((c) => c.label).join("、")}>
          +{extra}
        </Chip>
      )}
    </div>
  );
}
