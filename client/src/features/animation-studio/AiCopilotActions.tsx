/**
 * AI Copilot：**懂目前這一鏡的協作者**，不是一個要你重新解釋背景的聊天框。
 *
 * 差別在於送出的東西：每個動作都自動帶上 projectId／sceneId／白板現況摘要，
 * 伺服器那邊本來就會抓專案世界觀與前後鏡做連戲（見 director.sketchBoard）。
 * 使用者不必再打一次「這是一支療癒短片、主角叫安倢」。
 *
 * 呈現成一排動作卡而不是對話串：這些是**動詞**（畫、寫、建議），
 * 有明確的輸入與產出，用聊天氣泡包起來只會讓人不知道按了會發生什麼。
 * 拆腳本這種要貼長文的才展開輸入區。
 */
import { useEffect, useRef, useState } from "react";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import type { IconName } from "../../components/Icon";
import { Button, Card, Hint, Meta } from "../../components/ui";
import type { Stroke } from "./boardDoc";
import type { BoardSummary } from "./boardSummary";
import { boardDocFromSketch, clampSketchToCapacity } from "./sketchImport";
import { replaySketch, type ReplayHandle, type SketchPreview } from "./sketchReplay";
import type { StudioShot } from "./ShotStrip";

export interface AiCopilotProps {
  projectId: string;
  shot: StudioShot | null;
  canEdit: boolean;
  boardEmpty: boolean;
  /** 白板已存成畫面：父層據此清掉「未存手稿」標記 */
  onBoardSaved: (shotId: string) => void;
  /** 把白板存成這一鏡的畫面（PNG → 素材庫 → 綁定），由父層提供（沿用既有實作） */
  saveBoardToShot: () => Promise<void>;
  saveState: "idle" | "uploading" | "done";
  saveError: string;
  sketch: {
    pushStroke: (stroke: Stroke) => void;
    preview: (preview: SketchPreview | null) => void;
    summarize: () => BoardSummary;
    boardW: number;
    boardH: number;
    maxStrokes: number;
    strokeCount: number;
  };
  /** 把 AI 給的提示詞填進 Inspector 的畫面欄（父層負責寫回 scenes.update） */
  onApplyPrompt: (prompt: string) => void;
}

/** 至少四個字才送：一兩個字畫出來的構圖跟亂數沒兩樣，白花一次等待 */
const SKETCH_PROMPT_MIN = 4;

