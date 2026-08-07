import { useEffect, useState } from "react";
// 欄位上限的單一真相在 shared——在元件裡再寫一次數字，遲早有一邊被調大變成後門
import { SCRIPT_AMBIENCE_MAX, SCRIPT_TITLE_MAX, SCRIPT_VOICEOVER_MAX } from "@shared/storyboardScript";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { Button, Card, Hint, Meta } from "../../components/ui";
import { boardFileName, type ExportResult } from "./boardExport";
import type { StudioShot } from "./ShotStrip";
import type { StudioLayout } from "./studioLayout";

export interface StudioAiPanelProps {
  layout: StudioLayout;
  projectId: string;
  shot: StudioShot | null;
  canEdit: boolean;
  /** 白板是空的就不給存畫面（存一張白紙上去只會佔素材庫） */
  boardEmpty: boolean;
  /** 由白板算出 PNG；在這裡才呼叫，避免每次重繪都做一次匯出 */
  exportBoard: () => Promise<ExportResult | null>;
  /** 白板已存成畫面：父層據此清掉「未存手稿」標記 */
  onBoardSaved: (shotId: string) => void;
}

/**
 * AI 協作欄：把白板上的手稿接回分鏡，並讓 AI 幫忙把畫面變成文字（提示詞、旁白、整份腳本）。
 *
 * 四件事都用站內既有的能力，不另開後端：
 * - 存成畫面 → `/api/upload` 進素材庫 → `scenes.setVisualFromAsset` 綁到這一鏡
 * - 就地編輯 → `scenes.update`
 * - 想不到怎麼描述 → `director.suggest`（AI 導演建議，可直接套用或另存成新鏡）
 * - 已經有腳本 → `director.splitScript`（一次拆成整份分鏡）
 */
