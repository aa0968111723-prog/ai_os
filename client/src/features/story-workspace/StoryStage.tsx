/**
 * ① 故事（Story Workspace；PE 計畫 §09）：第一層只留創作必要項——
 * 故事編輯器（autosave）＋解析摘要 chips＋需要確認的最小卡片＋「產生分鏡」主 CTA。
 * 角色庫／場景庫／素材庫全部退到專案設定二層：從新專案到第一版分鏡不必打開任何資料庫頁。
 */
import { useEffect, useRef, useState } from "react";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { ConfirmButton, HelpTip } from "../../components/interactions";
import { Button, Card, Chip, EmptyState, Hint, Meta } from "../../components/ui";
import { revealWorkbenchAnchor, scrollToSelector } from "../creation-workbench/workbenchNav";
import { CANDIDATE_KIND_LABEL, type CandidateKind } from "@shared/story";
import {
  shouldAdoptRemote,
  summaryChips,
  STORY_AUTOSAVE_DEBOUNCE_MS,
  type StorySaveState,
} from "./storyDraft";

const SAVE_LABEL: Record<StorySaveState, string> = {
  idle: "",
  dirty: "輸入中…",
  saving: "儲存中…",
  saved: "已儲存 ✓",
  error: "儲存失敗，稍後會再試",
};

