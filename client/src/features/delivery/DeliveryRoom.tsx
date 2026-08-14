/**
 * ④ 成片・交付室（重構需求 §12／§13／§14）。
 *
 * 交付頁先前的問題是它變成「第二套製作流程」——在這裡補畫面、在這裡配音，
 * 於是同一件事有兩個入口、兩套 UI。這一屏只回答三個問題：
 *   1. 整部片做到哪了？   2. 還缺什麼？   3. 點一下能不能直接處理？
 *
 * 「處理」分兩級（§14）：
 *   - 單一軌缺件（配音／音效）→ 就地補，不必離開這一屏；
 *   - 需要真正編輯（改畫面、換版本、調鏡頭）→ 送去單格工作室。
 * 這樣「補畫面」永遠只有一個地方，交付室維持它該有的職責。
 *
 * 完成度與缺漏清單全部來自 shared/shotCompletion 的純函式——
 * 與分鏡卡狀態點、前後鏡導航同一份真相，不會出現「這裡說缺、那裡說有」。
 */
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { AssetImg } from "../../components/MediaFallback";
import { ConfirmButton } from "../../components/interactions";
import { Button, Card, Chip, EmptyState, Hint, Meta, Pill } from "../../components/ui";
import { EditingHandoffSheet } from "../external-editing/EditingHandoffSheet";
import { EditingSessionCard } from "../external-editing/EditingSessionCard";
import {
  COMPLETION_TRACKS,
  TRACK_LABEL,
  computeProjectCompletion,
  computeShotCompletion,
  listDeliveryIssues,
  type CompletionTrack,
  type ShotCompletion,
  type ShotCompletionInput,
} from "@shared/shotCompletion";

import { ONE_CLICK_BATCH_MODEL } from "../story-workspace/oneClickFilm";
import { ProjectRightsReadiness } from "../../components/AssetRightsChip";