export function StudioAiPanel({
  layout,
  projectId,
  shot,
  canEdit,
  boardEmpty,
  exportBoard,
  onBoardSaved,
}: StudioAiPanelProps) {
  const utils = trpc.useUtils();
  const [prompt, setPrompt] = useState(shot?.prompt ?? "");
  const [voiceover, setVoiceover] = useState(shot?.voiceover ?? "");
  const [ambience, setAmbience] = useState(shot?.ambience ?? "");
  const [title, setTitle] = useState(shot?.title ?? "");
  const [durationSec, setDurationSec] = useState(shot?.durationSec ?? 5);
  const [saveState, setSaveState] = useState<"idle" | "uploading" | "done">("idle");
  const [saveError, setSaveError] = useState("");
  const [rawScript, setRawScript] = useState<string | null>(null);

  /**
   * 切換分鏡時把欄位換成那一鏡的內容（本地編輯中的草稿刻意丟棄——
   * 保留它會讓人在第 3 鏡看到第 2 鏡沒存的字，比丟掉更難解釋）。
   *
   * 依賴只跟 `shot?.id`，不跟各欄位的伺服器值：同一列的環境音／旁白在別處
   * （分鏡表的單格工作室）也改得動，跟著伺服器值重設等於「別人存檔時，
   * 你在這裡打到一半的提示詞會被清掉」。切鏡才重設，就是這段註解原本的意圖。
   */
  useEffect(() => {
    setPrompt(shot?.prompt ?? "");
    setVoiceover(shot?.voiceover ?? "");
    setAmbience(shot?.ambience ?? "");
    setTitle(shot?.title ?? "");
    setDurationSec(shot?.durationSec ?? 5);
    setSaveState("idle");
    setSaveError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot?.id]);

  const invalidateScenes = () => { void utils.scenes.listByProject.invalidate({ projectId }); };

  const update = trpc.scenes.update.useMutation({ onSuccess: invalidateScenes });
  const addDraft = trpc.scenes.addDraft.useMutation({ onSuccess: invalidateScenes });
  const setVisual = trpc.scenes.setVisualFromAsset.useMutation({ onSuccess: invalidateScenes });
  const suggest = trpc.director.suggest.useMutation();
  const split = trpc.director.splitScript.useMutation({
    onSuccess: (data) => {
      // 有截斷就把原文留著：尾段沒拆進來這件事收掉面板等於沒講
      if (!data?.truncation) setRawScript(null);
      invalidateScenes();
    },
  });

  /** 白板 → PNG → 素材庫 → 綁成這一鏡的畫面 */
  const saveBoardToShot = async () => {
    if (!shot || boardEmpty) return;
    setSaveState("uploading");
    setSaveError("");
    try {
      const exported = await exportBoard();
      if (!exported) throw new Error("白板匯出失敗");
      const form = new FormData();
      form.append("projectId", projectId);
      form.append("file", new File([exported.blob], boardFileName(shot.title), { type: "image/png" }));
      const res = await fetch("/api/upload", { method: "POST", body: form, credentials: "same-origin" });
      const data = (await res.json()) as { ok?: boolean; error?: string; asset?: { id: string } };
      if (!res.ok || !data.ok || !data.asset) throw new Error(data.error ?? `上傳失敗（${res.status}）`);
      await setVisual.mutateAsync({ sceneId: shot.id, assetId: data.asset.id });
      void utils.projects.assets.invalidate({ projectId });
      setSaveState("done");
      onBoardSaved(shot.id);
    } catch (err) {
      setSaveState("idle");
      setSaveError(err instanceof Error ? err.message : "存成畫面失敗——請檢查網路後重試");
    }
  };

  const dirty =
    !!shot &&
    (title !== shot.title ||
      prompt !== (shot.prompt ?? "") ||
      voiceover !== (shot.voiceover ?? "") ||
      ambience !== (shot.ambience ?? "") ||
      durationSec !== shot.durationSec);

  return (
    <div className="studio-ai" data-mode={layout.mode}>
      <Card as="section" variant="quiet" data-fb="創作室・這一鏡">
        <h3 className="studio-ai__title">
          <Icon name="Clapperboard" size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          這一鏡
        </h3>
        {!shot ? (
          <Hint layer="always">
            還沒選分鏡。白板上畫的東西會存成「自由塗鴉」，選一鏡之後才能把手稿存成那一鏡的畫面。
          </Hint>
        ) : (
          <>
            <label htmlFor="studio-shot-title">標題</label>
            <input id="studio-shot-title" value={title} maxLength={SCRIPT_TITLE_MAX} disabled={!canEdit} onChange={(e) => setTitle(e.target.value)} />

            <label htmlFor="studio-shot-duration">秒數</label>
            <input
              id="studio-shot-duration"
              type="number"
              min={1}
              max={60}
              value={durationSec}
              disabled={!canEdit}
              onChange={(e) => setDurationSec(Math.min(60, Math.max(1, Number(e.target.value) || 1)))}
            />

            <label htmlFor="studio-shot-prompt">畫面（生成提示詞）</label>
            <textarea
              id="studio-shot-prompt"
              rows={layout.mode === "lite" ? 3 : 5}
              value={prompt}
              disabled={!canEdit}
              placeholder="這一鏡要看到什麼：主體、動作、鏡位、光線⋯⋯"
              onChange={(e) => setPrompt(e.target.value)}
            />

            <label htmlFor="studio-shot-voiceover">旁白</label>
            <textarea
              id="studio-shot-voiceover"
              rows={2}
              value={voiceover}
              maxLength={SCRIPT_VOICEOVER_MAX}
              disabled={!canEdit}
              onChange={(e) => setVoiceover(e.target.value)}
            />

            {/* 環境音：分鏡的第三軌（畫面／旁白／環境音）。這裡只編描述——
                真的要生成音效請到分鏡表的單格工作室「環境音」分頁，
                那裡有模型選擇、預估點數與試聽，不在創作室重做一套。 */}
            <label htmlFor="studio-shot-ambience">環境音（這一鏡聽得到什麼）</label>
            <textarea
              id="studio-shot-ambience"
              rows={2}
              value={ambience}
              maxLength={SCRIPT_AMBIENCE_MAX}
              disabled={!canEdit}
              placeholder="例：遠處鐘聲，細微鳥鳴，風吹過樹葉（可留白＝這鏡沒有環境音）"
              onChange={(e) => setAmbience(e.target.value)}
            />
            <Hint>寫的是聲音本身、不是台詞。存好之後到單格工作室的「環境音」分頁就能生成。</Hint>

            <div className="studio-ai__actions">
              <Button
                size="sm"
                variant="primary"
                disabled={!canEdit || !dirty || update.isPending}
                onClick={() =>
                  update.mutate({ sceneId: shot.id, title: title.trim() || shot.title, durationSec, prompt, voiceover, ambience })
                }
              >
                {update.isPending ? "儲存中…" : dirty ? "儲存這一鏡" : "已儲存 ✓"}
              </Button>
              <Button
                size="sm"
                variant="tonal"
                disabled={!canEdit || boardEmpty || saveState === "uploading"}
                onClick={() => { void saveBoardToShot(); }}
              >
                <Icon name="Image" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                {saveState === "uploading" ? "存入中…" : "把白板存成這一鏡的畫面"}
              </Button>
            </div>
            {boardEmpty && <Hint>白板還是空的——畫幾筆之後就能把手稿存成這一鏡的畫面（進素材庫，可再換回舊版本）。</Hint>}
            {saveState === "done" && <Meta role="status" style={{ color: "var(--success-ink)" }}>已存成這一鏡的畫面 ✓</Meta>}
            {saveError && <p className="error" role="alert">{saveError}</p>}
            {update.error && <p className="error" role="alert">儲存失敗：{update.error.message}</p>}
          </>
        )}
      </Card>

      <Card as="section" variant="quiet" data-fb="創作室・AI 導演建議">
        <h3 className="studio-ai__title">
          <Icon name="Sparkles" size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          想不到怎麼描述
        </h3>
        <Button size="sm" variant="tonal" disabled={!canEdit || suggest.isPending} onClick={() => suggest.mutate({ projectId })}>
          {suggest.isPending ? "AI 想中…" : "讓 AI 依專案背景給 3 個畫面建議"}
        </Button>
        {suggest.error && <p className="error" role="alert">{suggest.error.message}</p>}
        {suggest.data?.limitNotice && <Hint layer="always" role="status">{suggest.data.limitNotice}</Hint>}
        {suggest.data && (
          <ul className="studio-ai__suggestions">
            {suggest.data.suggestions.map((s, i) => (
              <li key={`${s.title}-${i}`}>
                <b>{s.title}</b>
                <p>{s.prompt}</p>
                <span className="studio-ai__suggestion-actions">
                  {shot && (
                    <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => setPrompt(s.prompt)}>
                      填進這一鏡
                    </Button>
                  )}
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
            {suggest.data.fallback ? "AI 暫時沒回應，先給你一組示範方向。" : "示範模式：這是範例建議，不是 AI 生成的。"}
          </Meta>
        )}
      </Card>

      <Card as="section" variant="quiet" data-fb="創作室・拆分鏡">
        <h3 className="studio-ai__title">
          <Icon name="FileText" size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          已經有腳本
        </h3>
        {rawScript === null ? (
          <Button size="sm" variant="tonal" disabled={!canEdit} onClick={() => setRawScript("")}>
            貼腳本，一次拆成整份分鏡
          </Button>
        ) : (
          <>
            <label htmlFor="studio-raw-script">貼上腳本（AI 會切成一幕一幕，接在現有分鏡後面）</label>
            <textarea
              id="studio-raw-script"
              rows={6}
              value={rawScript}
              onChange={(e) => setRawScript(e.target.value)}
              placeholder="貼上完整腳本或開示稿；空白行分段。留空則改用知識庫裡的腳本。"
            />
            <div className="studio-ai__actions">
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
              <Hint layer="always" role="status" style={{ color: "var(--gold-ink)" }}>
                腳本過長，這次只送了前 {split.data.truncation.sentChars.toLocaleString()} 字
                （共 {split.data.truncation.totalChars.toLocaleString()} 字）——尾段沒有拆進來。
                刪掉已拆好的前段，再按一次就能接著拆。
              </Hint>
            )}
          </>
        )}
        <Hint>拆出來的是草稿分鏡（含建議畫面與旁白），不會動到現有的鏡，也不會自動出圖。</Hint>
      </Card>
    </div>
  );
}