/** 確認卡（PE 計畫 §06）：只讓使用者處理 AI 真正不確定的 1–2 件事，不是 20 個核取方塊 */
function CandidateCard({
  projectId,
  candidate,
  canEdit,
}: {
  projectId: string;
  candidate: {
    id: string;
    kind: string;
    name: string;
    confidence: number;
    sourceExcerpt: string | null;
    payload: { appearance?: string; features?: string; costume?: string; aliases?: string[] } | null;
  };
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const [merging, setMerging] = useState(false);
  const kind = (candidate.kind as CandidateKind) ?? "prop";
  // 併入目標清單：與各卡片元件共用同一快取 key，零額外請求
  const characters = trpc.characters.list.useQuery({ projectId }, { enabled: merging && kind === "character" });
  const scenePresets = trpc.scenePresets.list.useQuery({ projectId }, { enabled: merging && kind === "location" });
  const propCards = trpc.props.list.useQuery({ projectId }, { enabled: merging && kind === "prop" });
  const confirm = trpc.story.confirmCandidate.useMutation({
    onSuccess: () => {
      utils.story.get.invalidate({ projectId });
      utils.characters.list.invalidate({ projectId });
      utils.scenePresets.list.invalidate({ projectId });
      utils.props.list.invalidate({ projectId });
      utils.characterLooks.list.invalidate({ projectId });
    },
  });
  const targets =
    kind === "character" ? characters.data : kind === "location" ? scenePresets.data : kind === "prop" ? propCards.data : undefined;
  const desc = candidate.payload?.appearance || candidate.payload?.features || candidate.payload?.costume || "";
  return (
    <Card variant="quiet" className="story-confirm-card" data-fb="解析確認卡">
      <div className="story-confirm-card__head">
        <Chip>{CANDIDATE_KIND_LABEL[kind] ?? candidate.kind}</Chip>
        <strong>{candidate.name}</strong>
        <Meta as="span">AI 不太確定（{Math.round(candidate.confidence * 100)}%）</Meta>
      </div>
      {desc && <Meta as="p" style={{ margin: "4px 0 0" }}>{desc}</Meta>}
      {candidate.sourceExcerpt && (
        <Meta as="p" className="story-confirm-card__excerpt" title={candidate.sourceExcerpt}>
          「…{candidate.sourceExcerpt}…」
        </Meta>
      )}
      {canEdit && (
        <div className="story-confirm-card__actions">
          <Button size="sm" variant="primary" disabled={confirm.isPending}
            onClick={() => confirm.mutate({ candidateId: candidate.id, action: "create" })}>
            建立
          </Button>
          {kind !== "look" && !merging && (
            <Button size="sm" disabled={confirm.isPending} onClick={() => setMerging(true)}>
              併入既有…
            </Button>
          )}
          {merging && (
            <select
              aria-label="選擇要併入的既有卡片"
              disabled={confirm.isPending}
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                confirm.mutate({ candidateId: candidate.id, action: "merge", targetId: e.target.value });
              }}
            >
              <option value="" disabled>選擇既有{CANDIDATE_KIND_LABEL[kind]}…</option>
              {(targets ?? []).map((t: { id: string; name: string }) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          <Button size="sm" variant="ghost" disabled={confirm.isPending}
            onClick={() => confirm.mutate({ candidateId: candidate.id, action: "dismiss" })}>
            略過
          </Button>
        </div>
      )}
      {confirm.error && <p className="error">{confirm.error.message}</p>}
    </Card>
  );
}

export function StoryStage({
  projectId,
  canEdit,
  mobileCompact,
  onOpenSettings,
}: {
  projectId: string;
  canEdit: boolean;
  mobileCompact: boolean;
  /** 開「專案設定」二層（微調角色/場景/道具時才需要，非必經） */
  onOpenSettings: () => void;
}) {
  const utils = trpc.useUtils();
  const storyQ = trpc.story.get.useQuery({ projectId }, { refetchInterval: 30_000 });
  const [content, setContent] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<StorySaveState>("idle");
  const [parseNotice, setParseNotice] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<string | null>(null);
  contentRef.current = content;

  const save = trpc.story.save.useMutation({
    onSuccess: () => {
      setSaveState("saved");
      utils.story.get.invalidate({ projectId });
    },
    onError: () => setSaveState("error"),
  });
  const saveRef = useRef(save.mutate);
  saveRef.current = save.mutate;

  const saveStateRef = useRef(saveState);
  saveStateRef.current = saveState;

  // 種初值＋收養遠端（夥伴改了故事、且本地沒有未存修改時跟上）
  // typeof 守衛：測試環境以泛用 stub 餵 query，content 可能不是字串
  const rawRemote = storyQ.data?.story?.content;
  const remote = typeof rawRemote === "string" ? rawRemote : storyQ.data ? "" : null;
  useEffect(() => {
    if (remote === null) return;
    setContent((local) => {
      if (shouldAdoptRemote(saveStateRef.current, local, remote)) return remote;
      return local;
    });
    // saveState 透過 ref 讀，避免它變動時重收養
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote]);

  // autosave：去抖 800ms；卸載時 flush（未存的內容不可默默丟掉）
  useEffect(() => {
    if (content === null || remote === null || content === remote) return;
    setSaveState("dirty");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSaveState("saving");
      saveRef.current({ projectId, content });
    }, STORY_AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // remote 變動不重觸發（收養 effect 已處理）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, projectId]);

  const parse = trpc.story.parse.useMutation({
    onSuccess: (r) => {
      const s = r.stats;
      const truncated = s.truncation ? `（故事過長，已解析前 ${s.truncation.sentChars.toLocaleString()} 字）` : "";
      /*
       * 「解析完成」但一個角色/場景/道具都沒認出來，是真的會發生的結果
       * （故事太短、太抽象，或模型這次回得很稀疏）。舊版只把 0 印出來——
       * 使用者看到「解析完成」卻什麼都沒變，會以為是壞掉了。這裡明說發生什麼、
       * 下一步能做什麼（§59 空狀態要被設計過、§60 不做會誤導的 UI）。
       */
      const foundNothing =
        s.characters.created + s.characters.linked + s.locations.created + s.props.created === 0;
      setParseNotice(
        r.skipped
          ? "內容沒變，沿用上次解析結果"
          : foundNothing
            ? `解析完成，但這段故事裡沒有辨識出角色、場景或道具${s.scenes ? `（已規劃 ${s.scenes} 場 ${s.shots} 鏡，可以直接產生分鏡）` : ""}。想指定的話，在故事裡用「角色：」「場景：」「道具：」開頭的行點名，再解析一次。${truncated}`
            : `解析完成：角色 建${s.characters.created}／連${s.characters.linked}、場景 建${s.locations.created}、道具 建${s.props.created}${s.looks.created ? `、造型 ${s.looks.created}` : ""}；規劃 ${s.scenes} 場 ${s.shots} 鏡${truncated}`,
      );
      utils.story.get.invalidate({ projectId });
      utils.characters.list.invalidate({ projectId });
      utils.scenePresets.list.invalidate({ projectId });
      utils.props.list.invalidate({ projectId });
      utils.characterLooks.list.invalidate({ projectId });
    },
  });

  const board = trpc.story.generateStoryboard.useMutation({
    onSuccess: (r) => {
      setParseNotice(
        r.reused ? "這次解析已經轉過分鏡了——直接看「② 分鏡」" : `已建立 ${r.storySceneIds.length} 場、${r.sceneIds.length} 個分鏡`,
      );
      utils.scenes.listByProject.invalidate({ projectId });
      utils.story.scenesList.invalidate({ projectId });
      utils.story.get.invalidate({ projectId });
      utils.story.storyboardPreview.invalidate({ projectId });
      requestAnimationFrame(() => scrollToSelector("#stage-board"));
    },
  });


  const undoRun = trpc.story.undoRun.useMutation({
    onSuccess: (r) => {
      setParseNotice(
        `已撤銷：移除 ${r.removed.characters} 角色、${r.removed.locations} 場景、${r.removed.props} 道具、${r.removed.shots} 分鏡（分鏡進回收桶可還原）`,
      );
      utils.story.get.invalidate({ projectId });
      utils.characters.list.invalidate({ projectId });
      utils.scenePresets.list.invalidate({ projectId });
      utils.props.list.invalidate({ projectId });
      utils.characterLooks.list.invalidate({ projectId });
      utils.scenes.listByProject.invalidate({ projectId });
      utils.story.scenesList.invalidate({ projectId });
    },
  });

  const versions = trpc.story.listVersions.useQuery({ projectId }, { enabled: showVersions });
  const restoreVersion = trpc.story.restoreVersion.useMutation({
    onSuccess: () => {
      setContent(null); // 讓收養 effect 重新種伺服器內容
      setSaveState("idle");
      utils.story.get.invalidate({ projectId });
      utils.story.listVersions.invalidate({ projectId });
    },
  });

  const data = storyQ.data;
  const summary = data?.summary;
  const pending = data?.pending ?? [];
  const isBlank = (content ?? "").trim().length === 0;
  const isDirty = Boolean(data?.story?.isDirty) || (content !== null && remote !== null && content !== remote);
  const hasParsed = Boolean(data?.story?.lastParsedAt);
  const lastRun = data?.lastRun;

  /**
   * §33 變更預覽：專案已經有分鏡時，「產生分鏡」是會動到既有內容的批次操作，
   * 按下前要先講清楚會做什麼。全新專案沒有東西會被動到，就不要多一層確認擋路。
   */
  const boardPreview = trpc.story.storyboardPreview.useQuery(
    { projectId },
    { enabled: Boolean(lastRun && lastRun.status === "done") },
  );
  const boardPlan = boardPreview.data?.ready ? boardPreview.data : null;
  const boardSummary = boardPlan?.summary;
  const needsBoardConfirm = Boolean(boardSummary && (boardSummary.reuseScenes > 0 || boardSummary.fillScenes > 0));
  const boardPlanText = boardSummary
    ? [
        boardSummary.createScenes > 0 ? `新增 ${boardSummary.createScenes} 場` : "",
        boardSummary.fillScenes > 0 ? `補鏡 ${boardSummary.fillScenes} 場` : "",
        boardSummary.reuseScenes > 0 ? `沿用 ${boardSummary.reuseScenes} 場（不會動）` : "",
        boardSummary.newShots > 0 ? `共 ${boardSummary.newShots} 鏡` : "沒有新的鏡要加",
      ]
        .filter(Boolean)
        .join("・")
    : "";
  const rows = Math.min(mobileCompact ? 16 : 22, Math.max(mobileCompact ? 8 : 12, (content ?? "").split("\n").length + 2));

  return (
    <CardShell>
      <Card as="section" id="story-workspace" data-fb="故事工作台">
        <div className="story-stage__head">
          <h2 style={{ margin: 0 }}>
            你的故事
            <HelpTip text="貼上或直接寫。AI 會在背景把人物、場景、道具、鏡頭整理成可製作的結構——你只管說故事。" />
          </h2>
          <Meta as="span" aria-live="polite" className="story-stage__savestate">
            {save.isPending ? SAVE_LABEL.saving : SAVE_LABEL[saveState]}
          </Meta>
          <span style={{ flex: "1 1 auto" }} />
          <Button size="sm" variant="ghost" onClick={() => setShowVersions((v) => !v)} aria-expanded={showVersions}>
            版本
          </Button>
          <Button size="sm" variant="ghost" onClick={onOpenSettings} title="角色、場景、道具、素材、知識——需要微調時才進來">
            <Icon name="SlidersHorizontal" size={14} /> 專案設定
          </Button>
        </div>
        {!canEdit && <Hint style={{ margin: "4px 0 8px" }}>檢視者唯讀——故事可以看，不能改。</Hint>}
        {showVersions && (
          <Card variant="quiet" style={{ margin: "8px 0" }}>
            <Meta as="p" style={{ margin: "0 0 6px" }}>故事版本（自動快照；還原前會先保存現況）</Meta>
            {versions.isLoading && <Meta>載入中…</Meta>}
            {versions.data?.length === 0 && <Meta>還沒有版本——內容有較大變動時會自動留一版</Meta>}
            {(versions.data ?? []).map((v) => (
              <div key={v.id} className="story-version-row">
                <Meta as="span">{new Date(v.createdAt).toLocaleString()}・{v.chars.toLocaleString()} 字</Meta>
                <span className="story-version-row__preview">{v.preview}</span>
                {canEdit && (
                  <ConfirmButton
                    triggerClassName="btn-sm"
                    message="還原到這一版？目前內容會先自動存成新版本，不會遺失。"
                    confirmLabel="還原"
                    disabled={restoreVersion.isPending}
                    onConfirm={() => restoreVersion.mutate({ projectId, versionId: v.id })}
                  >
                    還原
                  </ConfirmButton>
                )}
              </div>
            ))}
          </Card>
        )}
        {isBlank && content !== null ? (
          <EmptyState
            icon={<Icon name="FileText" size={20} />}
            title="從一段故事開始"
            description="貼上你寫好的故事或腳本；還沒有想法，也可以先跟 AI 聊聊。角色與場景不用先建——AI 解析時會自動整理。"
            action={
              canEdit ? (
                <Button variant="ghost" onClick={() => revealWorkbenchAnchor("#sec-assistant", { projectId })}>
                  <Icon name="MessageSquare" size={14} /> 與 AI 一起開始
                </Button>
              ) : undefined
            }
          />
        ) : null}
        <textarea
          id="story-editor"
          className="story-editor"
          aria-label="故事內容"
          placeholder={"把故事貼在這裡，或直接開始寫…\n\n小訣竅：一段＝一場戲。也可以用「角色：」「場景：」「道具：」開頭的行直接聲明設定。"}
          value={content ?? ""}
          rows={rows}
          readOnly={!canEdit}
          onChange={(e) => setContent(e.target.value)}
          onBlur={() => {
            // 失焦立即 flush（去抖未到期的那次存檔提前做，避免切走遺失）
            if (content !== null && remote !== null && content !== remote && !save.isPending) {
              if (debounceRef.current) clearTimeout(debounceRef.current);
              setSaveState("saving");
              saveRef.current({ projectId, content });
            }
          }}
        />
        {save.error && <p className="error">{save.error.message}</p>}

        {/* 解析摘要＋主 CTA 列 */}
        <div className="story-parse-bar">
          <div className="story-parse-bar__chips" role="group" aria-label="解析摘要">
            {summary && summaryChips(summary).map((c) => <Chip key={c.key} className={c.label.endsWith(" 0") ? undefined : "on"}>{c.label}</Chip>)}
            {summary && summary.flagged > 0 && (
              <Chip title="信心 70–89% 的項目已自動建立，但建議看一眼" className="on">標記 {summary.flagged}</Chip>
            )}
            {isDirty && hasParsed && <Chip className="story-chip-dirty">內容已改，建議重新解析</Chip>}
          </div>
          {canEdit && (
            <div className="story-parse-bar__actions">
              <Button
                variant={hasParsed && !isDirty ? "ghost" : "primary"}
                disabled={parse.isPending || isBlank}
                onClick={() => parse.mutate({ projectId })}
                title="AI 讀完整份故事，自動建立／連結角色、場景、道具，並規劃分鏡（免費）"
              >
                {parse.isPending ? "解析中…" : hasParsed ? "重新解析" : "AI 解析"}
              </Button>
              {needsBoardConfirm ? (
                // 已經有分鏡＝這顆會動到既有內容，先把逐場計畫講清楚再讓人按（§33）
                <ConfirmButton
                  triggerClassName={hasParsed && !isDirty ? "btn-primary" : "btn-ghost"}
                  message={`AI 準備這樣做：${boardPlanText}。已經有鏡的場一律不動（你調過的鏡頭語言、造型、生成都會留著）。套用？`}
                  confirmLabel="套用"
                  disabled={board.isPending}
                  onConfirm={() => board.mutate({ projectId })}
                >
                  {board.isPending ? "建立中…" : "產生分鏡"}
                </ConfirmButton>
              ) : (
                <Button
                  variant={hasParsed && !isDirty ? "primary" : "ghost"}
                  disabled={board.isPending || !lastRun || lastRun.status !== "done"}
                  onClick={() => board.mutate({ projectId })}
                  title="把解析出的場與鏡建成可編輯的分鏡卡"
                >
                  {board.isPending ? "建立中…" : lastRun?.hasStoryboard ? "分鏡已建立 ✓" : "產生分鏡"}
                </Button>
              )}
            </div>
          )}
        </div>
        {parse.error && <p className="error">{parse.error.message}</p>}
        {board.error && <p className="error">{board.error.message}</p>}
        {undoRun.error && <p className="error">{undoRun.error.message}</p>}
        {parseNotice && (
          <Hint role="status" style={{ marginTop: 6 }}>
            {parseNotice}
            {lastRun && lastRun.status === "done" && canEdit && (
              <ConfirmButton
                triggerClassName="btn-sm btn-ghost"
                message="撤銷這次解析？會移除它建立的角色／場景／道具與分鏡（分鏡進回收桶、已被其他鏡引用的卡片會保留）。"
                confirmLabel="撤銷"
                disabled={undoRun.isPending}
                onConfirm={() => undoRun.mutate({ runId: lastRun.id })}
              >
                撤銷這次解析
              </ConfirmButton>
            )}
          </Hint>
        )}

        {/* 需要確認：只顯示 AI 真正不確定的項目（<70%），其他一律背景處理 */}
        {pending.length > 0 && (
          <section className="story-confirm-list" aria-label="需要確認的解析項目">
            <Meta as="p" style={{ margin: "10px 0 6px", fontWeight: 600 }}>
              需要你確認（{pending.length}）
              <HelpTip text="AI 只在不確定時才問你。信心高的項目已自動建立，可在活動紀錄或專案設定查看。" />
            </Meta>
            {pending.map((c) => (
              <CandidateCard key={c.id} projectId={projectId} candidate={c} canEdit={canEdit} />
            ))}
          </section>
        )}
      </Card>
    </CardShell>
  );
}

/** 佈局殼：桌機沿用 stack；之後若要加側欄（解析活動紀錄）由此擴充，不動 StoryStage 本體 */
function CardShell({ children }: { children: React.ReactNode }) {
  return <div className="story-stage stack">{children}</div>;
}
