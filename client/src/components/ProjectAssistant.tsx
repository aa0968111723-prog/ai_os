import { useMemo, useRef, useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { ConfirmButton } from "./interactions";

/** 助手提議的動作（與後端 assistant.ask 回傳對齊）：確認後原樣送 runAction 執行 */
type Action =
  | { type: "generate"; label: string; prompt: string; modelId: string; sceneId?: string }
  | { type: "update_scene"; label: string; sceneId: string; field: "title" | "voiceover" | "durationSec"; value: string }
  | { type: "submit_approval"; label: string; sceneId: string }
  | { type: "create_scene"; label: string; title: string; voiceover?: string; durationSec?: number }
  | { type: "run_workflow"; label: string; presetId: string; prompt: string }
  | { type: "split_script"; label: string; script: string };

type Turn = { role: "you" | "ai"; text: string; actions?: Action[]; steps?: string[] };

/** assistant.generateModels 的一筆（助手可代操、免來源的多模態生成模型） */
type GenModel = {
  id: string;
  label: string;
  category: string;
  categoryLabel: string;
  kind: string;
  tierLabel: string;
  points: number;
  strengths: string;
  bestFor: string;
  verified: boolean;
  recommended: boolean;
};

/** 送 runAction 的乾淨 payload（去掉只給人看的 label） */
function toPayload(a: Action) {
  if (a.type === "generate") return { type: "generate" as const, prompt: a.prompt, modelId: a.modelId, sceneId: a.sceneId };
  if (a.type === "update_scene") return { type: "update_scene" as const, sceneId: a.sceneId, field: a.field, value: a.value };
  if (a.type === "create_scene") return { type: "create_scene" as const, title: a.title, voiceover: a.voiceover, durationSec: a.durationSec };
  if (a.type === "run_workflow") return { type: "run_workflow" as const, presetId: a.presetId, prompt: a.prompt };
  if (a.type === "split_script") return { type: "split_script" as const, script: a.script };
  return { type: "submit_approval" as const, sceneId: a.sceneId };
}

/**
 * AI 專案助手（進階版）：問專案進度/生成/分鏡/審批，並可「提議」動作。
 * 安全：任何花點數或改資料的動作都用 ConfirmButton，使用者按確認才真的執行。
 * 收起／清除：對話可整段收起（省版面）或一鍵清空重來；生成動作可在執行前自己換模型（多模態）。
 */
export function ProjectAssistant({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  // 已執行的提議動作鍵（turnIndex:actionIndex）＋正在執行中的鍵——停用「已執行」的按鈕，避免重複點擊
  // 重跑動作（generate 重複扣點／submit_approval 重複建版）；per-button 停用而非全域鎖住所有按鈕
  const [executed, setExecuted] = useState<Set<string>>(new Set());
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  // 使用者在執行前自選的模型（動作鍵 → 模型 id）：只影響 generate 動作，覆蓋助手原提議的 modelId
  const [modelOverride, setModelOverride] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const push = (t: Turn) => {
    setTurns((prev) => [...prev, t]);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
  };

  // 助手可代操的多模態生成模型（免來源），供「換模型」下拉；載入失敗就沿用助手原提議，不擋流程
  const genModels = trpc.assistant.generateModels.useQuery(undefined, { staleTime: 5 * 60_000 });
  const modelById = useMemo(() => {
    const map = new Map<string, GenModel>();
    for (const m of (genModels.data ?? []) as GenModel[]) map.set(m.id, m);
    return map;
  }, [genModels.data]);
  // 下拉分組：依模態（categoryLabel）聚合，讓「文生圖／文生影片／文生語音…」一目了然
  const modelGroups = useMemo(() => {
    const groups: Array<{ label: string; items: GenModel[] }> = [];
    for (const m of (genModels.data ?? []) as GenModel[]) {
      let g = groups.find((x) => x.label === m.categoryLabel);
      if (!g) { g = { label: m.categoryLabel, items: [] }; groups.push(g); }
      g.items.push(m);
    }
    return groups;
  }, [genModels.data]);

  const ask = trpc.assistant.ask.useMutation({
    onSuccess: (r) => push({ role: "ai", text: r.answer, actions: r.actions as Action[], steps: r.steps }),
    onError: (e) => push({ role: "ai", text: e.message }),
  });
  const run = trpc.assistant.runAction.useMutation({
    onSuccess: (r) => {
      // 動作可能改了生成/分鏡/審批/額度——讓相關畫面重新抓（create_scene、split_script 建的新分鏡由 scenes.invalidate 涵蓋）
      utils.generation.invalidate();
      utils.scenes.invalidate();
      utils.approvals.invalidate();
      utils.quota.invalidate();
      // 工作流啟動後讓工作流卡立刻看到新 run（粗粒度整組 invalidate 即可，卡片自己會輪詢推進）
      if (r.kind === "run_workflow") utils.workflows.invalidate();
      push({ role: "ai", text: `✓ ${r.message}` });
    },
    onError: (e) => push({ role: "ai", text: `動作沒成功：${e.message}` }),
  });

  const send = () => {
    const m = input.trim();
    if (!m || ask.isPending) return;
    push({ role: "you", text: m });
    ask.mutate({ projectId, message: m });
    setInput("");
  };

  // 一鍵清除：清對話與所有連帶暫存（已執行標記、換模型選擇），回到冷啟動可再問
  const clear = () => {
    setTurns([]);
    setExecuted(new Set());
    setModelOverride({});
    setPendingKey(null);
  };

  /** generate 動作套上使用者選的模型（沒選就用助手原提議）；回傳實際要送出的動作與展示用模型資訊 */
  const effectiveGenerate = (act: Extract<Action, { type: "generate" }>, actKey: string) => {
    const chosenId = modelOverride[actKey] ?? act.modelId;
    const info = modelById.get(chosenId);
    return { action: { ...act, modelId: chosenId }, info };
  };

  return (
    <section className="card" data-fb="AI 助手" id="sec-assistant">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
          <Icon name="Sparkles" size={18} style={{ color: "var(--primary-ink)" }} /> AI 專案助手
        </h2>
        <div style={{ display: "flex", gap: 6 }}>
          {turns.length > 0 && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              title="清空這段對話，重新開始"
              onClick={clear}
              disabled={ask.isPending || pendingKey !== null}
            >
              <Icon name="Trash2" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />清除
            </button>
          )}
          <button
            type="button"
            className="btn-ghost btn-sm"
            aria-expanded={!collapsed}
            aria-controls="sec-assistant-body"
            title={collapsed ? "展開助手" : "收起助手（省版面）"}
            onClick={() => setCollapsed((c) => !c)}
          >
            <Icon name={collapsed ? "ChevronDown" : "ChevronUp"} size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            {collapsed ? "展開" : "收起"}
          </button>
        </div>
      </div>

      {collapsed ? (
        <p className="hint" style={{ marginTop: 8 }}>
          助手已收起{turns.length > 0 ? `（保留 ${turns.length} 則對話）` : ""}。點「展開」繼續。
        </p>
      ) : (
        <div id="sec-assistant-body">
      <p className="hint" style={{ marginTop: 4 }}>
        問我這個專案的進度、生成了什麼、哪些分鏡還沒審、<b>該用哪個模型</b>…；回答前我會視需要查素材庫／分鏡／生成紀錄／模型目錄（唯讀，自動進行）。我也能<b>提議動作</b>（生成／新增分鏡／改分鏡／送審／跑工作流／貼腳本拆分鏡），你按確認才執行——生成前還能<b>自己換模型</b>（文生圖／影片／語音／音頻多模態）。提問由 NVIDIA NIM 免費額度驅動，不扣點。
      </p>

      {/* 快速提問（深度優化）：冷啟動不用想怎麼開口——點一顆帶入輸入框，按「問」才送出扣點 */}
      {turns.length === 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {[
            "這個專案進度到哪？",
            "哪些分鏡還沒過審？",
            "依目前素材與分鏡，建議下一步做什麼？",
            "幫我推薦適合本專案的生成模型",
          ].map((q) => (
            <button
              key={q}
              type="button"
              className="btn-sm"
              title="點了帶入輸入框，按「問」才送出（免費）"
              onClick={() => setInput(q)}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {turns.length > 0 && (
        // role="log"＋aria-live：AI 回覆是非同步 push 進來的，沒有活躍區報讀器會完全靜音、
        // 使用者按「問」後以為沒反應（比照 MessagePanel 的既有寫法）
        <div
          ref={scrollRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label="AI 專案助手對話"
          tabIndex={0}
          style={{ maxHeight: 320, overflowY: "auto", margin: "12px 0", display: "flex", flexDirection: "column", gap: 10 }}
        >
          {turns.map((t, i) => (
            <div key={i} style={{ alignSelf: t.role === "you" ? "flex-end" : "flex-start", maxWidth: "90%" }}>
              <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-secondary)", marginBottom: 2, textAlign: t.role === "you" ? "right" : "left" }}>
                {t.role === "you" ? "你" : "助手"}
              </div>
              {/* 多步工具透明化：助手回答前查了什麼(素材庫/分鏡/生成紀錄/模型目錄)一行列給使用者看 */}
              {t.steps && t.steps.length > 0 && (
                <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-secondary)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
                  <Icon name="Search" size={11} />{t.steps.join("、")}
                </div>
              )}
              <div
                style={{
                  background: t.role === "you" ? "var(--primary-tint)" : "var(--card2)",
                  color: t.role === "you" ? "var(--primary-ink)" : "var(--fg)",
                  border: "1px solid var(--border-soft)",
                  borderRadius: "var(--r-12)",
                  padding: "8px 12px",
                  fontSize: "var(--fs-14)",
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.6,
                }}
              >
                {t.text}
              </div>
              {t.actions && t.actions.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {t.actions.map((act, j) => {
                    const actKey = `${i}:${j}`;
                    const isDone = executed.has(actKey);
                    const isRunning = pendingKey === actKey;
                    // generate 動作套上使用者可能換過的模型；其餘動作照原樣
                    const gen = act.type === "generate" ? effectiveGenerate(act, actKey) : null;
                    const payloadAct = gen ? gen.action : act;
                    return (
                      <div key={j} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {/* 換模型（多模態）：只在 generate 動作出現，執行前可改用哪個模型／模態 */}
                        {gen && !isDone && (
                          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-11)", color: "var(--fg-secondary)" }}>
                            <Icon name="SlidersHorizontal" size={12} /> 模型
                            <select
                              aria-label="選擇生成模型"
                              value={gen.action.modelId}
                              disabled={isRunning || genModels.isLoading || modelGroups.length === 0}
                              onChange={(e) => setModelOverride((prev) => ({ ...prev, [actKey]: e.target.value }))}
                              style={{ fontSize: "var(--fs-11)", padding: "2px 4px", maxWidth: 260 }}
                            >
                              {/* 助手原提議的 id 可能不在清單（例如 llm 以外的邊界）；補一個當前選項確保能顯示 */}
                              {!modelById.has(gen.action.modelId) && (
                                <option value={gen.action.modelId}>助手建議：{gen.action.modelId}</option>
                              )}
                              {modelGroups.map((g) => (
                                <optgroup key={g.label} label={g.label}>
                                  {g.items.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.label} — {m.points} 點{m.recommended ? " 推薦" : ""}{m.verified ? "" : " 未驗證"}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          </label>
                        )}
                        {/* 選定模型的特性一行說明（幫使用者判斷該不該換） */}
                        {gen?.info && !isDone && (
                          <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-secondary)", maxWidth: 300, lineHeight: 1.4 }}>
                            {gen.info.strengths}
                          </div>
                        )}
                        <ConfirmButton
                          triggerClassName="btn-tonal btn-sm"
                          disabled={isDone || isRunning}
                          title={isDone ? "此動作已執行" : "確認執行助手提議的動作"}
                          message={
                            payloadAct.type === "generate"
                              ? `執行「用 ${gen?.info?.label ?? payloadAct.modelId} 生成」？約 ${gen?.info?.points ?? "?"} 點。`
                              : payloadAct.type === "run_workflow"
                                ? `執行「${payloadAct.label}」？各步驟會分別扣點。`
                                : payloadAct.type === "split_script"
                                  ? `執行「${payloadAct.label}」？會呼叫 AI 導演拆分鏡（免費）。`
                                  : `執行「${payloadAct.label}」？`
                          }
                          confirmLabel="執行"
                          onConfirm={async () => {
                            setPendingKey(actKey);
                            try {
                              await run.mutateAsync({ projectId, action: toPayload(payloadAct) });
                              setExecuted((prev) => new Set(prev).add(actKey));
                            } catch {
                              // onError 已在對話串提示；不標記為已執行，讓使用者可重試
                            } finally {
                              setPendingKey((k) => (k === actKey ? null : k));
                            }
                          }}
                        >
                          <Icon
                            name={
                              payloadAct.type === "generate" ? "Sparkles"
                                : payloadAct.type === "submit_approval" ? "Check"
                                  : payloadAct.type === "create_scene" ? "Plus"
                                    : payloadAct.type === "run_workflow" ? "Play"
                                      : payloadAct.type === "split_script" ? "Clapperboard"
                                        : "Pencil"
                            }
                            size={13}
                            style={{ verticalAlign: "-2px", marginRight: 4 }}
                          />
                          {isDone ? "已執行" : payloadAct.label}
                        </ConfirmButton>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {ask.isPending && <div className="hint" role="status" style={{ fontSize: "var(--fs-13)" }}>助手思考中…</div>}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "flex-start" }}>
        <input
          aria-label="問 AI 專案助手"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
          placeholder="例：這個專案進度到哪？幫我把第 1 鏡送審"
          style={{ flex: 1 }}
        />
        <button className="primary" onClick={send} disabled={ask.isPending || !input.trim()}>
          {ask.isPending ? "思考中…" : "問"}
        </button>
      </div>
        </div>
      )}
    </section>
  );
}
