import { useEffect, useRef, useState, type CSSProperties } from "react";
import { trpc } from "../api";
import { SceneCardBinding } from "./SceneCardBinding";
import { ScenePromptPreview } from "./ScenePromptPreview";
import { resolveSceneCards } from "@shared/sceneCards";
import { MAX_GENERATE_CHARACTERS, MAX_GENERATE_PROPS, MAX_GENERATE_SCENE_PRESETS } from "@shared/cardLimits";
// tierLabel／estimatePoints 隨「逐格生成模型」選單一起移進單格工作室，這裡不再需要
import { getModel, MODELS } from "@shared/models";
import { REWORK_TAGS, parseEpisodeTitle, reworkTagNeedsNote, type ReworkTag } from "@shared/seriesTemplate";
import { StoryboardPlayer } from "./StoryboardPlayer";
import { SceneStudio } from "./SceneStudio";
import { ExportJobButton } from "./ExportJobButton";
import { Icon } from "./Icon";
import { ConfirmButton, HelpTip } from "./interactions";
import { AssetImg, AssetVideo } from "./MediaFallback";
import { discussInMessages } from "../discuss";

import { Button, Card, EmptyState, Hint, Meta, Pill, Skeleton, type PillStatus } from "./ui";
/** 素材類型的中文標籤（與素材庫/生成紀錄同口徑）——分鏡 meta 列不再直接冒英文 enum */
const SCENE_KIND_LABEL: Record<string, string> = { image: "圖片", video: "影片", audio: "音訊", doc: "文件" };

const SCENE_STATUS: Record<string, { label: string; cls: PillStatus }> = {
  todo: { label: "草稿", cls: "queued" },
  review: { label: "草稿", cls: "queued" },
  pending: { label: "待審", cls: "running" },
  needs_work: { label: "需修改", cls: "failed" },
  approved: { label: "已通過", cls: "done" },
};

// 逐格快速出圖的預設模型：便宜快、試構圖首選。要換模型／細修請開「單格工作室」——
// 工作室選過的模型記在同一把 localStorage 鑰匙，這裡的「生成這一格」會跟著用。
const DEFAULT_MODEL = "fal-ai/fast-lightning-sdxl";
// 可當快速出圖的文生圖模型（不需來源素材；與單格工作室「重畫這格」同一份清單口徑）
const SCENE_GEN_MODELS = MODELS.filter((m) => m.category === "text-to-image" && !m.needs);

// 目標剪輯軟體 → 可直接匯入的檔案（需求 #8＋直連強化）：每套軟體列出「最能直接組好時間軸」的
// 格式優先（Premiere 吃 xmeml 時間軸、FCP/Resolve/剪映專業版吃 fcpxml），字幕 SRT 當通用備援；
// 剪映/CapCut 沒有時間軸匯入功能，另供「草稿包（實驗）」——解壓到草稿目錄開剪映即見排好的時間軸。
// 交付包內的 fcpxml/xmeml 為媒體連結版（匯入即掛媒體）；這裡的單檔下載是骨架版（無媒體引用）。
const EDIT_TARGETS = [
  { key: "capcut", label: "剪映 / CapCut", files: [{ format: "srt", ext: ".srt", name: "字幕/對位" }], draft: true },
  { key: "capcutpro", label: "剪映專業版", files: [{ format: "fcpxml", ext: ".fcpxml", name: "時間軸" }, { format: "srt", ext: ".srt", name: "字幕" }], draft: true },
  { key: "premiere", label: "Premiere Pro", files: [{ format: "xmeml", ext: ".xml", name: "時間軸" }, { format: "srt", ext: ".srt", name: "字幕" }] },
  { key: "fcp", label: "Final Cut Pro", files: [{ format: "fcpxml", ext: ".fcpxml", name: "時間軸" }] },
  { key: "resolve", label: "DaVinci Resolve", files: [{ format: "fcpxml", ext: ".fcpxml", name: "時間軸" }, { format: "edl", ext: ".edl", name: "剪輯表" }] },
] as const;
type EditTargetKey = (typeof EDIT_TARGETS)[number]["key"];
// 記住上次選的目標剪輯軟體（跨專案共用——同一位剪輯師用的軟體不會換來換去）
const EDIT_TARGET_LS_KEY = "aios.edittarget";

/**
 * 單格分鏡：欄位逐一對齊 scenes.listByProject 的投影。
 *
 * 這裡**不宣告 narrationAssetId**，而且是刻意的：該欄位不在這支 procedure 的投影裡
 * （只出現在 scenes.versions）。先前把它宣告成 optional，讓「這格有沒有旁白」的判斷
 * 永遠是 falsy——流程條卡死在「配音」而使用者明明聽得到旁白，tsc 卻擋不下來。
 * 少了這行宣告，同樣的誤用現在會直接編譯失敗。
 *
 * （不用 inferRouterOutputs 由 router 推導，是因為 ADR 009 禁止 client 匯入 server。）
 *
 * 判斷旁白好了沒一律看 narrationUrl：它來自濾過軟刪的 join，語意是「有可播的旁白」。
 * scenes.narrationAssetId 在素材軟刪後會刻意保留（供回收桶還原），拿它判斷會讓
 * 已刪旁白的格子假裝成「旁白 ✓」，還會與交付包（已濾軟刪）不一致。
 */
type Scene = {
  id: string;
  title: string;
  orderIndex: number;
  durationSec: number;
  status: string;
  assetId: string | null;
  prompt: string | null;
  voiceover: string | null;
  assetUrl: string | null;
  assetKind: string | null;
  generationId: string | null;
  /** 該格若有進行中的「畫面」生成，回 queued/running；無則 null（後端已排除 narration）。 */
  pendingGenStatus?: string | null;
  /** 已生成且未軟刪的旁白音檔網址——判斷「這格有沒有旁白」的唯一依據。 */
  narrationUrl?: string | null;
  /** 該格若有進行中的「配音」生成，回 queued/running；無則 null。 */
  pendingVoiceStatus?: string | null;
  /** 逐鏡卡片綁定：這一鏡指定要用的設定卡（皆空＝沿用生成台勾選） */
  characterIds?: string[] | null;
  scenePresetIds?: string[] | null;
  propIds?: string[] | null;
};

