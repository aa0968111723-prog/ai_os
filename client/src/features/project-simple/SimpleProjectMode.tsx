import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { Button, Card, Chip, Hint, Meta } from "../../components/ui";
import { ExportJobButton } from "../../components/ExportJobButton";
import { VisualJourney, type VisualJourneyStep } from "../../components/VisualJourney";
import { focusAndReveal } from "../../lib/scrollIntoViewForChrome";
import { isWorldviewReady, type Worldview } from "@shared/worldview";
import { parseWorldviewSafe } from "@shared/parseWorldviewSafe";
import {
  computeSimpleSteps,
  currentSimpleStepIndex,
  runningVisualCount,
  scenesNeedingVisual,
  splitScriptReadiness,
  type SimpleScene,
} from "./simpleMode";

/**
 * 簡易模式：四步一條線做完一支片。
 *
 * 設計原則（來自 2026-08-01 線上實測，證據見 docs/audit/）：
 * 1. **一個輸入框**——完整版頂部「你想完成什麼畫面？」只鏡射不送出，使用者以為壞掉；這裡每一步
 *    只有一個輸入框配一顆主按鈕。
 * 2. **不逐顆確認**——完整版拆出 4 鏡要按 4 次「存成草稿」再按 4 次「執行」，連按還會靜默丟單；
 *    這裡 split_script 一次把全部分鏡建好。
 * 3. **進度全部由伺服器資料推導**——重整、關頁、換裝置回來都看得到同一個進度（長任務要求）。
 * 4. **只呼叫既有 procedure**——不新增後端、不改完整版行為；扣點與守門仍走原本那一套。
 */