/** 批次生成用的預設文生圖模型（與一鍵生成／單格工作室同一顆，畫風不分岔） */
const BATCH_MODEL = ONE_CLICK_BATCH_MODEL;

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "todo", label: "待處理" },
  { key: "done", label: "完成" },
  { key: "review", label: "需要審核" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

const STATE_PILL: Record<ShotCompletion["state"], { status: "done" | "running" | "failed" | "queued"; text: string }> = {
  done: { status: "done", text: "完成" },
  running: { status: "running", text: "製作中" },
  blocked: { status: "failed", text: "需要修改" },
  todo: { status: "queued", text: "待處理" },
};

export function DeliveryRoom({
  projectId,
  canEdit,
  onOpenShot,
}: {
  projectId: string;
  canEdit: boolean;
  /** 需要真正編輯時才送去單格工作室（製作只有那一個入口） */
  onOpenShot: (shotId: string) => void;
}) {
  const utils = trpc.useUtils();
  const shots = trpc.scenes.listByProject.useQuery({ projectId });
  const [filter, setFilter] = useState<FilterKey>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sheetShotId, setSheetShotId] = useState<string | null>(null);
  const [editingSheetOpen, setEditingSheetOpen] = useState(false);
  const editingSessions = trpc.externalEditing.list.useQuery({ projectId });

  const invalidate = () => {
    utils.scenes.listByProject.invalidate({ projectId });
  };
  const voice = trpc.scenes.generateVoiceover.useMutation({ onSuccess: invalidate });
  const ambience = trpc.scenes.generateAmbience.useMutation({ onSuccess: invalidate });
  const review = trpc.scenes.review.useMutation({ onSuccess: invalidate });
  const batch = trpc.scenes.batchGenerate.useMutation({
    onSuccess: () => {
      setPicked(new Set());
      invalidate();
    },
  });

  const rows = (shots.data ?? []) as unknown as Array<ShotCompletionInput & { assetUrl: string | null; durationSec: number }>;
  const { completions, project, issues, byId } = useMemo(() => {
    const completions = rows.map(computeShotCompletion);
    return {
      completions,
      project: computeProjectCompletion(completions),
      issues: listDeliveryIssues(completions),
      byId: new Map(rows.map((r) => [r.id, r])),
    };
  }, [rows]);

  const issuesByShot = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const i of issues) m.set(i.shotId, [...(m.get(i.shotId) ?? []), i.label]);
    return m;
  }, [issues]);

  const shown = useMemo(() => {
    const ordered = [...completions].sort((a, b) => a.orderIndex - b.orderIndex);
    if (filter === "done") return ordered.filter((c) => c.state === "done");
    if (filter === "todo") return ordered.filter((c) => c.state !== "done");
    if (filter === "review") return ordered.filter((c) => c.tracks.review !== "done");
    return ordered;
  }, [completions, filter]);

  if (shots.isLoading) {
    return (
      <Card as="section">
        <Meta as="p">正在盤點完成度…</Meta>
      </Card>
    );
  }
  if (project.shots === 0) {
    return (
      <Card as="section">
        <EmptyState
          icon={<Icon name="Clapperboard" size={20} />}
          title="還沒有分鏡可以交付"
          description="先回到故事寫內容、產生分鏡，這裡就會自動出現整部片的完成度與待辦。"
        />
      </Card>
    );
  }

  /*
   * 與 batchGenerate 的伺服器規則對齊：已通過審核的鏡會被跳過（§17）。
   * 這裡若照著算全部缺畫面的鏡，按鈕會說「補完 4 鏡」而實際只做 3 鏡——
   * 按鈕承諾的數字與實際結果不符，比不顯示數字還糟。
   */
  const missingVisual = completions.filter(
    (c) => c.tracks.image === "missing" && byId.get(c.shotId)?.reviewStatus !== "approved",
  ).length;
  const sheetShot = sheetShotId ? completions.find((c) => c.shotId === sheetShotId) : null;
  const sheetRow = sheetShotId ? byId.get(sheetShotId) : null;
  const busy = voice.isPending || ambience.isPending || review.isPending;

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Card as="section" className="delivery-room" data-fb="成片交付室">
      <div className="delivery-room__head">
        <h3 style={{ margin: 0 }}>整部片完成度</h3>
        <strong className="delivery-room__percent">{project.percent}%</strong>
        <Meta as="span">
          {project.completeShots} / {project.shots} 鏡全部就緒
        </Meta>
        {canEdit ? (
          <Button size="sm" variant="tonal" onClick={() => setEditingSheetOpen(true)}>
            <Icon name="Clapperboard" size={13} /> 交給 LumaFusion 剪輯
          </Button>
        ) : null}
      </div>

      {(editingSessions.data?.length ?? 0) > 0 ? (
        <section className="editing-session-list" aria-label="外部剪輯工作階段">
          <div className="editing-session-list__head">
            <strong>外部剪輯工作階段</strong>
            <Meta>{editingSessions.data?.length} 個</Meta>
          </div>
          {editingSessions.data?.map((session) => (
            <EditingSessionCard key={session.id} session={session} onChanged={() => void editingSessions.refetch()} />
          ))}
        </section>
      ) : null}

      <div className="delivery-room__tracks">
        {COMPLETION_TRACKS.map((t) => (
          <div key={t} className="delivery-room__track">
            <Meta as="span">{TRACK_LABEL[t]}</Meta>
            <strong>
              {project.perTrack[t]} / {project.shots}
            </strong>
          </div>
        ))}
      </div>

      <ProjectRightsReadiness projectId={projectId} />

      {issues.length === 0 ? (
        <Hint role="status" style={{ marginTop: 10 }}>
          <Icon name="Check" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
          每一鏡的畫面、影片、配音、音效與審核都齊了——可以打包交付。
        </Hint>
      ) : (
        <Hint role="status" style={{ marginTop: 10 }}>
          <Icon name="TriangleAlert" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
          目前有 {issues.length} 個待處理，點任何一鏡直接處理。
        </Hint>
      )}

      {/* §13 Filter：看整體、看待辦、看已完成、看待審——四種很不同的心態 */}
      <div className="delivery-room__filters" role="tablist" aria-label="篩選分鏡">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            className={filter === f.key ? "active" : undefined}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* §11 批次：在「看得到哪些缺」的地方直接選鏡開工，不必再去別頁 */}
      {canEdit && (
        <div className="delivery-room__batch">
          {picked.size > 0 ? (
            <ConfirmButton
              triggerClassName="btn-sm btn-primary"
              message={`為選取的 ${picked.size} 鏡批次生成畫面？會建立一份 AI 代理計畫，估點後由你核准才開始扣點；單鏡失敗不影響其他鏡。`}
              confirmLabel="建立批次"
              disabled={batch.isPending}
              onConfirm={() => batch.mutate({ projectId, modelId: BATCH_MODEL, sceneIds: [...picked] })}
            >
              批次生成選取的 {picked.size} 鏡
            </ConfirmButton>
          ) : (
            missingVisual > 0 && (
              <ConfirmButton
                triggerClassName="btn-sm btn-ghost"
                message={`為所有還沒有畫面的 ${missingVisual} 鏡批次生成？會建立一份 AI 代理計畫，估點後由你核准才開始扣點。已通過審核的鏡不會被動到。`}
                confirmLabel="建立批次"
                disabled={batch.isPending}
                onConfirm={() => batch.mutate({ projectId, modelId: BATCH_MODEL })}
              >
                <Icon name="Sparkles" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                補完所有缺畫面的 {missingVisual} 鏡
              </ConfirmButton>
            )
          )}
          {picked.size > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
              取消選取
            </Button>
          )}
          {batch.data && (
            <Meta as="span" role="status">
              已建立批次（{batch.data.shots} 鏡，約 {batch.data.estPoints} 點）——到「AI 執行計畫」核准後開始。
            </Meta>
          )}
          {batch.error && <span className="error">{batch.error.message}</span>}
        </div>
      )}

      {/* §13 縮圖列：一眼看完整部片的狀況，而不是讀一串文字 */}
      {shown.length === 0 ? (
        <Meta as="p" style={{ margin: "10px 0 0" }}>這個篩選下沒有分鏡。</Meta>
      ) : (
        <ul className="delivery-strip">
          {shown.map((c) => {
            const row = byId.get(c.shotId);
            const pill = STATE_PILL[c.state];
            const miss = issuesByShot.get(c.shotId) ?? [];
            const on = picked.has(c.shotId);
            return (
              <li key={c.shotId} className={`delivery-strip__item${on ? " is-picked" : ""}`}>
                <button
                  type="button"
                  className="delivery-strip__card"
                  onClick={() => setSheetShotId(c.shotId)}
                  aria-label={`第 ${c.orderIndex} 鏡 ${c.title}：${pill.text}，完成度 ${c.percent}%${miss.length ? `，${miss.join("、")}` : ""}`}
                >
                  <span className="delivery-strip__thumb">
                    {row?.assetUrl ? (
                      <AssetImg src={row.assetUrl} alt="" loading="lazy" fallbackLabel="" />
                    ) : (
                      <Icon name="Image" size={16} />
                    )}
                  </span>
                  <span className="delivery-strip__num">#{c.orderIndex}</span>
                  <Pill status={pill.status}>{pill.text}</Pill>
                  <Meta as="span" className="delivery-strip__meta">
                    {miss.length ? miss.join("・") : `${row?.durationSec ?? 0} 秒`}
                  </Meta>
                </button>
                {canEdit && (
                  <label className="delivery-strip__pick">
                    <input type="checkbox" checked={on} onChange={() => toggle(c.shotId)} aria-label={`選取第 ${c.orderIndex} 鏡做批次生成`} />
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* §14 快速補件：單一軌缺件就地補；要真編輯才送去工作室 */}
      {sheetShot && sheetRow && createPortal(
        <div className="delivery-sheet-root">
          <button type="button" className="delivery-sheet__backdrop" aria-label="關閉" onClick={() => setSheetShotId(null)} />
          <div className="delivery-sheet" role="dialog" aria-modal="true" aria-label={`第 ${sheetShot.orderIndex} 鏡・待辦`}>
            <div className="delivery-sheet__head">
              <strong>第 {sheetShot.orderIndex} 鏡</strong>
              <Meta as="span">{sheetShot.title}</Meta>
              <span style={{ flex: "1 1 auto" }} />
              <Button variant="ghost" size="sm" onClick={() => setSheetShotId(null)} aria-label="關閉">
                <Icon name="X" size={16} />
              </Button>
            </div>

            <div className="delivery-sheet__tracks">
              {COMPLETION_TRACKS.map((t) => (
                <Chip key={t} selected={sheetShot.tracks[t] === "done"}>
                  {TRACK_LABEL[t]}
                  {sheetShot.tracks[t] === "done" ? " ✓" : sheetShot.tracks[t] === "running" ? " …" : " !"}
                </Chip>
              ))}
            </div>

            {canEdit && (
              <div className="delivery-sheet__actions">
                {/* 只在真的缺、而且真的有直接補的能力時才給按鈕——不給註定失敗的入口 */}
                {sheetShot.tracks.voice === "missing" && (
                  <Button variant="primary" size="sm" disabled={busy}
                    onClick={() => voice.mutate({ sceneId: sheetShot.shotId })}>
                    立即產生配音
                  </Button>
                )}
                {sheetShot.tracks.audio === "missing" && (
                  <Button variant="primary" size="sm" disabled={busy}
                    onClick={() => ambience.mutate({ sceneId: sheetShot.shotId })}>
                    立即產生環境音
                  </Button>
                )}
                {sheetShot.tracks.review !== "done" && sheetShot.doneCount >= 2 && (
                  <Button variant="ghost" size="sm" disabled={busy}
                    onClick={() => review.mutate({ sceneId: sheetShot.shotId, status: "approved" })}>
                    標記為已通過
                  </Button>
                )}
                {/* 畫面／影片要挑版本、調提示詞，不是一顆按鈕能完成的——送去工作室 */}
                <Button variant="ghost" size="sm"
                  onClick={() => { setSheetShotId(null); onOpenShot(sheetShot.shotId); }}>
                  <Icon name="Sparkles" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                  進入完整編輯
                </Button>
              </div>
            )}
            {(voice.error || ambience.error || review.error) && (
              <p className="error" role="alert">
                {voice.error?.message ?? ambience.error?.message ?? review.error?.message}
              </p>
            )}
            <Meta as="p" style={{ margin: "6px 0 0" }}>
              補完後這一屏的完成度會自動更新——它讀的是同一份資料，不是另外記一份。
            </Meta>
          </div>
        </div>,
        document.body,
      )}
      <EditingHandoffSheet
        open={editingSheetOpen}
        projectId={projectId}
        defaultShotIds={picked.size ? [...picked] : []}
        originSurface="delivery"
        onClose={() => setEditingSheetOpen(false)}
        onPrepared={() => void editingSessions.refetch()}
      />
    </Card>
  );
}
