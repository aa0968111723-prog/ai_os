import { useEffect, useRef, useState, type CSSProperties } from "react";
import { trpc } from "../api";
import { getModel } from "@shared/models";
import { StoryboardPlayer } from "./StoryboardPlayer";
import { Icon } from "./Icon";

const SCENE_STATUS: Record<string, { label: string; cls: string }> = {
  todo: { label: "草稿", cls: "queued" },
  review: { label: "草稿", cls: "queued" },
  pending: { label: "待審", cls: "running" },
  needs_work: { label: "需修改", cls: "failed" },
  approved: { label: "已通過", cls: "done" },
};

// 日常主力：便宜快、剪輯人員逐格試圖首選。要換模型可到上方生成台挑（那裡有完整模型指南）。
const DEFAULT_MODEL = "fal-ai/fast-lightning-sdxl";

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
  meLoading,
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
  meLoading: boolean;
  onUsePrompt?: (prompt: string) => void;
  invalidate: () => void;
  move: ReturnType<typeof trpc.scenes.move.useMutation>;
  remove: ReturnType<typeof trpc.scenes.remove.useMutation>;
  submitApproval: ReturnType<typeof trpc.approvals.submit.useMutation>;
  decide: ReturnType<typeof trpc.approvals.decide.useMutation>;
  pending: { id: string } | undefined;
}) {
  // 每格自持 update／generateInto／generateVoiceover，pending 與錯誤才不會互相污染（一格存檔不會鎖住別格）
  const update = trpc.scenes.update.useMutation({ onSuccess: invalidate });
  const generate = trpc.scenes.generateInto.useMutation({ onSuccess: invalidate });
  const generateVoiceover = trpc.scenes.generateVoiceover.useMutation({ onSuccess: invalidate });

  const isGenerating = s.pendingGenStatus === "queued" || s.pendingGenStatus === "running";
  // 配音生成中：後端背景 runner 完成後會回填 narrationAssetId，10 秒輪詢自動刷新
  const isVoicing = s.pendingVoiceStatus === "queued" || s.pendingVoiceStatus === "running";
  const hasVoiceover = (s.voiceover ?? "").trim() !== "";
  const rowError = update.error ?? generate.error ?? generateVoiceover.error;

  return (
    <div className="gen-row" data-fb="分鏡格">
      {s.assetUrl ? (
        s.assetKind === "video" ? (
          <video className="gen-thumb" src={s.assetUrl} controls muted preload="metadata" />
        ) : (
          <img className="gen-thumb" src={s.assetUrl} alt={s.title} />
        )
      ) : (
        <div className="gen-thumb" style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "var(--soft)" }}>
          {isGenerating ? "…" : "＋"}
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="mono" style={{ color: "var(--primary)", flexShrink: 0 }}>{i + 1}</span>
          <InlineEdit
            value={s.title}
            kind="text"
            pending={update.isPending}
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
              pending={update.isPending}
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
        </div>

        {/* 配音詞：每格皆可編輯（含空白格補詞），失焦即存 */}
        <div style={{ marginTop: 6 }}>
          <InlineEdit
            value={s.voiceover ?? ""}
            kind="textarea"
            pending={update.isPending}
            ariaLabel={`第 ${i + 1} 鏡配音詞`}
            placeholder="🎙 配音詞（可留白）"
            onCommit={(v) => update.mutate({ sceneId: s.id, voiceover: String(v) })}
          />
          {/* 旁白配音：有配音詞才給生成鈕（中文 TTS 走後端預設，不必前端帶模型）；完成後就地試聽＋下載 */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            {hasVoiceover ? (
              <button
                style={{ padding: "4px 12px", fontSize: 12 }}
                disabled={generateVoiceover.isPending || isVoicing}
                title="用這一格的配音詞生成中文旁白，完成後自動出現試聽"
                onClick={() => generateVoiceover.mutate({ sceneId: s.id })}
              >
                {isVoicing ? (
                  "配音生成中…"
                ) : s.narrationUrl ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Icon name="RotateCw" /> 重生配音
                  </span>
                ) : (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Icon name="Mic" /> 生成配音
                  </span>
                )}
              </button>
            ) : (
              <span className="hint">先填配音詞才能生成旁白</span>
            )}
          </div>
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
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", fontSize: 12, borderRadius: 8, textDecoration: "none", border: "1px solid var(--soft)", color: "var(--fg)" }}
              >
                <Icon name="Download" /> 下載旁白
              </a>
            </div>
          )}
        </div>

        {rowError && <p className="error">存檔／生成失敗：{rowError.message}</p>}

        {/* 建議提示詞：拆分鏡草稿（有 prompt、還沒素材）可一鍵帶回生成台 */}
        {s.prompt && !s.assetId && (
          <div style={{ fontSize: 12, marginTop: 6, background: "var(--card2)", borderRadius: 8, padding: "6px 10px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
              <Icon name="Clapperboard" size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{s.prompt}</span>
            </div>
            {onUsePrompt && (
              <button style={{ padding: "2px 10px", fontSize: 11, marginTop: 5 }} onClick={() => onUsePrompt(s.prompt!)}>
                用此提示詞生成
              </button>
            )}
          </div>
        )}

        {/* 就地生成／重生＋單檔下載 */}
        <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
          {s.prompt ? (
            <button
              className="primary"
              style={{ padding: "4px 12px", fontSize: 12 }}
              disabled={generate.isPending || isGenerating}
              title="用這一格的提示詞就地生成，完成後自動回填縮圖"
              onClick={() => generate.mutate({ sceneId: s.id, modelId: DEFAULT_MODEL })}
            >
              {isGenerating ? (
                "生成中…"
              ) : s.assetId ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Icon name="RotateCw" /> 重生這一格
                </span>
              ) : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Icon name="Sparkles" /> 生成這一格
                </span>
              )}
            </button>
          ) : (
            !s.assetId && <span className="hint">先用上方「AI 拆分鏡」給這格提示詞，就能就地生成</span>
          )}
          {s.assetUrl && (
            <a
              // 用同源 /api/assets/:id/file 才能讓 download 屬性生效——直接用 assetUrl 對「尚未落地/落地失敗」
              // 的成品會是跨源 fal 網址，瀏覽器會忽略 download 改成導航離開 SPA。無 assetId 時退回原網址。
              href={s.assetId ? `/api/assets/${s.assetId}/file` : s.assetUrl}
              download
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", fontSize: 12, borderRadius: 8, textDecoration: "none", border: "1px solid var(--soft)", color: "var(--fg)" }}
            >
              <Icon name="Download" /> 下載
            </a>
          )}
        </div>
        {s.prompt && (
          <div className="hint" style={{ marginTop: 3 }}>模型：{getModel(DEFAULT_MODEL)?.label ?? DEFAULT_MODEL}（日常主力，可到生成台換）</div>
        )}

        {!meLoading && (
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            {/* 已通過也能重送：後端本就版本化（重送＝新版本、舊 pending 作廢），換素材後不必刪掉重建 */}
            {(s.status === "todo" || s.status === "review" || s.status === "needs_work" || s.status === "approved") && (
              <button style={{ padding: "3px 12px", fontSize: 12 }} disabled={submitApproval.isPending}
                onClick={() => submitApproval.mutate({ sceneId: s.id })}>
                {s.status === "approved" ? "重送新版審核" : "送審"}
              </button>
            )}
            {isLeader && s.status === "pending" && pending && (
              <>
                <button style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 12px", fontSize: 12, color: "var(--success)", borderColor: "var(--success)" }}
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ approvalId: pending.id, decision: "approved" })}>
                  <Icon name="Check" /> 通過
                </button>
                <button style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 12px", fontSize: 12, color: "var(--danger)", borderColor: "var(--danger)" }}
                  disabled={decide.isPending}
                  onClick={() => {
                    const reason = window.prompt("退回理由（會通知提交人）：");
                    if (!reason?.trim()) {
                      window.alert("已取消退回（退回必須附理由）");
                      return;
                    }
                    decide.mutate({ approvalId: pending.id, decision: "needs_work", reason: reason.trim() });
                  }}>
                  <Icon name="Undo2" /> 退回
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button style={{ display: "inline-flex", alignItems: "center", padding: "4px 10px" }} disabled={i === 0 || move.isPending} aria-label="上移" onClick={() => move.mutate({ sceneId: s.id, direction: "up" })}><Icon name="ChevronUp" size={16} /></button>
        <button style={{ display: "inline-flex", alignItems: "center", padding: "4px 10px" }} disabled={i === total - 1 || move.isPending} aria-label="下移" onClick={() => move.mutate({ sceneId: s.id, direction: "down" })}><Icon name="ChevronDown" size={16} /></button>
        <button style={{ display: "inline-flex", alignItems: "center", padding: "4px 10px", color: "var(--danger)" }} disabled={remove.isPending} aria-label="刪除"
          onClick={() => window.confirm(`刪除分鏡「${s.title}」？`) && remove.mutate({ sceneId: s.id })}><Icon name="X" size={16} /></button>
      </div>
    </div>
  );
}