/**
 * 行內可編輯欄位（標題／秒數）：草稿即所見。
 * - Enter 或失焦送出，Esc 還原；數字夾在 1–60。
 * committedRef 去重：Enter 觸發送出後緊接的 blur 不會重打一次 API。
 * 未聚焦時才跟隨伺服器刷新，避免 10 秒輪詢把使用者正在打的字洗掉。
 * （配音詞／提示詞的多行編輯已收進「單格工作室」，這裡不再需要 textarea。）
 */
function InlineEdit({
  value,
  kind,
  onCommit,
  pending,
  ariaLabel,
  placeholder,
  style,
  maxLength,
}: {
  value: string | number;
  kind: "text" | "number";
  onCommit: (next: string | number) => void;
  pending: boolean;
  ariaLabel: string;
  placeholder?: string;
  style?: CSSProperties;
  /** 與後端 zod 上限對齊（標題 60）：貼超長直接截住，不再失焦才爆「儲存失敗」 */
  maxLength?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const committedRef = useRef(String(value));

  useEffect(() => {
    if (!focused) {
      setDraft(String(value));
      committedRef.current = String(value);
    }
  }, [value, focused]);

  const commit = () => {
    if (kind === "number") {
      const n = parseInt(draft, 10);
      if (Number.isNaN(n)) {
        // 空白／非數字：還原，不送出
        setDraft(committedRef.current);
        return;
      }
      const clamped = Math.min(60, Math.max(1, n));
      const asStr = String(clamped);
      setDraft(asStr);
      if (asStr === committedRef.current) return;
      committedRef.current = asStr;
      onCommit(clamped);
      return;
    }
    const trimmed = draft.trim();
    if (trimmed === "") {
      // 標題不可空：還原
      setDraft(committedRef.current);
      return;
    }
    if (trimmed === committedRef.current) return;
    committedRef.current = trimmed;
    onCommit(trimmed);
  };

  const revert = () => {
    setDraft(committedRef.current);
    setFocused(false);
  };

  return (
    <input
      value={draft}
      disabled={pending}
      aria-label={ariaLabel}
      placeholder={placeholder}
      maxLength={maxLength}
      type={kind === "number" ? "number" : "text"}
      min={kind === "number" ? 1 : undefined}
      max={kind === "number" ? 60 : undefined}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          revert();
          e.currentTarget.blur();
        }
      }}
      style={{ fontSize: kind === "number" ? 13 : 14, padding: "5px 8px", ...style }}
    />
  );
}

/** 單格分鏡（精簡版）：縮圖、標題/秒數、狀態，加「一顆依狀態決定的主要動作」。
 *  深改（提示詞、配音、換模型、版本）都收進單格工作室——列表回歸排順序與總覽。 */
