import { useEffect, useRef, useState, type CSSProperties } from "react";
import { trpc } from "../api";
import { getModel, MODELS, tierLabel, estimatePoints } from "@shared/models";
import { StoryboardPlayer } from "./StoryboardPlayer";
import { Icon } from "./Icon";
import { ConfirmButton, HelpTip } from "./interactions";
import { discussInMessages } from "../discuss";

const SCENE_STATUS: Record<string, { label: string; cls: string }> = {
  todo: { label: "草稿", cls: "queued" },
  review: { label: "草稿", cls: "queued" },
  pending: { label: "待審", cls: "running" },
  needs_work: { label: "需修改", cls: "failed" },
  approved: { label: "已通過", cls: "done" },
};

// 逐格生成的預設模型：便宜快、剪輯人員逐格試圖首選；深度優化後可在分鏡卡就地換文生圖模型。
const DEFAULT_MODEL = "fal-ai/fast-lightning-sdxl";
// 逐格可選的文生圖模型（不需來源素材的 text-to-image；與生成台同一份目錄）
const SCENE_GEN_MODELS = MODELS.filter((m) => m.category === "text-to-image" && !m.needs);
// 逐格配音的後端預設 TTS（scenes.generateVoiceover 未帶 modelId 時用它）——前端只拿來顯示預估點數
const DEFAULT_TTS_MODEL = "fal-ai/kokoro/mandarin-chinese";

// 目標剪輯軟體 → 可直接匯入的時間軸/字幕格式（需求 #8）：剪映/CapCut/Premiere 吃 SRT、
// Final Cut Pro（含剪映專業版）吃 FCPXML、DaVinci Resolve 吃 EDL。
const EDIT_TARGETS = [
  { key: "capcut", label: "剪映 / CapCut", format: "srt" },
  { key: "premiere", label: "Premiere", format: "srt" },
  { key: "fcp", label: "Final Cut Pro", format: "fcpxml" },
  { key: "resolve", label: "DaVinci Resolve", format: "edl" },
] as const;
type EditTargetKey = (typeof EDIT_TARGETS)[number]["key"];

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
  // 平行後端補上：該格若有進行中的就地生成，回 queued/running；無則 null。
  pendingGenStatus?: string | null;
  // 旁白配音（後端補上）：已落地旁白音檔的 asset id／可播 url，與進行中配音生成狀態。
  narrationAssetId?: string | null;
  narrationUrl?: string | null;
  pendingVoiceStatus?: string | null;
};

/**
 * 行內可編輯欄位：草稿即所見。
 * - 文字/數字：Enter 或失焦送出，Esc 還原；數字夾在 1–60。
 * - 多行（配音詞）：失焦送出、Esc 還原，Enter 保留換行（唸稿常要斷行）。
 * committedRef 去重：Enter 觸發送出後緊接的 blur 不會重打一次 API。
 * 未聚焦時才跟隨伺服器刷新，避免 10 秒輪詢把使用者正在打的字洗掉。
 */
