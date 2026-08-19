/**
 * 故事主畫面（story-inline）：第一層只留創作必要項——
 * 故事編輯器（autosave）＋解析摘要 chips＋需要確認的最小卡片＋「產生分鏡」主 CTA。
 * 角色／場景／道具／造型／分鏡／標記由紅色 chips 在正下方單一 slot 展開。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { ConfirmButton, HelpTip } from "../../components/interactions";
import { Button, Card, Chip, EmptyState, Hint, Meta } from "../../components/ui";
import { ConflictNotice, conflictFromError } from "../../components/ConflictNotice";
import type { RevisionConflict } from "@shared/revision";
import { revealWorkbenchAnchor, scrollToSelector } from "../creation-workbench/workbenchNav";
import { revealStoryInlineSection, sectionForSummaryChip, type StoryInlineSectionId } from "./storyInlineNav";
import { STORY_FLUSH_EVENT, STORY_FLUSH_FAILED_EVENT, STORY_FLUSHED_EVENT } from "./oneClickFilm";
import { CANDIDATE_KIND_LABEL, type CandidateKind } from "@shared/story";
import { ScriptEditor } from "./ScriptEditor";
import { useStoryYDoc } from "./useStoryYDoc";
import { RemoteCarets } from "./RemoteCarets";
import {
  createStorySaveGate,
  shouldAdoptRemote,
  summaryChips,
  STORY_AUTOSAVE_DEBOUNCE_MS,
  type StorySaveState,
} from "./storyDraft";
import { refreshStudioShotList } from "../../lib/studioShotList";

const SAVE_LABEL: Record<StorySaveState, string> = {
  idle: "",
  dirty: "輸入中…",
  saving: "儲存中…",
  saved: "已儲存 ✓",
  error: "儲存失敗，稍後會再試",
  // 衝突不是失敗——你的字還在，只是需要你決定要哪一版。詳細說明在下面的衝突卡。
  conflict: "夥伴也改了這份故事",
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
  onRevealSection,
  activeSection = null,
  extraChips = [],
  revealSlot,
  onDirtyChange,
}: {
  projectId: string;
  canEdit: boolean;
  mobileCompact: boolean;
  /** 開「專案設定」二層（微調角色/場景/道具時才需要，非必經） */
  onOpenSettings: () => void;
  /** 產生分鏡後打開故事內的分鏡收合區（舊 #stage-board 深連結仍有效） */
  onRevealSection?: (section: StoryInlineSectionId | null) => void;
  /** Currently open chip; null = slot collapsed. */
  activeSection?: StoryInlineSectionId | null;
  extraChips?: Array<{ key: string; label: string; section: StoryInlineSectionId }>;
  /** Real manager cards rendered immediately under the chip row. */
  revealSlot?: ReactNode;
  onDirtyChange?: (dirty: boolean) => void;
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

  /**
   * 樂觀併發（shared/revision.ts）。故事是**整份全文覆寫**、autosave 每 800ms 送一次，
   * 是全站最容易吃掉別人整段內容的地方——沒有這兩個欄位，兩個人同時打字時
   * 其中一人的整段文字每 800ms 就被覆蓋一次，而畫面上什麼都不會發生。
   *
   * baseline 記的是「我這份草稿是從哪一份內容長出來的」（最後一次收養／存成功的遠端內容），
   * 伺服器據此判斷夥伴到底有沒有真的動過內文。
   */
  const revRef = useRef<number | undefined>(undefined);
  const baselineRef = useRef<string | undefined>(undefined);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const [conflict, setConflict] = useState<RevisionConflict | null>(null);
  const saveMutateRef = useRef<(input: {
    projectId: string;
    content: string;
    expectedRev?: number;
    baseline?: string;
  }) => void>(() => {});
  const gateRef = useRef<ReturnType<typeof createStorySaveGate> | null>(null);
  if (!gateRef.current) {
    gateRef.current = createStorySaveGate({
      send: (req) => {
        setSaveState("saving");
        saveMutateRef.current({
          projectId: projectIdRef.current,
          content: req.content,
          expectedRev: req.expectedRev,
          baseline: req.baseline,
        });
      },
      getRev: () => revRef.current,
      getBaseline: () => baselineRef.current,
      setRev: (rev) => {
        revRef.current = rev;
      },
      setBaseline: (next) => {
        baselineRef.current = next;
      },
    });
  }
  /** debounce／flush／onBlur 共用：gate 一定帶 expectedRev + baseline。
   *  預設分支 onBlur 曾走 `saveRef({ projectId, content })` 不帶 rev，兩分頁失焦會靜默 LWW。 */
  const dispatchStorySave = (next: string) => {
    gateRef.current?.dispatch(next);
  };

  /* ── Story 共編（Yjs；/ws-doc）───────────────────────────
     連上＝真共編（字元級合併、雙 caret；autosave 停用，落盤由伺服器 materialize）。
     連不上＝自動退回下面既有的 autosave＋revision 衝突卡路徑——共編是升級，
     不是把唯一的儲存路徑換掉。 */
  const editorElRef = useRef<HTMLTextAreaElement | null>(null);
  const ydoc = useStoryYDoc({
    projectId,
    enabled: canEdit,
    onRemote: (next, transform) => {
      // 先用**舊**的游標算新位置，再換內容，最後把游標放回去——
      // 少了這一步，夥伴每打一個字，我的游標就跳到文末。
      const el = editorElRef.current;
      const hadFocus = el && document.activeElement === el;
      const selStart = el ? transform(el.selectionStart) : 0;
      const selEnd = el ? transform(el.selectionEnd) : 0;
      setContent(next);
      baselineRef.current = next; // Y 是新的基準；退回 autosave 時不會誤判夥伴的字是「我的修改」
      if (hadFocus) {
        requestAnimationFrame(() => {
          const now = editorElRef.current;
          if (now && document.activeElement === now) now.setSelectionRange(selStart, selEnd);
        });
      }
    },
  });
  /** guard 用（autosave／收養 effect 讀 ref，不進依賴陣列） */
  const yActiveRef = useRef(false);
  yActiveRef.current = ydoc.active;

  // 共編中回報 caret（節流在 hook 內）——夥伴的編輯器上才畫得出我的游標
  useEffect(() => {
    if (!ydoc.active) return;
    const el = editorElRef.current;
    if (!el) return;
    const report = () => ydoc.sendCaret(el.selectionStart, el.selectionEnd);
    el.addEventListener("keyup", report);
    el.addEventListener("click", report);
    el.addEventListener("select", report);
    return () => {
      el.removeEventListener("keyup", report);
      el.removeEventListener("click", report);
      el.removeEventListener("select", report);
    };
  }, [ydoc.active, ydoc.sendCaret, ydoc]);

  const save = trpc.story.save.useMutation({
    onSuccess: (r, variables) => {
      setConflict(null);
      const outcome = gateRef.current?.onAck(variables.content, typeof r?.rev === "number" ? r.rev : undefined);
      if (outcome === "idle") {
        setSaveState("saved");
        utils.story.get.invalidate({ projectId: variables.projectId });
      }
    },
    onError: (err) => {
      const c = conflictFromError(err);
      gateRef.current?.onFail(c ? "conflict" : "error");
      if (c) {
        // 夥伴也改了。**不覆蓋、不自動選邊**——把兩份都留著交給人決定。
        setConflict(c);
        setSaveState("conflict");
        return;
      }
      setSaveState("error");
    },
  });
  saveMutateRef.current = save.mutate;

  const saveStateRef = useRef(saveState);
  saveStateRef.current = saveState;

  // 種初值＋收養遠端（夥伴改了故事、且本地沒有未存修改時跟上）
  // typeof 守衛：測試環境以泛用 stub 餵 query，content 可能不是字串
  const rawRemote = storyQ.data?.story?.content;
  const remote = typeof rawRemote === "string" ? rawRemote : storyQ.data ? "" : null;
  // 乾淨時 rev 跟著查詢走。衝突卡「重新套用」改送對方那一版的 rev（見 onReapply）。
  const rawRev = storyQ.data?.story?.rev;
  const remoteRef = useRef<string | null>(null);
  remoteRef.current = remote;
  useEffect(() => {
    // 存檔途中／本地未存時，查詢回來的舊 rev 不得蓋掉閘門剛推進的數字——
    // 否則排隊中的下一發會帶著過期 expectedRev，自己跟自己衝突。
    if (typeof rawRev !== "number") return;
    if (gateRef.current?.isInFlight()) return;
    if (saveStateRef.current === "dirty" || saveStateRef.current === "saving") return;
    revRef.current = rawRev;
  }, [rawRev]);
  useEffect(() => {
    if (remote === null) return;
    // 共編連線中：內容真相是 Y 文件（onRemote 直接餵），查詢回來的 stories.content
    // 是 materialize 的落後快照——拿它收養會把畫面倒退到 1.5 秒前。
    if (yActiveRef.current) return;
    setContent((local) => {
      if (shouldAdoptRemote(saveStateRef.current, local, remote)) {
        // 收養＝我的草稿從此以這份內容為基準
        baselineRef.current = remote;
        return remote;
      }
      return local;
    });
    // saveState 透過 ref 讀，避免它變動時重收養
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote]);

  // autosave：去抖 800ms；同一時間只准一發在路上（createStorySaveGate）。
  // 卸載時立刻送出未存草稿，不可因為清掉 timer 就默默丟掉。
  useEffect(() => {
    if (content === null || remote === null || content === remote) return;
    // 共編連線中：儲存由伺服器 materialize（快照落盤時寫回 stories.content），
    // 這裡的 autosave 必須停用——兩條寫入路徑同時跑，autosave 的整份全文
    // 會反覆蓋掉夥伴剛打進 Y 文件的字。
    if (yActiveRef.current) return;
    // 已經撞上衝突就停掉 autosave：再自動重送只會每 800 毫秒撞一次同一面牆，
    // 而使用者需要的是先看到「發生什麼事」並做決定。
    if (saveStateRef.current === "conflict") return;
    setSaveState("dirty");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const live = contentRef.current;
      if (live === null) return;
      dispatchStorySave(live);
    }, STORY_AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // remote 變動不重觸發（收養 effect 已處理）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, projectId]);

  // 離開畫面時把未存草稿送出。不能放在上面那個 effect 的 cleanup——
  // content 每變一次都會跑 cleanup，會變成每個字立刻存一次。
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const live = contentRef.current;
      const remoteNow = remoteRef.current;
      if (
        live !== null &&
        remoteNow !== null &&
        live !== remoteNow &&
        saveStateRef.current !== "conflict" &&
        !yActiveRef.current
      ) {
        dispatchStorySave(live);
      }
    };
  }, [projectId]);

  const flushCollab = trpc.story.flushCollab.useMutation();
  const flushCollabRef = useRef(flushCollab.mutateAsync);
  flushCollabRef.current = flushCollab.mutateAsync;

  // 一鍵生成前先把未存故事落盤。共編必須等伺服器 materialize 成功，儲存失敗不得放行。
  useEffect(() => {
    const fail = (message: string) => {
      window.dispatchEvent(new CustomEvent(STORY_FLUSH_FAILED_EVENT, { detail: { message } }));
    };
    const onFlush = () => {
      if (yActiveRef.current) {
        void flushCollabRef.current({ projectId }).then(
          () => window.dispatchEvent(new Event(STORY_FLUSHED_EVENT)),
          (err) => fail(err instanceof Error ? err.message : "共編故事尚未落到伺服器"),
        );
        return;
      }
      if (saveStateRef.current === "conflict" || saveStateRef.current === "error") {
        fail(saveStateRef.current === "conflict" ? "故事有衝突尚未處理" : "故事儲存失敗，請先修好再生成");
        return;
      }
      const live = contentRef.current;
      if (live === null || remote === null || live === remote) {
        if (gateRef.current?.isInFlight()) {
          gateRef.current.whenIdle((result) => {
            if (result.ok) window.dispatchEvent(new Event(STORY_FLUSHED_EVENT));
            else fail(result.reason === "conflict" ? "故事有衝突尚未處理" : "故事儲存失敗，請先修好再生成");
          });
          return;
        }
        window.dispatchEvent(new Event(STORY_FLUSHED_EVENT));
        return;
      }
      if (debounceRef.current) clearTimeout(debounceRef.current);
      dispatchStorySave(live);
      gateRef.current?.whenIdle((result) => {
        if (result.ok) window.dispatchEvent(new Event(STORY_FLUSHED_EVENT));
        else fail(result.reason === "conflict" ? "故事有衝突尚未處理" : "故事儲存失敗，請先修好再生成");
      });
    };
    window.addEventListener(STORY_FLUSH_EVENT, onFlush);
    return () => window.removeEventListener(STORY_FLUSH_EVENT, onFlush);
  }, [projectId, remote]);

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
    onSuccess: async (r) => {
      setParseNotice(
        r.reused ? "這次解析已經轉過分鏡了——直接看下方「分鏡」" : `已建立 ${r.storySceneIds.length} 場、${r.sceneIds.length} 個分鏡`,
      );
      // Invalidate + fetch so /studio first paint is not a cached 0 鏡 (tiny/A–D).
      void utils.scenes.listByProject.invalidate({ projectId });
      await refreshStudioShotList(utils, projectId);
      utils.story.get.invalidate({ projectId });
      utils.story.storyboardPreview.invalidate({ projectId });
      onRevealSection?.("storyboard");
      revealStoryInlineSection("storyboard", { projectId, scroll: true });
      requestAnimationFrame(() => scrollToSelector("#story-reveal-slot"));
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
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const toggleChip = (section: StoryInlineSectionId) => {
    if (activeSection === section) {
      onRevealSection?.(null);
      return;
    }
    onRevealSection?.(section);
    revealStoryInlineSection(section, { projectId, scroll: false });
  };
  const lastRun = data?.lastRun;
  const parseReady = Boolean(lastRun && lastRun.status === "done");
  /** Parse timeout / never-done: still allow 產生分鏡 from story text (xiaohua stuck). */
  const canBoardFromStory = !isBlank;

  /**
   * §33 變更預覽：專案已經有分鏡時，「產生分鏡」是會動到既有內容的批次操作，
   * 按下前要先講清楚會做什麼。全新專案沒有東西會被動到，就不要多一層確認擋路。
   */
  const boardPreview = trpc.story.storyboardPreview.useQuery(
    { projectId },
    { enabled: parseReady },
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
          {/* 存檔狀態改由編輯器工具列顯示（全螢幕時也看得到），這裡不再重複一份 */}
          <span style={{ flex: "1 1 auto" }} />
          <Button size="sm" variant="ghost" onClick={() => setShowVersions((v) => !v)} aria-expanded={showVersions}>
            版本
          </Button>
          <Button size="sm" variant="ghost" onClick={onOpenSettings} title="角色、場景、道具、素材、知識——需要微調時才進來">
            <Icon name="SlidersHorizontal" size={14} /> 專案設定
          </Button>
        </div>
        {!canEdit && <Hint style={{ margin: "4px 0 8px" }}>檢視者唯讀——故事可以看，不能改。</Hint>}
        {/* 併發衝突：兩份內容都還在，由使用者決定要哪一版。
            autosave 已在 conflict 狀態下停住，不會一邊問一邊繼續覆蓋。 */}
        {conflict && (
          <ConflictNotice
            conflict={conflict}
            reapplying={save.isPending}
            onViewLatest={() => {
              // 採用夥伴那一版：草稿換成他的內容，基準也跟著換，autosave 隨即恢復正常
              const theirs = String((conflict.currentData as { content?: unknown }).content ?? "");
              setContent(theirs);
              baselineRef.current = theirs;
              revRef.current = conflict.currentRev;
              setConflict(null);
              setSaveState("saved");
            }}
            onReapply={() => {
              // 我這一版勝出：以**對方那一版的 rev** 重送，仍然過一次併發檢查——
              // 若這期間又有第三個人改了，會再撞一次，而那是對的。
              const mine = contentRef.current;
              if (mine === null) return;
              revRef.current = conflict.currentRev;
              baselineRef.current = String((conflict.currentData as { content?: unknown }).content ?? "");
              setConflict(null);
              setSaveState("saving");
              dispatchStorySave(mine);
            }}
          />
        )}
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
                <Button
                  variant="ghost"
                  onClick={() => {
                    onRevealSection?.("production");
                    revealStoryInlineSection("production", {
                      projectId,
                      scroll: false,
                      nestedSelector: "#sec-assistant",
                    });
                    revealWorkbenchAnchor("#sec-assistant", { projectId });
                  }}
                >
                  <Icon name="MessageSquare" size={14} /> 與 AI 一起開始
                </Button>
              ) : undefined
            }
          />
        ) : null}
        <ScriptEditor
          value={content ?? ""}
          canEdit={canEdit}
          rows={rows}
          textareaRef={(el) => { editorElRef.current = el; }}
          placeholder={"把故事貼在這裡，或直接開始寫…\n\n小訣竅：一段＝一場戲。也可以用上面的標注鈕，把名字一鍵宣告成「角色：」「場景：」「道具：」。"}
          saveLabel={ydoc.active ? "共編中 · 即時同步 ✓" : save.isPending ? SAVE_LABEL.saving : SAVE_LABEL[saveState]}
          onChange={(next) => {
            setContent(next);
            // 共編中：差量進 Y.Text（applyLocal 回 true）；未連上：僅本地 state，
            // 由下面既有的 autosave 去存——同一顆 onChange，兩條路徑自動切換。
            ydoc.applyLocal(next);
          }}
          onBlur={() => {
            // 失焦立即 flush（去抖未到期的那次存檔提前做，避免切走遺失）。
            // 共編中不 flush：儲存由伺服器 materialize，這裡的整份寫回會蓋掉夥伴的字。
            // 與 debounce／一鍵生成 flush 同一條 dispatchStorySave：帶 expectedRev + baseline。
            if (yActiveRef.current) return;
            const live = contentRef.current;
            if (live !== null && remote !== null && live !== remote) {
              if (debounceRef.current) clearTimeout(debounceRef.current);
              dispatchStorySave(live);
            }
          }}
          /* 解析摘要、主 CTA 與解析結果一起進全螢幕：
             不然「產生分鏡」與「解析完成了嗎」都要退出全螢幕才看得到，寫作流被切斷 */
          footer={
            <>
              <div className="story-parse-bar">
                <div className="story-parse-bar__chips" role="group" aria-label="解析摘要">
                  {summary && summaryChips({ ...summary, flagged: summary.flagged, pending: pending.length }).map((c) => {
                    const section = sectionForSummaryChip(c.key);
                    const selected = section != null && activeSection === section;
                    return (
                      <Chip
                        key={c.key}
                        selected={section ? selected : undefined}
                        className="on"
                        title={section ? `查看${c.label}` : undefined}
                        aria-expanded={section ? selected : undefined}
                        aria-controls={section ? "story-reveal-slot" : undefined}
                        onClick={section ? () => toggleChip(section) : undefined}
                      >
                        {c.label}
                      </Chip>
                    );
                  })}
                  {extraChips.map((c) => {
                    const selected = activeSection === c.section;
                    return (
                      <Chip
                        key={c.key}
                        selected={selected}
                        className="on"
                        title={`查看${c.label}`}
                        aria-expanded={selected}
                        aria-controls="story-reveal-slot"
                        onClick={() => toggleChip(c.section)}
                      >
                        {c.label}
                      </Chip>
                    );
                  })}
                  {isDirty && hasParsed && <Chip className="story-chip-dirty">內容已改，建議重新解析</Chip>}
                </div>
                {activeSection ? (
                  <div
                    id="story-reveal-slot"
                    className="story-reveal-slot"
                    role="region"
                    aria-label={activeSection === "markers" ? "標記" : "目前展開的工作區"}
                    data-section={activeSection}
                  >
                    {activeSection === "markers" ? (
                      pending.length > 0 ? (
                        <section className="story-confirm-list" aria-label="需要確認的解析項目">
                          {pending.map((c) => (
                            <CandidateCard key={c.id} projectId={projectId} candidate={c} canEdit={canEdit} />
                          ))}
                        </section>
                      ) : (
                        <Hint>目前沒有待確認的標記。信心較高的項目已自動建立。</Hint>
                      )
                    ) : revealSlot}
                  </div>
                ) : null}
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
                        disabled={board.isPending || !canBoardFromStory}
                        onConfirm={() => board.mutate({ projectId })}
                      >
                        {board.isPending ? "建立中…" : "產生分鏡"}
                      </ConfirmButton>
                    ) : (
                      <Button
                        variant={hasParsed && !isDirty ? "primary" : "ghost"}
                        disabled={board.isPending || !canBoardFromStory}
                        onClick={() => board.mutate({ projectId })}
                        title={parseReady
                          ? "把解析出的場與鏡建成可編輯的分鏡卡"
                          : "解析未完成時，仍可依故事原文拆場拆鏡"}
                      >
                        {board.isPending ? "建立中…" : lastRun?.hasStoryboard ? "分鏡已建立 ✓" : "產生分鏡"}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {save.error && <p className="error">{save.error.message}</p>}
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
            </>
          }
        />
        {/* 夥伴的 caret（不同顏色＋名牌）：awareness 的名字與色票與 /ws 同一套 */}
        {ydoc.active && ydoc.peers.size > 0 && (
          <RemoteCarets textareaRef={editorElRef} peers={ydoc.peers} value={content ?? ""} />
        )}

        {pending.length > 0 && activeSection !== "markers" && (
          <Hint as="p" style={{ margin: "8px 0 0" }}>
            {pending.length} 項需要確認——點上方「標記」在 chips 下方處理。
            <HelpTip text="AI 只在不確定時才問你。信心高的項目已自動建立。" />
          </Hint>
        )}
      </Card>
    </CardShell>
  );
}

/** 佈局殼：桌機沿用 stack；之後若要加側欄（解析活動紀錄）由此擴充，不動 StoryStage 本體 */
function CardShell({ children }: { children: React.ReactNode }) {
  return <div className="story-stage stack">{children}</div>;
}