export function AiCopilotActions({
  projectId,
  shot,
  canEdit,
  boardEmpty,
  onBoardSaved,
  saveBoardToShot,
  saveState,
  saveError,
  sketch,
  onApplyPrompt,
}: AiCopilotProps) {
  const utils = trpc.useUtils();
  const [sketchPrompt, setSketchPrompt] = useState("");
  const [replaying, setReplaying] = useState(false);
  const [clippedByBoard, setClippedByBoard] = useState(0);
  const [rawScript, setRawScript] = useState<string | null>(null);
  const replayRef = useRef<ReplayHandle | null>(null);
  const mountedRef = useRef(true);

  const invalidateScenes = () => { void utils.scenes.listByProject.invalidate({ projectId }); };

  const sketchMutation = trpc.director.sketchBoard.useMutation({
    onSuccess: (data) => {
      if (!mountedRef.current) return;
      // LLM 失敗的 fallback 不畫：未經同意把示範圖蓋在使用者的草稿上，比畫不出來更糟
      if (data.fallback) return;
      const board = boardDocFromSketch(data.doc);
      if (!board || board.strokes.length === 0) return;
      const { doc, clipped } = clampSketchToCapacity(board, sketch.strokeCount, sketch.maxStrokes);
      setClippedByBoard(clipped);
      if (doc.strokes.length === 0) return;
      const reducedMotion =
        typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setReplaying(true);
      replayRef.current = replaySketch(doc, sketch.pushStroke, {
        reducedMotion,
        onPreview: sketch.preview,
        onDone: () => setReplaying(false),
      });
    },
  });
  const suggest = trpc.director.suggest.useMutation();
  const addDraft = trpc.scenes.addDraft.useMutation({ onSuccess: invalidateScenes });
  const split = trpc.director.splitScript.useMutation({
    onSuccess: (data) => {
      if (!data?.truncation) setRawScript(null);
      invalidateScenes();
    },
  });

  // 卸載時停掉還在畫的重播（已落的筆畫留著，可 undo）
  useEffect(() => () => {
    mountedRef.current = false;
    replayRef.current?.cancel();
  }, []);
  // 切鏡也要停：殘餘的 timer 會把 AI 筆畫灌進新載入那一鏡的白板
  useEffect(() => {
    replayRef.current?.cancel();
    setReplaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot?.id]);

  const runSketch = (promptText: string) => {
    const board = sketch.summarize();
    sketchMutation.mutate({
      projectId,
      prompt: promptText,
      // 帶上 sceneId：伺服器抓前後鏡做連戲（主體、場景、銀幕方向接上一鏡）
      sceneId: shot?.id,
      board: board.strokeCount > 0 ? board : undefined,
      boardW: sketch.boardW,
      boardH: sketch.boardH,
      maxStrokes: sketch.maxStrokes,
    });
  };

  const busy = sketchMutation.isPending || replaying;
  const canSketch = canEdit && !busy;

  return (
    <div className="studio-copilot">
      {/* 情境列：AI 已經知道什麼。使用者不必猜「它看不看得到我畫的東西」 */}
      <div className="studio-copilot__context">
        <Icon name="Sparkles" size={13} />
        <Meta as="span">
          AI 看得到：{shot ? `Shot「${shot.title}」` : "自由塗鴉"}
          ・白板 {sketch.strokeCount} 筆
          {shot ? "・前後鏡（自動連戲）" : ""}
          ・專案世界觀
        </Meta>
      </div>

      {/* ── 主動作：把白板變成這一鏡的畫面 ── */}
      <ActionCard
        icon="Image"
        title="把白板存成這一鏡的畫面"
        detail={boardEmpty ? "白板還是空的——先畫幾筆" : "上傳成素材並綁定為這一鏡的現用畫面"}
        primary
        disabled={!canEdit || boardEmpty || !shot || saveState === "uploading"}
        busy={saveState === "uploading"}
        onRun={() => { void saveBoardToShot(); }}
        cta={saveState === "uploading" ? "存入中…" : "存成畫面"}
      />
      {saveState === "done" && <Meta role="status" style={{ color: "var(--success-ink)" }}>已存成這一鏡的畫面 ✓</Meta>}
      {saveError && <p className="error" role="alert">{saveError}</p>}
      {!shot && !boardEmpty && <Hint>目前沒選分鏡——到下面的時間軸選一鏡，才能把手稿存成那一鏡的畫面。</Hint>}

      {/* ── AI 畫草圖：可以描述，也可以直接沿用這一鏡既有的畫面描述 ── */}
      <Card as="section" variant="quiet" className="studio-copilot__card" data-fb="創作室・AI 畫草圖">
        <h3 className="studio-copilot__title">
          <Icon name="PenTool" size={13} /> 讓 AI 在白板上構圖
        </h3>
        <textarea
          className="studio-copilot__input"
          rows={2}
          value={sketchPrompt}
          maxLength={500}
          disabled={!canSketch}
          placeholder="例：一個人在山路上往右走，遠處有夕陽"
          onChange={(e) => setSketchPrompt(e.target.value)}
        />
        <div className="studio-copilot__row">
          {replaying ? (
            <Button size="sm" variant="tonal" onClick={() => { replayRef.current?.cancel(); setReplaying(false); }}>
              <Icon name="X" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
              停（已畫的留著）
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={!canSketch || sketchPrompt.trim().length < SKETCH_PROMPT_MIN}
              onClick={() => runSketch(sketchPrompt.trim())}
            >
              {sketchMutation.isPending ? "AI 構圖中…" : "畫草圖（0 點）"}
            </Button>
          )}
          {shot?.prompt && !busy && (
            <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => runSketch(shot.prompt!)} title="直接用這一鏡已經寫好的畫面描述">
              依這一鏡的描述畫
            </Button>
          )}
        </div>
        {canSketch && sketchPrompt.trim().length > 0 && sketchPrompt.trim().length < SKETCH_PROMPT_MIN && (
          <Hint role="status">再多寫幾個字（至少 {SKETCH_PROMPT_MIN} 個字）就能按了。</Hint>
        )}
        {!canEdit && <Hint role="status">你在這個專案是檢視者，不能請 AI 畫草圖。</Hint>}
        {sketchMutation.error && <p className="error" role="alert">AI 畫圖失敗：{sketchMutation.error.message}</p>}
        {sketchMutation.data?.fallback && !sketchMutation.isPending && (
          <p className="error" role="alert">
            AI 暫時沒回應，這次沒有畫任何東西。
            {sketchMutation.data.limitNotice ? `（${sketchMutation.data.limitNotice}）` : "稍等一下再試一次。"}
          </p>
        )}
        {sketchMutation.data && !sketchMutation.data.fallback && !busy && (
          <Meta role="status" as="p" style={{ margin: "4px 0 0" }}>
            畫好了：{sketchMutation.data.doc.strokes.length} 筆
            {sketchMutation.data.droppedStrokes > 0 ? `（超過上限，省略 ${sketchMutation.data.droppedStrokes} 筆）` : ""}
            {clippedByBoard > 0 ? `（白板空間不足，另有 ${clippedByBoard} 筆沒畫上）` : ""}
            {sketchMutation.data.mock ? "・示範模式" : ""}
          </Meta>
        )}
        <Hint>
          AI 畫的是分鏡構圖草稿（框、簡筆人物、運鏡箭頭），不是精緻插畫。
          白板已有筆畫時它看得到，會補進空白處、不重畫外框。
        </Hint>
      </Card>

      {/* ── 建議下一鏡／想不到怎麼描述 ── */}
      <Card as="section" variant="quiet" className="studio-copilot__card" data-fb="創作室・AI 導演建議">
        <h3 className="studio-copilot__title">
          <Icon name="Lightbulb" size={13} /> 想不到下一鏡拍什麼
        </h3>
        <Button size="sm" variant="tonal" disabled={!canEdit || suggest.isPending} onClick={() => suggest.mutate({ projectId })}>
          {suggest.isPending ? "AI 想中…" : "依專案背景給 3 個畫面建議"}
        </Button>
        {suggest.error && <p className="error" role="alert">{suggest.error.message}</p>}
        {suggest.data?.limitNotice && <Hint role="status">{suggest.data.limitNotice}</Hint>}
        {suggest.data && (
          <ul className="studio-copilot__suggestions">
            {suggest.data.suggestions.map((s, i) => (
              <li key={`${s.title}-${i}`}>
                <b>{s.title}</b>
                <p>{s.prompt}</p>
                <span className="studio-copilot__suggestion-actions">
                  {shot && (
                    <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => onApplyPrompt(s.prompt)}>
                      填進這一鏡
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => runSketch(s.prompt)}>
                    直接畫成草圖
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canEdit || addDraft.isPending}
                    onClick={() => addDraft.mutate({ projectId, title: s.title.slice(0, 60), prompt: s.prompt })}
                  >
                    存成新的一鏡
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {suggest.data?.mock && (
          <Meta as="p" style={{ fontSize: "var(--fs-11)" }}>
            {suggest.data.fallback ? "AI 暫時沒回應，先給你一組示範方向。" : "示範模式：這是範例建議。"}
          </Meta>
        )}
      </Card>

      {/* ── 貼腳本一次拆整份 ── */}
      <Card as="section" variant="quiet" className="studio-copilot__card" data-fb="創作室・拆分鏡">
        <h3 className="studio-copilot__title">
          <Icon name="FileText" size={13} /> 已經有腳本
        </h3>
        {rawScript === null ? (
          <Button size="sm" variant="tonal" disabled={!canEdit} onClick={() => setRawScript("")}>
            貼腳本，一次拆成整份分鏡
          </Button>
        ) : (
          <>
            <textarea
              className="studio-copilot__input"
              rows={6}
              value={rawScript}
              onChange={(e) => setRawScript(e.target.value)}
              placeholder="貼上完整腳本；空白行分段。留空則改用知識庫裡的腳本。"
            />
            <div className="studio-copilot__row">
              <Button
                size="sm"
                variant="primary"
                disabled={split.isPending}
                onClick={() => split.mutate({ projectId, scriptText: rawScript.trim() || undefined })}
              >
                {split.isPending ? "拆分鏡中…" : "AI 拆分鏡"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setRawScript(null); split.reset(); }}>取消</Button>
            </div>
            {split.error && <p className="error" role="alert">拆分鏡失敗：{split.error.message}</p>}
            {split.data?.truncation && (
              <Hint role="status" style={{ color: "var(--gold-ink)" }}>
                腳本過長，這次只送了前 {split.data.truncation.sentChars.toLocaleString()} 字
                （共 {split.data.truncation.totalChars.toLocaleString()} 字）——尾段沒有拆進來。
              </Hint>
            )}
          </>
        )}
        <Hint>拆出來的是草稿分鏡，不會動到現有的鏡，也不會自動出圖。</Hint>
      </Card>
    </div>
  );
}

/** 動作卡：一個動詞、一句說明、一顆按鈕。AI 的能力用這個形狀呈現，不用對話框 */
function ActionCard({
  icon,
  title,
  detail,
  cta,
  onRun,
  disabled,
  busy,
  primary,
}: {
  icon: IconName;
  title: string;
  detail: string;
  cta: string;
  onRun: () => void;
  disabled?: boolean;
  busy?: boolean;
  primary?: boolean;
}) {
  return (
    <div className={`studio-action${primary ? " is-primary" : ""}`}>
      <span className="studio-action__icon" aria-hidden="true"><Icon name={icon} size={15} /></span>
      <span className="studio-action__text">
        <b>{title}</b>
        <small>{detail}</small>
      </span>
      <Button size="sm" variant={primary ? "primary" : "tonal"} disabled={disabled || busy} onClick={onRun}>
        {cta}
      </Button>
    </div>
  );
}