function InlineEdit({
  value,
  kind,
  onCommit,
  pending,
  ariaLabel,
  placeholder,
  style,
}: {
  value: string | number;
  kind: "text" | "number" | "textarea";
  onCommit: (next: string | number) => void;
  pending: boolean;
  ariaLabel: string;
  placeholder?: string;
  style?: CSSProperties;
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
    const trimmed = kind === "text" ? draft.trim() : draft;
    if (kind === "text" && trimmed === "") {
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

  const commonProps = {
    value: draft,
    disabled: pending,
    "aria-label": ariaLabel,
    placeholder,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      commit();
    },
  };

  if (kind === "textarea") {
    return (
      <textarea
        {...commonProps}
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            revert();
            e.currentTarget.blur();
          }
        }}
        style={{ minHeight: 44, fontSize: 12, padding: "5px 8px", ...style }}
      />
    );
  }

  return (
    <input
      {...commonProps}
      type={kind === "number" ? "number" : "text"}
      min={kind === "number" ? 1 : undefined}
      max={kind === "number" ? 60 : undefined}
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

/** 單格分鏡：縮圖、可編輯資訊、就地生成/重生、單檔下載、送審/裁決三態、排序、刪除 */
function SceneRow({
  s,
  i,
  total,
  isLeader,
  canEdit,
  meLoading,
  genModelId,
  onUsePrompt,
  invalidate,
  move,
  remove,
  submitApproval,
  decide,
  pending,
}: {
  s: Scene;
  i: number;
  total: number;
  isLeader: boolean;
  canEdit: boolean;
  meLoading: boolean;
  /** 逐格生成用的文生圖模型（分鏡卡工具列可換；預設 SDXL Lightning） */
  genModelId: string;
  onUsePrompt?: (prompt: string) => void;
  invalidate: () => void;
  move: ReturnType<typeof trpc.scenes.move.useMutation>;
  remove: ReturnType<typeof trpc.scenes.remove.useMutation>;
  submitApproval: ReturnType<typeof trpc.approvals.submit.useMutation>;
  decide: ReturnType<typeof trpc.approvals.decide.useMutation>;
  pending: { id: string } | undefined;
}) {
  // 每格自持 update／generateInto／generateVoiceover，pending 與錯誤才不會互相污染（一格存檔不會鎖住別格）
  // 行內編輯（標題/秒數/配音詞）失焦即存但原本沒有成功回饋——比照世界觀卡「已儲存 ✓」短暫顯示 2 秒
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
  // 冪等鍵（QA-007）：同一格「還沒成功」的生成/配音重試沿用同鍵——timeout 重按不重複扣點；成功才換新鍵
  const genRequestId = useRef<string>(crypto.randomUUID());
  const voiceRequestId = useRef<string>(crypto.randomUUID());
  const generate = trpc.scenes.generateInto.useMutation({
    onSuccess: () => { genRequestId.current = crypto.randomUUID(); invalidate(); },
  });
  const generateVoiceover = trpc.scenes.generateVoiceover.useMutation({
    onSuccess: () => { voiceRequestId.current = crypto.randomUUID(); invalidate(); },
  });

  const isGenerating = s.pendingGenStatus === "queued" || s.pendingGenStatus === "running";
  // 配音生成中：後端背景 runner 完成後會回填 narrationAssetId，10 秒輪詢自動刷新
  const isVoicing = s.pendingVoiceStatus === "queued" || s.pendingVoiceStatus === "running";
  const hasVoiceover = (s.voiceover ?? "").trim() !== "";
  const rowError = update.error ?? generate.error ?? generateVoiceover.error;
  // 逐格生成／配音的預估點數（HelpPage 承諾「送出前先看預估點數，點頭才扣」——這裡兌現）
  const genModel = getModel(genModelId) ?? getModel(DEFAULT_MODEL);
  const genPoints = genModel?.points;
  // 配音走按字計費的中文 TTS：估點依「這一格旁白文字」長度即時算，與後端扣點同一函式——顯示＝扣點
  const ttsModel = getModel(DEFAULT_TTS_MODEL);
  const ttsPoints = ttsModel ? estimatePoints(ttsModel, { promptChars: (s.voiceover ?? "").length }) : undefined;

  return (
    <div className="gen-row" data-fb="分鏡格" id={`scene-${s.id}`}>
      {s.assetUrl ? (
        s.assetKind === "video" ? (
          <video className="gen-thumb" src={s.assetUrl} muted preload="metadata" />
        ) : (
          <img className="gen-thumb" src={s.assetUrl} alt={s.title} />
        )
      ) : (
        <div className="gen-thumb" style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "var(--soft)" }}>
          {isGenerating ? <Icon name="Loader" className="spin" size={20} /> : <Icon name="Plus" size={20} />}
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="mono" style={{ color: "var(--primary-ink)", flexShrink: 0 }}>{i + 1}</span>
          <InlineEdit
            value={s.title}
            kind="text"
            pending={update.isPending || !canEdit}
            ariaLabel={`第 ${i + 1} 鏡標題`}
            placeholder="鏡頭標題"
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
          <span>・{s.assetKind ?? "無素材"}</span>
          <span className={`pill ${SCENE_STATUS[s.status]?.cls ?? "queued"}`}>
            {SCENE_STATUS[s.status]?.label ?? s.status}
          </span>
          {isGenerating && <span className="pill running">生成中…</span>}
          {update.isPending ? (
            <span className="hint">儲存中…</span>
          ) : savedFlash ? (
            <span className="hint" role="status" style={{ color: "var(--success-ink)" }}>
              已儲存 <Icon name="Check" size={12} style={{ verticalAlign: "-1px" }} />
            </span>
          ) : null}
        </div>

        {/* 配音詞：每格皆可編輯（含空白格補詞），失焦即存 */}
        <div style={{ marginTop: 6 }}>
          <InlineEdit
            value={s.voiceover ?? ""}
            kind="textarea"
            pending={update.isPending || !canEdit}
            ariaLabel={`第 ${i + 1} 鏡配音詞`}
            placeholder="配音詞（可留白）"
            onCommit={(v) => update.mutate({ sceneId: s.id, voiceover: String(v) })}
          />
          {/* 旁白配音：有配音詞才給生成鈕（中文 TTS 走後端預設，不必前端帶模型）；完成後就地試聽＋下載。
              扣點前先確認（顯示預估點數，兌現 HelpPage「點頭才扣」承諾）；檢視者不顯示（2.3 唯讀） */}
          {canEdit && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              {hasVoiceover ? (
                isVoicing || generateVoiceover.isPending ? (
                  <button className="btn-sm" disabled>配音生成中…</button>
                ) : (
                  <ConfirmButton
                    triggerClassName="btn-sm"
                    triggerTitle="用這一格的配音詞生成中文旁白，完成後自動出現試聽"
                    message={`即將生成旁白配音（${getModel(DEFAULT_TTS_MODEL)?.label ?? "中文 TTS"}${ttsPoints != null ? `，約 −${ttsPoints} 點` : ""}）；失敗自動退點`}
                    confirmLabel="確認生成"
                    onConfirm={() => generateVoiceover.mutate({ sceneId: s.id, clientRequestId: voiceRequestId.current })}
                  >
                    {s.narrationUrl ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <Icon name="RotateCw" /> 重生配音{ttsPoints != null ? `（約 −${ttsPoints} 點）` : ""}
                      </span>
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <Icon name="Mic" /> 生成配音{ttsPoints != null ? `（約 −${ttsPoints} 點）` : ""}
                      </span>
                    )}
                  </ConfirmButton>
                )
              ) : (
                <span className="hint">先填配音詞才能生成旁白</span>
              )}
            </div>
          )}
          {s.narrationUrl && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <audio
                controls
                preload="none"
                src={s.narrationUrl}
                aria-label={`第 ${i + 1} 鏡旁白試聽`}
                style={{ height: 32, maxWidth: "100%" }}
              />
              <a
                // 同源 /api/assets/:id/file 才能讓 download 生效；只有跨源 url 時退回 url（瀏覽器會改成導航，但仍可另存）
                href={s.narrationAssetId ? `/api/assets/${s.narrationAssetId}/file` : s.narrationUrl}
                download
                className="btn-tonal"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "var(--sp-4) var(--sp-12)", fontSize: "var(--fs-12)", borderRadius: "var(--r-8)", textDecoration: "none", borderStyle: "solid", borderWidth: 1, transition: "background var(--dur-base), border-color var(--dur-base)" }}
              >
                <Icon name="Download" /> 下載旁白
              </a>
            </div>
          )}
        </div>

        {rowError && <p className="error" role="alert">存檔／生成失敗：{rowError.message}</p>}

        {/* 建議提示詞：拆分鏡草稿（有 prompt、還沒素材）可一鍵帶回生成台 */}
        {s.prompt && !s.assetId && (
          <div style={{ fontSize: "var(--fs-12)", marginTop: 6, background: "var(--card2)", borderRadius: "var(--r-8)", padding: "6px 10px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
              <Icon name="Clapperboard" size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{s.prompt}</span>
            </div>
            {onUsePrompt && (
              <button style={{ padding: "2px 10px", fontSize: "var(--fs-11)", marginTop: 5 }} onClick={() => onUsePrompt(s.prompt!)}>
                用此提示詞生成
              </button>
            )}
          </div>
        )}

        {/* 就地生成／重生＋單檔下載。扣點前先確認（顯示預估點數）；檢視者不顯示生成鈕（2.3 唯讀） */}
        <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
          {!canEdit ? null : s.prompt ? (
            isGenerating || generate.isPending ? (
              <button className="primary btn-sm" disabled>生成中…</button>
            ) : (
              <ConfirmButton
                triggerClassName="primary btn-sm"
                triggerTitle="用這一格的提示詞就地生成，完成後自動回填縮圖"
                message={`即將${s.assetId ? "重生" : "生成"}這一格（${genModel?.label ?? genModelId}${genPoints != null ? `，約 −${genPoints} 點` : ""}）；失敗自動退點`}
                confirmLabel="確認生成"
                onConfirm={() => generate.mutate({ sceneId: s.id, modelId: genModel?.id ?? DEFAULT_MODEL, clientRequestId: genRequestId.current })}
              >
                {s.assetId ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Icon name="RotateCw" /> 重生這一格{genPoints != null ? `（約 −${genPoints} 點）` : ""}
                  </span>
                ) : (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Icon name="Sparkles" /> 生成這一格{genPoints != null ? `（約 −${genPoints} 點）` : ""}
                  </span>
                )}
              </ConfirmButton>
            )
          ) : (
            !s.assetId && <span className="hint">先請上方「專案 AI 代理系統」拆分鏡或發想，給這格提示詞就能就地生成</span>
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
        </div>
        {s.prompt && (
          <div className="hint" style={{ marginTop: 3 }}>模型：{genModel?.label ?? genModelId}（可在上方「逐格生成模型」換）</div>
        )}

        {!meLoading && (
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {/* 在留言中討論：對所有人開放（含檢視者——留言是唯讀者的參與出口） */}
            <button
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 12px", fontSize: 12 }}
              title="把這一鏡帶進組內留言討論"
              onClick={() => discussInMessages({ refType: "scene", refId: s.id, title: s.title })}
            >
              <Icon name="MessageCircle" size={13} /> 討論
            </button>
            {/* 已通過也能重送：後端本就版本化（重送＝新版本、舊 pending 作廢），換素材後不必刪掉重建。
                檢視者不顯示（2.3：viewer 不能改分鏡審批狀態，後端 approvals.submit 也已擋） */}
            {canEdit && (s.status === "todo" || s.status === "review" || s.status === "needs_work" || s.status === "approved") && (
              <button style={{ padding: "3px 12px", fontSize: 12 }} disabled={submitApproval.isPending}
                onClick={() => submitApproval.mutate({ sceneId: s.id })}>
                {s.status === "approved" ? "重送新版審核" : "送審"}
              </button>
            )}
            {isLeader && s.status === "pending" && pending && (
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
                  reason={{ label: "退回理由（會通知提交人）", placeholder: "說明需要修改的地方…", required: true }}
                  confirmLabel="退回"
                  onConfirm={(reason) => decide.mutate({ approvalId: pending.id, decision: "needs_work", reason })}
                >
                  <Icon name="Undo2" /> 退回
                </ConfirmButton>
              </>
            )}
          </div>
        )}
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

/** 分鏡與交付：可編輯＋就地生成/重生＋單檔下載＋粗剪預覽＋送審/裁決（三態機）＋打包下載。
 *  canEdit=false（2.3 檢視者）：隱藏所有寫入控制（生成/配音/送審/排序/刪除/行內編輯），瀏覽與下載照常 */
export function SceneList({ projectId, isLeader, canEdit = true, onUsePrompt }: { projectId: string; isLeader: boolean; canEdit?: boolean; onUsePrompt?: (prompt: string) => void }) {
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
  const pendingOf = (sceneId: string) => approvals.data?.find((a) => a.sceneId === sceneId && a.status === "pending");
  // 統一小紅字：這四個共用 mutation 失敗時（送審/裁決/排序/刪除）畫面要有反應。就地編輯/生成的錯誤各格自行顯示。
  const actionError = submitApproval.error ?? decide.error ?? move.error ?? remove.error;

  const list = (scenes.data ?? []) as Scene[];
  const totalSec = list.reduce((sum, s) => sum + s.durationSec, 0);

  const [showPreview, setShowPreview] = useState(false);
  // 目標剪輯軟體（決定「下載時間軸/字幕」拿哪種格式）；預設剪映——組內主力剪輯軟體
  const [editTarget, setEditTarget] = useState<EditTargetKey>("capcut");
  const timelineFormat = EDIT_TARGETS.find((t) => t.key === editTarget)?.format ?? "srt";
  // 逐格生成模型（深度優化：原本寫死 SDXL Lightning）——per 專案記住上次選擇；失效 id 回退預設
  const [genModelId, setGenModelIdState] = useState<string>(() => {
    try {
      const saved = window.localStorage.getItem(`aios.scenegen.${projectId}`);
      return saved && SCENE_GEN_MODELS.some((m) => m.id === saved) ? saved : DEFAULT_MODEL;
    } catch {
      return DEFAULT_MODEL;
    }
  });
  const setGenModelId = (next: string) => {
    setGenModelIdState(next);
    try { window.localStorage.setItem(`aios.scenegen.${projectId}`, next); } catch { /* 持久化只是加分 */ }
  };

  return (
    <section className="card" data-fb="分鏡與交付">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>分鏡・交付<HelpTip text="把成品排成一支片的順序，可送審與打包交付。" /></h2>
        {list.length > 0 && (
          <span className="mono" style={{ fontSize: 13, color: "var(--primary-ink)" }}>共 {list.length} 鏡・約 {totalSec} 秒</span>
        )}
      </div>
      {actionError && <p className="error" role="alert">操作失敗：{actionError.message}</p>}
      {/* 逐格生成模型（深度優化）：分鏡卡就地換文生圖模型，每格「生成這一格/重生」都用它；預估點數即時跟著變 */}
      {canEdit && list.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <label htmlFor={`scene-gen-model-${projectId}`} style={{ margin: 0, fontSize: "var(--fs-12)", whiteSpace: "nowrap" }}>
            逐格生成模型
            <HelpTip text="每一格「生成這一格／重生」用的文生圖模型。便宜的適合快速試構圖，旗艦的適合定稿。" />
          </label>
          <select
            id={`scene-gen-model-${projectId}`}
            value={genModelId}
            onChange={(e) => setGenModelId(e.target.value)}
            style={{ width: "auto", fontSize: "var(--fs-13)", padding: "6px 10px" }}
          >
            {SCENE_GEN_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {tierLabel(m.tier)}・{m.label} — {m.points} 點
              </option>
            ))}
          </select>
        </div>
      )}
      {scenes.isLoading ? (
        <div aria-hidden="true">
          {[0, 1].map((k) => (
            <div key={k} className="gen-row">
              <div className="gen-thumb skeleton" />
              <div>
                <div className="skeleton" style={{ height: 14, width: k === 0 ? "70%" : "58%", marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 11, width: "42%" }} />
              </div>
              <div className="skeleton" style={{ height: 28, width: 64, borderRadius: 999 }} />
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <p className="hint">還沒有分鏡——生成完成後按「＋加入分鏡」，排好順序就能打包交付。</p>
      ) : (
        <>
          {list.map((s, i) => (
            <SceneRow
              key={s.id}
              s={s}
              i={i}
              total={list.length}
              isLeader={isLeader}
              canEdit={canEdit}
              meLoading={me.isLoading}
              genModelId={genModelId}
              onUsePrompt={onUsePrompt}
              invalidate={invalidate}
              move={move}
              remove={remove}
              submitApproval={submitApproval}
              decide={decide}
              pending={pendingOf(s.id)}
            />
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
            <a
              href={`/api/export/${projectId}`}
              download
              style={{
                display: "inline-block", padding: "10px 18px", borderRadius: "var(--r-12)", textDecoration: "none",
                background: "var(--primary-solid)", color: "var(--primary-fg)", boxShadow: "var(--e2)", fontSize: "var(--fs-14)",
              }}
            >
              打包下載交付包（.zip）
            </a>
            {/* 單檔時間軸/字幕下載（需求 #8）：不用整包也能拿到目標剪輯軟體可直接匯入的檔 */}
            <label style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--fs-12)", whiteSpace: "nowrap" }}>
              目標剪輯軟體
              <select
                value={editTarget}
                aria-label="目標剪輯軟體"
                onChange={(e) => setEditTarget(e.target.value as EditTargetKey)}
                style={{ width: "auto", fontSize: "var(--fs-13)", padding: "6px 10px" }}
              >
                {EDIT_TARGETS.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}（.{t.format}）</option>
                ))}
              </select>
            </label>
            <a
              href={`/api/export/${projectId}/timeline?format=${timelineFormat}`}
              download
              className="btn-tonal"
              title="只下載目標剪輯軟體可匯入的時間軸/字幕單檔（時間碼依分鏡秒數累計）"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: "var(--fs-13)", borderRadius: "var(--r-8)", textDecoration: "none", borderStyle: "solid", borderWidth: 1, transition: "background var(--dur-base), border-color var(--dur-base)" }}
            >
              <Icon name="Download" /> 下載時間軸/字幕
            </a>
            <button
              data-fb="粗剪預覽"
              style={{ padding: "10px 18px", fontSize: "var(--fs-14)", borderRadius: "var(--r-12)" }}
              aria-expanded={showPreview}
              onClick={() => setShowPreview((v) => !v)}
            >
              {showPreview ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Icon name="ChevronDown" /> 收合粗剪預覽
                </span>
              ) : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Icon name="ChevronRight" /> 粗剪預覽
                </span>
              )}
            </button>
            <span className="hint">共 {list.length} 鏡・約 {totalSec} 秒｜含素材＋腳本鏡頭表，直接進剪映/Premiere；大專案打包需要一點時間</span>
          </div>
          <p className="hint" style={{ margin: "6px 0 0" }}>zip 交付包內也已附三種格式（交付/字幕.srt・時間軸.fcpxml・剪輯表.edl）</p>
          {showPreview && (
            <div style={{ marginTop: 14 }}>
              {/* 傳 onClose：StoryboardPlayer 是全螢幕 modal，沒接 onClose 的話 ✕鈕與 Esc 都失效→使用者被困需重載 */}
              <StoryboardPlayer scenes={list} onClose={() => setShowPreview(false)} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