function SceneRow({
  s,
  i,
  total,
  rowClassName,
  isLeader,
  canEdit,
  meLoading,
  genModelId,
  onOpenStudio,
  projectId,
  charIds,
  sceneIds,
  propIds,
  invalidate,
  move,
  remove,
  submitApproval,
  decide,
  pending,
  rejectReason,
  isSeriesEpisode = false,
}: {
  s: Scene;
  i: number;
  total: number;
  rowClassName?: string;
  isLeader: boolean;
  canEdit: boolean;
  meLoading: boolean;
  /** 快速出圖用的文生圖模型（跟著單格工作室上次選的；預設 SDXL Lightning） */
  genModelId: string;
  /** 開這一格的單格工作室。工作室由 SceneList 統一渲染，不掛在列內——`.gen-row` 帶
   *  content-visibility:auto（paint containment），會成為 fixed 定位的包含區塊，把全螢幕 modal 裁掉。 */
  onOpenStudio: () => void;
  /** 逐鏡卡片綁定面板要用（讀本專案的卡片清單） */
  projectId: string;
  /** 生成台勾選的角色/場景/素材卡：只在「這一鏡沒指定自己的卡片」時當 fallback 用 */
  charIds?: string[];
  sceneIds?: string[];
  propIds?: string[];
  invalidate: () => void;
  move: ReturnType<typeof trpc.scenes.move.useMutation>;
  remove: ReturnType<typeof trpc.scenes.remove.useMutation>;
  submitApproval: ReturnType<typeof trpc.approvals.submit.useMutation>;
  decide: ReturnType<typeof trpc.approvals.decide.useMutation>;
  pending: { id: string } | undefined;
  /** 最新一筆已裁決的退回理由（needs_work）——提交人不必翻留言才知道改什麼 */
  rejectReason?: string | null;
  /** 這一格屬於母版系列的一集 → 退回改用固定標籤（#255） */
  isSeriesEpisode?: boolean;
}) {
  // 每格自持 update／generateInto，pending 與錯誤才不會互相污染（一格存檔不會鎖住別格）
  // 行內編輯（標題/秒數）失焦即存但原本沒有成功回饋——比照世界觀卡「已儲存 ✓」短暫顯示 2 秒
  const [savedFlash, setSavedFlash] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(savedTimer.current), []);
  const update = trpc.scenes.update.useMutation({
    onSuccess: () => {
      invalidate();
      setSavedFlash(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSavedFlash(false), 2000);
    },
  });
  // 冪等鍵（QA-007）：同一格「還沒成功」的生成重試沿用同鍵——timeout 重按不重複扣點；成功才換新鍵
  const genRequestId = useRef<string>(crypto.randomUUID());
  const generate = trpc.scenes.generateInto.useMutation({
    onSuccess: () => { genRequestId.current = crypto.randomUUID(); invalidate(); },
  });

  const isGenerating = s.pendingGenStatus === "queued" || s.pendingGenStatus === "running";
  // 配音生成中：後端背景 runner 完成後會回填旁白音檔，10 秒輪詢自動刷新
  const isVoicing = s.pendingVoiceStatus === "queued" || s.pendingVoiceStatus === "running";
  const hasVoiceover = (s.voiceover ?? "").trim() !== "";
  const hasPrompt = (s.prompt ?? "").trim() !== "";
  // 這一鏡實際會用的卡片（有綁用它、沒綁沿用生成台勾選）——預覽與出圖看的是同一份
  const effectiveCards = resolveSceneCards(s, { characterIds: charIds, scenePresetIds: sceneIds, propIds });
  const rowError = update.error ?? generate.error;
  // 快速出圖的預估點數（HelpPage 承諾「送出前先看預估點數，點頭才扣」——這裡兌現）
  const genModel = getModel(genModelId) ?? getModel(DEFAULT_MODEL);
  const genPoints = genModel?.points;
  const isDraft = s.status === "todo" || s.status === "review";

  // 主要動作已經是「開單格工作室」時（沒提示詞／被退回要修），就不再重複列 tonal 版工作室鈕
  const primaryOpensStudio = canEdit && ((!s.assetId && !hasPrompt && !isGenerating) || s.status === "needs_work");

  return (
    <div className={`gen-row scene-list__row${rowClassName ? ` ${rowClassName}` : ""}`} data-fb="分鏡格" id={`scene-${s.id}`}>
      {/* 縮圖即入口：點縮圖＝開單格工作室（Adobe 式「點素材放大修」的直覺） */}
      <button
        type="button"
        className="scene-thumb-btn"
        title="開單格工作室：細修畫面、配音、版本"
        aria-label={`第 ${i + 1} 鏡縮圖，開單格工作室`}
        onClick={onOpenStudio}
      >
        {s.assetUrl ? (
          s.assetKind === "video" ? (
            <AssetVideo className="gen-thumb" src={s.assetUrl} muted preload="metadata" fallbackClassName="gen-thumb" fallbackLabel="素材遺失" fallbackIconSize={16} />
          ) : (
            <AssetImg className="gen-thumb" src={s.assetUrl} alt={s.title} fallbackClassName="gen-thumb" fallbackLabel="素材遺失" fallbackIconSize={16} />
          )
        ) : (
          <span className="gen-thumb" style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "var(--soft)" }}>
            {isGenerating ? <Icon name="Loader" className="spin" size={20} /> : <Icon name="Plus" size={20} />}
          </span>
        )}
      </button>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="mono" style={{ color: "var(--primary-ink)", flexShrink: 0 }}>{i + 1}</span>
          <InlineEdit
            value={s.title}
            kind="text"
            pending={update.isPending || !canEdit}
            ariaLabel={`第 ${i + 1} 鏡標題`}
            placeholder="鏡頭標題"
            maxLength={60}
            onCommit={(v) => update.mutate({ sceneId: s.id, title: String(v) })}
            style={{ flex: 1, minWidth: 0 }}
          />
        </div>
        <div className="meta mono" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <InlineEdit
              value={s.durationSec}
              kind="number"
              pending={update.isPending || !canEdit}
              ariaLabel={`第 ${i + 1} 鏡秒數`}
              onCommit={(v) => update.mutate({ sceneId: s.id, durationSec: Number(v) })}
              style={{ width: 56, textAlign: "center" }}
            />
            秒
          </label>
          <span>・{s.assetKind ? (SCENE_KIND_LABEL[s.assetKind] ?? s.assetKind) : "無畫面"}</span>
          <Pill status={SCENE_STATUS[s.status]?.cls ?? "queued"}>
            {SCENE_STATUS[s.status]?.label ?? s.status}
          </Pill>
          {isGenerating && <Pill status="running">生成中…</Pill>}
          {/* 旁白狀態一眼可見（編輯入口在單格工作室・配音） */}
          {isVoicing ? (
            <Meta style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <Icon name="Mic" size={11} /> 配音生成中…
            </Meta>
          ) : s.narrationUrl ? (
            <Meta style={{ color: "var(--success-ink)", display: "inline-flex", alignItems: "center", gap: 3 }}>
              <Icon name="Mic" size={11} /> 旁白 ✓
            </Meta>
          ) : hasVoiceover ? (
            <Meta style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <Icon name="Mic" size={11} /> 旁白未生成
            </Meta>
          ) : null}
          {update.isPending ? (
            <Meta>儲存中…</Meta>
          ) : savedFlash ? (
            <Meta role="status" style={{ color: "var(--success-ink)" }}>
              已儲存 <Icon name="Check" size={12} style={{ verticalAlign: "-1px" }} />
            </Meta>
          ) : null}
        </div>
        {s.status === "needs_work" && rejectReason && (
          <Meta
            as="p"
            role="status"
            style={{
              margin: "6px 0 0",
              padding: "6px 10px",
              borderRadius: "var(--r-8)",
              background: "var(--danger-tint, rgba(180,60,60,0.08))",
              border: "1px solid var(--danger)",
              color: "var(--danger-ink)",
              whiteSpace: "pre-wrap",
            }}
          >
            <b>退回理由：</b>{rejectReason}
          </Meta>
        )}

        {/* 逐鏡卡片綁定：這一鏡用誰、在哪、拿什麼——沒指定就沿用生成台勾選 */}
        <SceneCardBinding projectId={projectId} scene={s} canEdit={canEdit} onSaved={invalidate} />

        {rowError && <p className="error" role="alert">存檔／生成失敗：{rowError.message}</p>}

        {/* 動作列：一顆依狀態決定的主要動作＋固定的次要入口（單格工作室／下載／討論）。
            扣點動作先確認（顯示預估點數）；檢視者只看得到工作室（唯讀）、下載與討論（2.3） */}
        <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
          {canEdit && (
            isGenerating || generate.isPending ? (
              <Button size="sm" variant="primary" disabled>生成中…</Button>
            ) : !s.assetId ? (
              hasPrompt ? (
                <>
                <ConfirmButton
                  triggerClassName="primary btn-sm"
                  triggerTitle="用這一格的提示詞快速出圖，完成後自動回填縮圖；要換模型請開單格工作室"
                  message={`即將生成這一格（${genModel?.label ?? genModelId}${genPoints != null ? `，約 −${genPoints} 點` : ""}）；失敗自動退點`}
                  confirmLabel="確認生成"
                  onConfirm={() =>
                    generate.mutate({
                      sceneId: s.id,
                      modelId: genModel?.id ?? DEFAULT_MODEL,
                      clientRequestId: genRequestId.current,
                      // 上限與 generation.submit 同一份 shared 常數：超勾取前幾張，不讓逐格生成整個被 zod 擋下
                      characterIds: charIds?.length ? charIds.slice(0, MAX_GENERATE_CHARACTERS) : undefined,
                      scenePresetIds: sceneIds?.length ? sceneIds.slice(0, MAX_GENERATE_SCENE_PRESETS) : undefined,
                      propIds: propIds?.length ? propIds.slice(0, MAX_GENERATE_PROPS) : undefined,
                    })
                  }
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Icon name="Sparkles" /> 生成這一格{genPoints != null ? `（約 −${genPoints} 點）` : ""}
                  </span>
                </ConfirmButton>
                {/* 先預覽：出圖前看實際會送出什麼（不扣點）——與送出走同一支組裝器，預覽不會說謊 */}
                <ScenePromptPreview
                  projectId={projectId}
                  modelId={genModel?.id ?? DEFAULT_MODEL}
                  prompt={s.prompt ?? ""}
                  characterIds={effectiveCards.characterIds}
                  scenePresetIds={effectiveCards.scenePresetIds}
                  propIds={effectiveCards.propIds}
                />
                </>
              ) : (
                <Button size="sm" variant="primary" title="這一格還沒有提示詞——開單格工作室寫提示詞、出第一版畫面" onClick={onOpenStudio}>
                  <Icon name="Sparkles" size={13} /> 寫提示詞出圖
                </Button>
              )
            ) : !meLoading && isDraft ? (
              <Button size="sm" variant="primary" disabled={submitApproval.isPending} onClick={() => submitApproval.mutate({ sceneId: s.id })}>
                送審
              </Button>
            ) : !meLoading && s.status === "needs_work" ? (
              <>
                <Button size="sm" variant="primary" title="照退回理由修這一格：開單格工作室改畫面或配音" onClick={onOpenStudio}>
                  <Icon name="SlidersHorizontal" size={13} /> 去修這一格
                </Button>
                <Button size="sm" disabled={submitApproval.isPending} onClick={() => submitApproval.mutate({ sceneId: s.id })}>
                  重送審
                </Button>
              </>
            ) : null
          )}
          {!meLoading && isLeader && s.status === "pending" && pending && (
            <>
              <button style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 12px", fontSize: 12, color: "var(--success-ink)", borderColor: "var(--success)" }}
                disabled={decide.isPending}
                onClick={() => decide.mutate({ approvalId: pending.id, decision: "approved" })}>
                <Icon name="Check" /> 通過
              </button>
              <ConfirmButton
                triggerStyle={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 12px", fontSize: 12, color: "var(--danger-ink)", borderColor: "var(--danger)" }}
                disabled={decide.isPending}
                title="退回這一鏡"
                reason={
                  isSeriesEpisode
                    ? {
                      // 母版系列：退回原因收斂成固定 5 種，退回後只重做被點名的步驟或鏡號，不整案重跑
                      label: "退回原因（會通知提交人）",
                      placeholder: "選「其他」時必填；其餘可補一句細節…",
                      tags: REWORK_TAGS,
                      tagRequired: true,
                      tagsNeedingNote: REWORK_TAGS.filter((t) => reworkTagNeedsNote(t.value)).map((t) => t.value),
                    }
                    : {
                      label: "退回理由（會通知提交人）",
                      placeholder: "說明需要修改的地方…",
                      required: true,
                      presets: ["畫面與腳本不符", "人物長相跑掉", "文字有錯字", "風格不一致", "請再修一版"],
                    }
                }
                confirmLabel="退回"
                onConfirm={(reason, tag) => decide.mutate({
                  approvalId: pending.id,
                  decision: "needs_work",
                  reason,
                  reasonTag: (tag as ReworkTag | undefined),
                })}
              >
                <Icon name="Undo2" /> 退回
              </ConfirmButton>
            </>
          )}
          {/* 單格工作室：Adobe 式「把單張拉出來改」——畫面、配音、版本的深改都在這裡。
              檢視者也開得起來（唯讀回看版本與成本），寫入控制由工作室內部依 canEdit 隱藏。 */}
          {!primaryOpensStudio && (
            <Button
              size="sm"
              variant="tonal"
              title="把這一格拉出來單獨修：改畫面（換模型/以底圖修）、編配音詞生成旁白、回看並切換版本"
              onClick={onOpenStudio}
            >
              <Icon name="SlidersHorizontal" size={13} /> 單格工作室
            </Button>
          )}
          {s.assetUrl && (
            <a
              // 用同源 /api/assets/:id/file 才能讓 download 屬性生效——直接用 assetUrl 對「尚未落地/落地失敗」
              // 的成品會是跨源 fal 網址，瀏覽器會忽略 download 改成導航離開 SPA。無 assetId 時退回原網址。
              href={s.assetId ? `/api/assets/${s.assetId}/file` : s.assetUrl}
              download
              className="btn-tonal"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "var(--sp-4) var(--sp-12)", fontSize: "var(--fs-12)", borderRadius: "var(--r-8)", textDecoration: "none", borderStyle: "solid", borderWidth: 1, transition: "background var(--dur-base), border-color var(--dur-base)" }}
            >
              <Icon name="Download" /> 下載
            </a>
          )}
          {/* 在留言中討論：對所有人開放（含檢視者——留言是唯讀者的參與出口） */}
          {!meLoading && (
            <button
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 12px", fontSize: 12 }}
              title="把這一鏡帶進組內留言討論"
              onClick={() => discussInMessages({ refType: "scene", refId: s.id, title: s.title })}
            >
              <Icon name="MessageCircle" size={13} /> 討論
            </button>
          )}
          {/* 已通過也能重送：後端本就版本化（重送＝新版本、舊 pending 作廢），換素材後不必刪掉重建 */}
          {!meLoading && canEdit && s.status === "approved" && (
            <button style={{ padding: "3px 12px", fontSize: 12 }} disabled={submitApproval.isPending}
              onClick={() => submitApproval.mutate({ sceneId: s.id })}>
              重送新版審核
            </button>
          )}
        </div>
      </div>
      {canEdit && (
        <div style={{ display: "flex", gap: 4 }}>
          <button style={{ display: "inline-flex", alignItems: "center", padding: "4px 10px" }} disabled={i === 0 || move.isPending} aria-label="上移" onClick={() => move.mutate({ sceneId: s.id, direction: "up" })}><Icon name="ChevronUp" size={16} /></button>
          <button style={{ display: "inline-flex", alignItems: "center", padding: "4px 10px" }} disabled={i === total - 1 || move.isPending} aria-label="下移" onClick={() => move.mutate({ sceneId: s.id, direction: "down" })}><Icon name="ChevronDown" size={16} /></button>
          <ConfirmButton
            triggerStyle={{ display: "inline-flex", alignItems: "center", padding: "4px 10px", color: "var(--danger-ink)" }}
            disabled={remove.isPending}
            triggerAriaLabel="刪除"
            triggerTitle="刪除後移到回收桶，可還原（保留配音詞與提示詞）"
            message={`把分鏡「${s.title}」移到回收桶？可從回收桶還原。`}
            confirmLabel="刪除"
            onConfirm={() => remove.mutate({ sceneId: s.id })}
          ><Icon name="X" size={16} /></ConfirmButton>
        </div>
      )}
    </div>
  );
}