/** 分鏡與交付：可編輯＋就地生成/重生＋單檔下載＋粗剪預覽＋送審/裁決（三態機）＋打包下載 */
export function SceneList({ projectId, isLeader, onUsePrompt }: { projectId: string; isLeader: boolean; onUsePrompt?: (prompt: string) => void }) {
  const utils = trpc.useUtils();
  // 與 App 端同 key 吃快取：只為了「auth.me 還沒回來前先不畫操作鈕」，避免組長進頁時按鈕先缺後補的閃爍
  const me = trpc.auth.me.useQuery();
  const scenes = trpc.scenes.listByProject.useQuery({ projectId }, { refetchInterval: 10_000 });
  const approvals = trpc.approvals.listByProject.useQuery({ projectId }, { refetchInterval: 10_000 });
  const invalidate = () => {
    utils.scenes.listByProject.invalidate({ projectId });
    utils.approvals.listByProject.invalidate({ projectId });
    utils.messages.list.invalidate({ projectId });
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

  return (
    <section className="card" data-fb="分鏡與交付">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>分鏡・交付</h2>
        {list.length > 0 && (
          <span className="mono" style={{ fontSize: 13, color: "var(--primary)" }}>共 {list.length} 鏡・約 {totalSec} 秒</span>
        )}
      </div>
      {actionError && <p className="error">操作失敗：{actionError.message}</p>}
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
              meLoading={me.isLoading}
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
                display: "inline-block", padding: "10px 18px", borderRadius: 10, textDecoration: "none",
                background: "var(--primary)", color: "var(--primary-fg)", boxShadow: "var(--shadow)", fontSize: 14,
              }}
            >
              打包下載交付包（.zip）
            </a>
            <button
              data-fb="粗剪預覽"
              style={{ padding: "10px 18px", fontSize: 14, borderRadius: 10 }}
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