export function SimpleProjectMode({
  projectId,
  groupId,
  canEdit,
  worldview,
  onSwitchToPro,
}: {
  projectId: string;
  groupId: string;
  canEdit: boolean;
  worldview: Worldview;
  onSwitchToPro: () => void;
}) {
  const utils = trpc.useUtils();

  const scenesQ = trpc.scenes.listByProject.useQuery(
    { projectId },
    {
      // 有格子在生成時 3 秒一次（背景分頁也要跑：使用者常切走等結果，回來要看到已完成）
      refetchInterval: (q) => ((q.state.data ?? []).some((s) => (s as SimpleScene).pendingGenStatus) ? 3000 : false),
      refetchIntervalInBackground: true,
    },
  );
  const knowledgeQ = trpc.knowledge.list.useQuery({ projectId });
  const charactersQ = trpc.characters.list.useQuery({ projectId });
  const presetsQ = trpc.scenePresets.list.useQuery({ projectId });
  const imageModelsQ = trpc.models.byCategory.useQuery({ category: "text-to-image" });
  const optionsQ = trpc.options.byGroup.useQuery({ groupId });

  const scenes = (scenesQ.data ?? []) as SimpleScene[];
  const wvReady = isWorldviewReady(worldview);
  const steps = computeSimpleSteps({ worldviewReady: wvReady, scenes });
  const stepIndex = currentSimpleStepIndex(steps);
  const running = runningVisualCount(scenes);

  const journeySteps: VisualJourneyStep[] = steps.map((s, i) => ({
    id: `simple-step-${s.id}`,
    label: s.label,
    detail: s.hint,
    state: s.done ? "done" : i === stepIndex ? "current" : "upcoming",
  }));

  // ---------- 第 1 步：一句話故事 ----------
  const [logline, setLogline] = useState(worldview.logline ?? "");
  useEffect(() => {
    // 伺服器值變了（別人改／剛存好）時跟隨，但不要洗掉正在打的字
    setLogline((cur) => (cur.trim() === "" ? (worldview.logline ?? "") : cur));
  }, [worldview.logline]);

  const updateWv = trpc.projects.updateWorldview.useMutation({
    onSuccess: () => void utils.projects.get.invalidate({ id: projectId }),
  });
  const saveWorldview = (patch: Partial<Worldview>) => {
    if (!canEdit) return;
    const next = parseWorldviewSafe({ ...worldview, ...patch });
    updateWv.mutate({ id: projectId, worldview: next });
  };

  const toneOptions = (optionsQ.data ?? []).filter((o) => o.type === "tone" && o.active !== false).slice(0, 6);
  const tones = worldview.tones ?? [];
  const toggleTone = (value: string) => {
    const next = tones.includes(value) ? tones.filter((t) => t !== value) : [...tones, value].slice(0, 2);
    saveWorldview({ tones: next });
  };

  // ---------- 第 2 步：拆分鏡 ----------
  const [script, setScript] = useState("");
  const scriptPrefilled = useRef(false);
  /**
   * 知識庫已經有腳本就自動帶進來——使用者不必再貼一次（實測最常見的重複勞動）。
   * list 只回摘要，全文要另外 get，所以先挑出 id 再查一次。
   */
  const scriptDocId = useMemo(() => {
    const doc = (knowledgeQ.data ?? []).find((k) => k.kind === "script" && k.chars >= 20);
    return doc?.id ?? null;
  }, [knowledgeQ.data]);
  const scriptDocQ = trpc.knowledge.get.useQuery({ id: scriptDocId ?? "" }, { enabled: !!scriptDocId });
  useEffect(() => {
    if (scriptPrefilled.current || script.trim() !== "") return;
    const content = scriptDocQ.data?.content;
    if (content && content.trim().length >= 20) {
      setScript(content);
      scriptPrefilled.current = true;
    }
  }, [scriptDocQ.data, script]);

  const splitState = splitScriptReadiness(script);
  const runAction = trpc.assistant.runAction.useMutation({
    onSuccess: () => {
      void utils.scenes.listByProject.invalidate({ projectId });
      void utils.generation.listByProject.invalidate({ projectId });
    },
  });
  const splitPending = runAction.isPending;

  // ---------- 第 3 步：一鍵生成畫面 ----------
  const defaultModelId = useMemo(() => {
    const list = imageModelsQ.data ?? [];
    return list.find((m) => m.recommended)?.id ?? list[0]?.id ?? null;
  }, [imageModelsQ.data]);
  const characterIds = (charactersQ.data ?? []).map((c) => c.id);
  const presetIds = (presetsQ.data ?? []).map((p) => p.id);

  const generateInto = trpc.scenes.generateInto.useMutation();
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const pendingScenes = scenesNeedingVisual(scenes);

  const generateAll = async () => {
    if (!canEdit || !defaultModelId) return;
    setBatchError(null);
    setBatchBusy(true);
    try {
      // 逐格送出（不並發）：後端一格一格扣點與排隊，並發只會讓失敗更難對帳。
      for (const s of pendingScenes) {
        if (!s.prompt?.trim()) continue; // 沒有提示詞的格子跳過（拆分鏡都會帶，手動加的可能沒有）
        await generateInto.mutateAsync({
          sceneId: s.id,
          modelId: defaultModelId,
          characterIds: characterIds.slice(0, 6),
          scenePresetIds: presetIds.slice(0, 4),
          clientRequestId: crypto.randomUUID(),
        });
      }
      await utils.scenes.listByProject.invalidate({ projectId });
    } catch (e) {
      setBatchError(e instanceof Error ? e.message : "生成送出失敗");
    } finally {
      setBatchBusy(false);
    }
  };

  // ---------- 第 4 步：打包 ----------
  const withVisualCount = scenes.filter((s) => !!s.assetUrl).length;
  const allReady = scenes.length > 0 && withVisualCount === scenes.length;

  return (
    <div className="simple-project" data-fb="簡易模式">
      {/* 進行中任務常駐條：重整後照樣算得出來（狀態來自 scenes 查詢，不是前端變數） */}
      {running > 0 && (
        <Card role="status" className="simple-project__running" data-fb="進行中任務">
          <Icon name="Loader" className="spin" size={15} />
          <span style={{ fontSize: 13 }}>
            <b>{running}</b> 格畫面生成中——可以關掉這頁，完成會推播通知。
          </span>
        </Card>
      )}

      <Card as="section" className="simple-project__journey">
        <div className="simple-project__journey-head">
          <h2 style={{ margin: 0, fontSize: 18 }}>做一支片，四步就好</h2>
          <span style={{ flex: "1 1 auto" }} />
          <Button size="sm" onClick={onSwitchToPro} data-fb="切到專業模式">
            切換完整版
          </Button>
        </div>
        <VisualJourney steps={journeySteps} ariaLabel="簡易模式進度" compact />
      </Card>

      <div className="simple-project__steps">
      {/* 第 1 步 */}
      <Card as="section" className="simple-step" data-fb="簡易-故事">
        <h3 style={{ marginTop: 0 }}>1・這支片在講什麼？</h3>
        <textarea
          aria-label="一句話故事"
          value={logline}
          disabled={!canEdit}
          onFocus={(e) => focusAndReveal(e.currentTarget)}
          maxLength={500}
          rows={2}
          placeholder="例：阿明在都市喧囂中靠每日十分鐘靜坐找回內心平靜"
          onChange={(e) => setLogline(e.target.value)}
          onBlur={() => logline.trim() !== (worldview.logline ?? "") && saveWorldview({ logline: logline.trim() })}
          style={{ width: "100%" }}
        />
        {toneOptions.length > 0 && (
          <>
            <Meta style={{ display: "block", margin: "8px 0 6px" }}>挑一到兩個調性（生成時自動帶入）</Meta>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {toneOptions.map((o) => (
                <Chip
                  key={o.id}
                  onClick={canEdit ? () => toggleTone(o.value) : undefined}
                  aria-pressed={tones.includes(o.value)}
                  className={tones.includes(o.value) ? "chip--on" : undefined}
                >
                  {o.value}
                </Chip>
              ))}
            </div>
          </>
        )}
        <Hint layer="guide">其他設定（角色、場景、禁語…）都有預設值，之後想調再切完整版。</Hint>
        {updateWv.error && <p className="error">{updateWv.error.message}</p>}
      </Card>

      {/* 第 2 步 */}
      <Card as="section" className="simple-step" data-fb="簡易-拆分鏡">
        <h3 style={{ marginTop: 0 }}>2・拆成一格一格</h3>
        {scenes.length > 0 ? (
          <Meta>已經有 {scenes.length} 個分鏡了。要重拆可以到完整版調整。</Meta>
        ) : (
          <>
            <textarea
              aria-label="腳本或想法"
              value={script}
              disabled={!canEdit || splitPending}
              rows={6}
              placeholder="貼上腳本，或寫下你想拍什麼（一鏡一段最好）"
              onChange={(e) => setScript(e.target.value)}
              onFocus={(e) => focusAndReveal(e.currentTarget)}
              style={{ width: "100%" }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
              <Button
                variant="primary"
                disabled={!canEdit || !splitState.ok || splitPending}
                onClick={() => runAction.mutate({ projectId, action: { type: "split_script", script: script.trim() } })}
              >
                {splitPending ? "AI 拆分鏡中…" : "AI 幫我拆成分鏡（免費）"}
              </Button>
              {!splitState.ok && <Meta>{splitState.reason}</Meta>}
            </div>
          </>
        )}
        {runAction.error && <p className="error">{runAction.error.message}</p>}
      </Card>

      {/* 第 3 步 */}
      <Card as="section" className="simple-step simple-step--visuals" data-fb="簡易-生成畫面">
        <h3 style={{ marginTop: 0 }}>3・一鍵生成畫面</h3>
        {scenes.length === 0 ? (
          <Meta>先完成上一步，這裡就會出現一鍵出圖。</Meta>
        ) : (
          <>
            <div className="simple-scene-thumbs">
              {scenes.map((s, i) => (
                <div key={s.id} className="simple-scene-thumb">
                  <div className="simple-scene-thumb__frame">
                    {s.assetUrl ? (
                      <img src={s.assetUrl} alt={`第 ${i + 1} 鏡`} />
                    ) : s.pendingGenStatus ? (
                      <Icon name="Loader" className="spin" size={18} />
                    ) : (
                      <Meta style={{ fontSize: 11 }}>待生成</Meta>
                    )}
                  </div>
                  <Meta className="simple-scene-thumb__cap">
                    {i + 1}・{s.status === "approved" ? "已通過" : s.status === "pending" ? "待審" : "草稿"}
                  </Meta>
                </div>
              ))}
            </div>
            <div className="simple-step__actions">
              <Button
                variant="primary"
                disabled={!canEdit || batchBusy || pendingScenes.length === 0 || !defaultModelId}
                onClick={() => void generateAll()}
              >
                {batchBusy ? "送出中…" : pendingScenes.length === 0 ? "畫面都齊了" : `生成剩下 ${pendingScenes.length} 格`}
              </Button>
              <Meta>用推薦模型逐格出圖，失敗會自動退點。</Meta>
            </div>
            {batchError && <p className="error">{batchError}</p>}
          </>
        )}
      </Card>

      {/* 第 4 步 */}
      <Card as="section" className="simple-step simple-step--deliver" data-fb="簡易-交付">
        <h3 style={{ marginTop: 0 }}>4・打包交付</h3>
        {scenes.length === 0 ? (
          <Meta>還沒有分鏡。</Meta>
        ) : (
          <>
            <Meta style={{ display: "block", marginBottom: 8 }}>
              已完成 {withVisualCount}／{scenes.length} 格
            </Meta>
            <div className="simple-step__actions">
              <ExportJobButton projectId={projectId} idleLabel="打包下載交付包（.zip）" />
            </div>
            {!allReady && <Hint layer="guide">畫面齊了打包最完整；也可以先打包目前進度。</Hint>}
          </>
        )}
      </Card>
      </div>
    </div>
  );
}