/** 製作流程五階段：給「現在該做什麼」一個明確答案（C 流程引導）。 */
type StageKey = "board" | "asset" | "voice" | "review" | "deliver";
const PIPELINE_STAGES: Array<{ key: StageKey; label: string }> = [
  { key: "board", label: "排分鏡" },
  { key: "asset", label: "補畫面" },
  { key: "voice", label: "配音" },
  { key: "review", label: "送審" },
  { key: "deliver", label: "打包交付" },
];

/** 分鏡・交付：排順序＋逐格主要動作（A）→ 流程引導（C）→ 交付中心（B）。
 *  深改（提示詞/配音/換模型/版本）集中在單格工作室；審批三態機與打包照舊。
 *  canEdit=false（2.3 檢視者）：隱藏所有寫入控制，瀏覽與下載照常 */
export function SceneList({ projectId, isLeader, canEdit = true, charIds, sceneIds, propIds, projectTitle }: { projectId: string; isLeader: boolean; canEdit?: boolean; charIds?: string[]; sceneIds?: string[]; propIds?: string[]; /** 專案標題——只用來判斷「這是不是母版系列的一集」（#255 退回標籤） */ projectTitle?: string }) {
  const utils = trpc.useUtils();
  // 與 App 端同 key 吃快取：只為了「auth.me 還沒回來前先不畫操作鈕」，避免組長進頁時按鈕先缺後補的閃爍
  const me = trpc.auth.me.useQuery();
  const scenes = trpc.scenes.listByProject.useQuery({ projectId }, { refetchInterval: 10_000 });
  const approvals = trpc.approvals.listByProject.useQuery({ projectId }, { refetchInterval: 10_000 });
  const invalidate = () => {
    utils.scenes.listByProject.invalidate({ projectId });
    utils.approvals.listByProject.invalidate({ projectId });
    utils.messages.list.invalidate({ projectId });
    // 同類缺陷一併修：分鏡軟刪後回收桶要立即看得到（與知識庫刪除同一根因）
    utils.projects.listDeleted.invalidate({ projectId });
  };
  const move = trpc.scenes.move.useMutation({ onSuccess: invalidate });
  const remove = trpc.scenes.remove.useMutation({ onSuccess: invalidate });
  const submitApproval = trpc.approvals.submit.useMutation({ onSuccess: invalidate });
  const decide = trpc.approvals.decide.useMutation({ onSuccess: invalidate });
  // #255：這個專案是不是母版系列的一集？是的話退回改用固定標籤（結構跑掉／出處不符／…），
  // 組員才知道要重做哪一步；不是的話維持原本的自由文字＋快捷句。
  // 標題由呼叫端傳入而非在此重查專案：ProjectPage 早就載好了，多開一支 query 只會讓
  // 每個掛 SceneList 的測試都得補 projects.get 樁（#256 剛因同類耦合修過一輪）。
  const isSeriesEpisode = !!projectTitle && !!parseEpisodeTitle(projectTitle);
  const pendingOf = (sceneId: string) => approvals.data?.find((a) => a.sceneId === sceneId && a.status === "pending");
  // listByProject 已依 createdAt desc：同鏡最新一筆 needs_work 的 reason 即最近退回理由
  const rejectReasonOf = (sceneId: string) =>
    approvals.data?.find((a) => a.sceneId === sceneId && a.status === "needs_work" && a.reason)?.reason ?? null;
  // 統一小紅字：這四個共用 mutation 失敗時（送審/裁決/排序/刪除）畫面要有反應。就地編輯/生成的錯誤各格自行顯示。
  const actionError = submitApproval.error ?? decide.error ?? move.error ?? remove.error;

  const list = (scenes.data ?? []) as Scene[];
  const totalSec = list.reduce((sum, s) => sum + s.durationSec, 0);
  type SceneFilter = "all" | "draft" | "pending" | "needs_work" | "approved" | "missing";
  const [sceneFilter, setSceneFilter] = useState<SceneFilter>("all");
  const [sceneListExpanded, setSceneListExpanded] = useState(false);

  // 通知深連結配套（與 ProjectPage 的 focus effect 分工）：
  // focus=scene-<id> 時手機收合的第 5 格以後是 display:none，先展開完整列表讓目標可見；
  // focus=pending（組長彙總入口）直接切到「待審」篩選，一到頁就是要裁決的清單。
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get("focus");
    if (!focus) return;
    if (focus === "pending") setSceneFilter("pending");
    else if (/^scene-[0-9a-f-]+$/i.test(focus)) setSceneListExpanded(true);
  }, []);
  const statusCounts = {
    draft: list.filter((s) => s.status === "todo" || s.status === "review").length,
    pending: list.filter((s) => s.status === "pending").length,
    needs_work: list.filter((s) => s.status === "needs_work").length,
    approved: list.filter((s) => s.status === "approved").length,
    missing: list.filter((s) => !s.assetId).length,
  };
  const sceneMatchesFilter = (scene: Scene, filter: SceneFilter) =>
    filter === "all"
    || (filter === "draft" && (scene.status === "todo" || scene.status === "review"))
    || (filter === "missing" && !scene.assetId)
    || scene.status === filter;
  const filteredSceneEntries = list
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => sceneMatchesFilter(scene, sceneFilter));
  const sceneFilters: Array<{ id: SceneFilter; label: string; count: number }> = [
    { id: "all", label: "全部", count: list.length },
    { id: "draft", label: "草稿", count: statusCounts.draft },
    { id: "pending", label: "待審", count: statusCounts.pending },
    { id: "needs_work", label: "需修改", count: statusCounts.needs_work },
    { id: "approved", label: "已通過", count: statusCounts.approved },
    { id: "missing", label: "無畫面", count: statusCounts.missing },
  ];

  // ── C 流程引導：五階段，算出「現在卡在哪一步」與下一步提示 ──
  // 判斷「這格旁白生成好了沒」一律看 narrationUrl，不要看 narrationAssetId：
  // scenes.listByProject 的投影只有 narrationUrl（narrationAssets join 已濾軟刪），沒有 narrationAssetId。
  // 型別上它是 optional 所以不會被 tsc 擋下，錯用只會安靜地永遠判為「沒有旁白」。
  const voicePending = list.filter((s) => (s.voiceover ?? "").trim() !== "" && !s.narrationUrl).length;
  const unapproved = statusCounts.draft + statusCounts.needs_work;
  const allApproved = list.length > 0 && statusCounts.approved === list.length;
  const currentStage: StageKey =
    list.length === 0 ? "board"
    : statusCounts.missing > 0 ? "asset"
    : voicePending > 0 ? "voice"
    : !allApproved ? "review"
    : "deliver";
  const stageDone: Record<StageKey, boolean> = {
    board: list.length > 0,
    asset: list.length > 0 && statusCounts.missing === 0,
    voice: list.length > 0 && statusCounts.missing === 0 && voicePending === 0,
    review: allApproved,
    deliver: false, // 打包沒有「完成」狀態——隨時可以再打包
  };
  /** 依當前階段給一句「下一步」與（可選的）一鍵切到對應篩選 */
  const stageHint = (): { text: string; filter?: SceneFilter } => {
    switch (currentStage) {
      case "board":
        return { text: "還沒有分鏡——請上方 AI 創作中心「拆分鏡」，或在生成紀錄按「＋加入分鏡」。" };
      case "asset":
        return { text: `還有 ${statusCounts.missing} 鏡沒有畫面——按該格「生成這一格」快速出圖，或點縮圖開單格工作室細修。`, filter: "missing" };
      case "voice":
        return { text: `有 ${voicePending} 鏡已填配音詞、還沒生成旁白——點該格縮圖開單格工作室的「配音」分頁。不配旁白也可以先送審。` };
      case "review":
        if (unapproved === 0 && statusCounts.pending > 0) {
          return isLeader
            ? { text: `有 ${statusCounts.pending} 鏡等你裁決——按「通過」或「退回」。`, filter: "pending" }
            : { text: `已送審 ${statusCounts.pending} 鏡，等組長裁決；通過後就能打包交付。` };
        }
        return {
          text: `畫面齊了——逐格按「送審」${statusCounts.needs_work > 0 ? `（${statusCounts.needs_work} 鏡被退回，先照理由修好再重送）` : ""}${statusCounts.pending > 0 ? `；另有 ${statusCounts.pending} 鏡審核中` : ""}，全部通過就能打包交付。`,
          filter: statusCounts.needs_work > 0 ? "needs_work" : undefined,
        };
      case "deliver":
        return { text: `全部 ${list.length} 鏡已通過——到下方「交付」打包帶走。` };
    }
  };

  const [showPreview, setShowPreview] = useState(false);
  // 單格工作室（全螢幕）：哪一格被拉出來修。與粗剪預覽一樣掛在分鏡卡層級，不掛在分鏡列內
  // （`.gen-row` 的 content-visibility 會成為 fixed 的包含區塊）。檢視者也能開，內部依 canEdit 唯讀。
  const [studioScene, setStudioScene] = useState<{ id: string; number: number } | null>(null);
  // 目標剪輯軟體（決定「進階單檔」拿哪些檔）；預設剪映——組內主力剪輯軟體；記住上次選擇
  const [editTarget, setEditTargetState] = useState<EditTargetKey>(() => {
    try {
      const saved = window.localStorage.getItem(EDIT_TARGET_LS_KEY);
      return saved && EDIT_TARGETS.some((t) => t.key === saved) ? (saved as EditTargetKey) : "capcut";
    } catch {
      return "capcut";
    }
  });
  const setEditTarget = (next: EditTargetKey) => {
    setEditTargetState(next);
    try { window.localStorage.setItem(EDIT_TARGET_LS_KEY, next); } catch { /* 持久化只是加分 */ }
  };
  const target = EDIT_TARGETS.find((t) => t.key === editTarget) ?? EDIT_TARGETS[0];
  // 快速出圖模型：跟著單格工作室「重畫這格」上次選的（同一把 localStorage 鑰匙）；失效 id 回退預設。
  // 工作室關閉時重讀——在工作室換過模型，列表的「生成這一格」立即跟上。
  const readGenModel = () => {
    try {
      const saved = window.localStorage.getItem(`aios.scenegen.${projectId}`);
      return saved && SCENE_GEN_MODELS.some((m) => m.id === saved) ? saved : DEFAULT_MODEL;
    } catch {
      return DEFAULT_MODEL;
    }
  };
  const [genModelId, setGenModelId] = useState<string>(readGenModel);

  const hint = stageHint();

  return (
    <Card as="section" data-fb="分鏡與交付">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>分鏡・交付<HelpTip text="把成品排成一支片的順序：補畫面→配音→送審，全部通過後在下方「交付」打包。細修單格請點縮圖開單格工作室。" /></h2>
        {list.length > 0 && (
          <span className="mono" style={{ fontSize: 13, color: "var(--primary-ink)" }}>共 {list.length} 鏡・約 {totalSec} 秒</span>
        )}
      </div>
      {actionError && <p className="error" role="alert">操作失敗：{actionError.message}</p>}
      {/* 查詢失敗不能偽裝成空清單／裁決鈕消失——分開 scenes 與 approvals 錯誤並給重試 */}
      {scenes.isError && (
        <p className="error" role="alert" style={{ marginTop: 8 }}>
          分鏡清單暫時載入不了（不是資料不見了）——
          <Button variant="ghost" size="sm" style={{ marginLeft: "var(--sp-4)" }} onClick={() => scenes.refetch()}>
            再試一次
          </Button>
        </p>
      )}
      {approvals.isError && (
        <p className="error" role="alert" style={{ marginTop: 8 }}>
          審批狀態暫時載入不了（通過／退回鈕可能暫時看不到）——
          <Button variant="ghost" size="sm" style={{ marginLeft: "var(--sp-4)" }} onClick={() => approvals.refetch()}>
            再試一次
          </Button>
        </p>
      )}
      {/* ── C 流程引導：五階段一條線＋「下一步」一句話，回答「我現在該做什麼」 ── */}
      {!scenes.isLoading && !scenes.isError && (
        <div className="scene-pipeline" role="group" aria-label="製作流程進度">
          <ol className="scene-pipeline__steps">
            {PIPELINE_STAGES.map((stage, idx) => (
              <li
                key={stage.key}
                className={`scene-pipeline__step${stageDone[stage.key] ? " is-done" : ""}${currentStage === stage.key ? " is-current" : ""}`}
                aria-current={currentStage === stage.key ? "step" : undefined}
              >
                <span className="scene-pipeline__num" aria-hidden="true">
                  {stageDone[stage.key] ? <Icon name="Check" size={11} /> : idx + 1}
                </span>
                {stage.label}
              </li>
            ))}
          </ol>
          <div className="scene-pipeline__hint">
            <Hint as="span" layer="always">{hint.text}</Hint>
            {hint.filter && list.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => { setSceneFilter(hint.filter!); setSceneListExpanded(true); }}>
                只看這些
              </Button>
            )}
          </div>
        </div>
      )}
      {!scenes.isError && list.length > 0 && (
        <div className="scene-overview" aria-label="分鏡狀態總覽">
          <div
            className="scene-overview__rail"
            role="img"
            aria-label={`草稿 ${statusCounts.draft}、待審 ${statusCounts.pending}、需修改 ${statusCounts.needs_work}、已通過 ${statusCounts.approved}`}
          >
            {statusCounts.draft > 0 && <span className="draft" style={{ width: `${(statusCounts.draft / list.length) * 100}%` }} />}
            {statusCounts.pending > 0 && <span className="review" style={{ width: `${(statusCounts.pending / list.length) * 100}%` }} />}
            {statusCounts.needs_work > 0 && <span className="revision" style={{ width: `${(statusCounts.needs_work / list.length) * 100}%` }} />}
            {statusCounts.approved > 0 && <span className="approved" style={{ width: `${(statusCounts.approved / list.length) * 100}%` }} />}
          </div>
          <div className="scene-overview__controls" role="group" aria-label="篩選分鏡">
            {sceneFilters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className={`scene-filter${sceneFilter === filter.id ? " is-active" : ""}`}
                aria-pressed={sceneFilter === filter.id}
                onClick={() => {
                  setSceneFilter(filter.id);
                  if (filter.id !== "all") setSceneListExpanded(true);
                }}
              >
                {filter.label} <b>{filter.count}</b>
              </button>
            ))}
          </div>
        </div>
      )}
      {scenes.isLoading ? (
        <div aria-hidden="true">
          {[0, 1].map((k) => (
            <div key={k} className="gen-row">
              <Skeleton className="gen-thumb" />
              <div>
                <Skeleton style={{ height: 14, width: k === 0 ? "70%" : "58%", marginBottom: 8 }} />
                <Skeleton style={{ height: 11, width: "42%" }} />
              </div>
              <Skeleton style={{ height: 28, width: 64, borderRadius: 999 }} />
            </div>
          ))}
        </div>
      ) : scenes.isError ? null : list.length === 0 ? (
        <Hint layer="always">還沒有分鏡——生成完成後按「＋加入分鏡」，排好順序就能打包交付。</Hint>
      ) : (
        <>
          {filteredSceneEntries.length === 0 ? (
            <EmptyState icon={<Icon name="Film" />} title={<>這個狀態目前沒有分鏡</>} description={<>切回「全部」查看完整順序，或選其他狀態繼續處理。</>} className="scene-filter-empty" />
          ) : (
            <div className={`scene-list-rows${sceneListExpanded || sceneFilter !== "all" ? " is-expanded" : ""}`}>
              {filteredSceneEntries.map(({ scene: s, index: i }, visibleIndex) => (
                <SceneRow
                  key={s.id}
                  s={s}
                  i={i}
                  total={list.length}
                  onOpenStudio={() => setStudioScene({ id: s.id, number: i + 1 })}
                  rowClassName={sceneFilter === "all" && visibleIndex >= 4 ? "is-mobile-overflow" : undefined}
                  isLeader={isLeader}
                  canEdit={canEdit}
                  meLoading={me.isLoading}
                  genModelId={genModelId}
                  projectId={projectId}
                  charIds={charIds}
                  sceneIds={sceneIds}
                  propIds={propIds}
                  invalidate={invalidate}
                  move={move}
                  remove={remove}
                  submitApproval={submitApproval}
                  decide={decide}
                  pending={pendingOf(s.id)}
                  rejectReason={rejectReasonOf(s.id)}
                  isSeriesEpisode={isSeriesEpisode}
                />
              ))}
            </div>
          )}
          {sceneFilter === "all" && list.length > 4 && (
            <button
              type="button"
              className="scene-mobile-disclosure"
              aria-expanded={sceneListExpanded}
              onClick={() => setSceneListExpanded((value) => !value)}
            >
              <Icon name={sceneListExpanded ? "ChevronUp" : "ChevronDown"} size={15} />
              {sceneListExpanded ? "手機版先收起完整分鏡" : `再顯示 ${list.length - 4} 鏡`}
            </button>
          )}
          {/* ── B 交付中心：先講就緒度，再給一顆主 CTA；剪輯師的單檔收進「進階」摺疊 ── */}
          <section className="scene-deliver" aria-label="交付">
            <div className="scene-deliver__head">
              <h3 style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--fs-15)" }}>
                <Icon name="Package" size={16} /> 交付
              </h3>
              {allApproved ? (
                <Meta role="status" style={{ color: "var(--success-ink)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Icon name="Check" size={13} /> 全部 {list.length} 鏡已通過審核，可以打包交付
                </Meta>
              ) : (
                <Meta role="status">
                  已通過 {statusCounts.approved}／{list.length} 鏡
                  {(() => {
                    const parts = [
                      statusCounts.missing > 0 ? `${statusCounts.missing} 鏡無畫面` : null,
                      statusCounts.draft > 0 ? `${statusCounts.draft} 鏡未送審` : null,
                      statusCounts.pending > 0 ? `${statusCounts.pending} 鏡待審` : null,
                      statusCounts.needs_work > 0 ? `${statusCounts.needs_work} 鏡需修改` : null,
                    ].filter(Boolean);
                    return parts.length > 0 ? `——${parts.join("、")}` : "";
                  })()}
                </Meta>
              )}
            </div>
            <div className="scene-deliver__actions">
              {/* QA-005：非同步 job 版打包——就地顯示進度/取消/完成下載，不再是看似卡死的同步下載 */}
              <ExportJobButton projectId={projectId} />
              <button
                data-fb="粗剪預覽"
                style={{ padding: "10px 18px", fontSize: "var(--fs-14)", borderRadius: "var(--r-12)" }}
                aria-expanded={showPreview}
                title="打包前先把分鏡依順序連播一次，看整支片的節奏"
                onClick={() => setShowPreview((v) => !v)}
              >
                {showPreview ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Icon name="ChevronDown" /> 收合粗剪預覽
                  </span>
                ) : (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Icon name="Play" size={14} /> 粗剪預覽
                  </span>
                )}
              </button>
            </div>
            <Hint style={{ margin: "6px 0 0" }}>
              zip 內含全部素材、腳本鏡頭表與「媒體連結版」時間軸（交付/時間軸.fcpxml・Premiere時間軸.xml・字幕.srt・剪輯表.edl）——
              解壓後匯入一個檔，粗剪含旁白自動排好；大專案打包需要一點時間
            </Hint>
            <details className="scene-deliver__advanced">
              <summary>進階：只要單檔（給剪輯師的時間軸／字幕／草稿包）</summary>
              <Hint style={{ margin: "8px 0" }}>
                這裡的單檔是「骨架版」時間軸——只有分鏡順序與秒數、不掛媒體，適合只要對位參考；
                要含媒體的完整時間軸請直接用上面的交付包。
              </Hint>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                {/* 單檔時間軸/字幕下載（需求 #8＋直連強化）：依目標軟體列出可直接匯入的檔，各一顆下載鈕 */}
                <label style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--fs-12)", whiteSpace: "nowrap" }}>
                  目標剪輯軟體
                  <select
                    value={editTarget}
                    aria-label="目標剪輯軟體"
                    onChange={(e) => setEditTarget(e.target.value as EditTargetKey)}
                    style={{ width: "auto", fontSize: "var(--fs-13)", padding: "6px 10px" }}
                  >
                    {EDIT_TARGETS.map((t) => (
                      <option key={t.key} value={t.key}>{t.label}</option>
                    ))}
                  </select>
                </label>
                {target.files.map((f) => (
                  <a
                    key={f.format}
                    href={`/api/export/${projectId}/timeline?format=${f.format}`}
                    download
                    className="btn-tonal"
                    title={`下載 ${target.label} 可匯入的${f.name}單檔（時間碼依分鏡秒數累計）`}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: "var(--fs-13)", borderRadius: "var(--r-8)", textDecoration: "none", borderStyle: "solid", borderWidth: 1, transition: "background var(--dur-base), border-color var(--dur-base)" }}
                  >
                    <Icon name="Download" /> {f.name}（{f.ext}）
                  </a>
                ))}
                {"draft" in target && target.draft && (
                  <a
                    href={`/api/export/${projectId}/jianying`}
                    download
                    className="btn-tonal"
                    title="實驗性：剪映/CapCut 草稿資料夾（含素材與排好的時間軸）。解壓到剪映草稿目錄後打開剪映即可直接剪——目錄位置與相容版本見包內「安裝說明.txt」。"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: "var(--fs-13)", borderRadius: "var(--r-8)", textDecoration: "none", borderStyle: "dashed", borderWidth: 1, transition: "background var(--dur-base), border-color var(--dur-base)" }}
                  >
                    <Icon name="Download" /> 剪映草稿包（實驗）
                  </a>
                )}
              </div>
            </details>
          </section>
          {showPreview && (
            <div style={{ marginTop: 14 }}>
              {/* 傳 onClose：StoryboardPlayer 是全螢幕 modal，沒接 onClose 的話 ✕鈕與 Esc 都失效→使用者被困需重載 */}
              <StoryboardPlayer scenes={list} onClose={() => setShowPreview(false)} />
            </div>
          )}
          {studioScene && (
            <SceneStudio
              key={studioScene.id}
              sceneId={studioScene.id}
              projectId={projectId}
              sceneNumber={studioScene.number}
              canEdit={canEdit}
              charIds={charIds}
              sceneIds={sceneIds}
              onClose={() => {
                setStudioScene(null);
                // 在工作室換過「重畫」模型的話，列表的「生成這一格」跟著用（同一把鑰匙）
                setGenModelId(readGenModel());
              }}
              onChanged={invalidate}
              /* 就地裁決：查 list（不是 filtered——切到別的篩選不該讓開著的工作室失去狀態），
                 且每次 render 重算，裁決後 invalidate 會讓這裡自然更新、按鈕自己收起來 */
              isLeader={isLeader}
              meLoading={me.isLoading}
              sceneStatus={list.find((s) => s.id === studioScene.id)?.status}
              pendingApprovalId={pendingOf(studioScene.id)?.id}
              rejectReason={rejectReasonOf(studioScene.id)}
              approvalsError={approvals.isError}
              deciding={decide.isPending}
              onDecide={(decision, reason) => {
                const approvalId = pendingOf(studioScene.id)?.id;
                if (approvalId) decide.mutate({ approvalId, decision, reason });
              }}
            />
          )}
        </>
      )}
    </Card>
  );
}
