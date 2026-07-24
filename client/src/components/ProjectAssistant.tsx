import { useMemo, useRef, useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { ConfirmButton } from "./interactions";

/** 助手提議的動作（與後端 assistant.ask 回傳對齊）：確認後原樣送 runAction 執行 */
type Action =
  // sceneNo/sceneTitle 只給前端顯示用（換模型後重建「為第 N 鏡「標題」」），toPayload 會丟掉
  | { type: "generate"; label: string; prompt: string; modelId: string; sceneId?: string; sceneNo?: number; sceneTitle?: string }
  | { type: "update_scene"; label: string; sceneId: string; field: "title" | "voiceover" | "durationSec"; value: string }
  | { type: "submit_approval"; label: string; sceneId: string }
  | { type: "create_scene"; label: string; title: string; voiceover?: string; durationSec?: number; prompt?: string }
  | { type: "run_workflow"; label: string; presetId: string; prompt: string }
  | { type: "split_script"; label: string; script: string }
  // plan_agent：把目標交給 AI 代理排計畫（確認後也只排計畫——免費；執行另在代理執行區核准估點）
  | { type: "plan_agent"; label: string; goal: string };

type Turn = { role: "you" | "ai"; text: string; actions?: Action[]; steps?: string[] };

/** 助手回答核心的結構（tRPC ask 與 SSE done 事件共用形狀） */
type AskResult = { answer: string; actions: Action[]; steps: string[]; mock: boolean; fallback: boolean };
/** SSE 串流的「思考過程」事件：思考中／正在查什麼／查到什麼 */
type ThinkEvent = { phase: "thinking" | "lookup" | "step"; text: string };

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

/** 送 runAction 的乾淨 payload（去掉只給人看的 label／sceneNo／sceneTitle） */
function toPayload(a: Action) {
  if (a.type === "generate") return { type: "generate" as const, prompt: a.prompt, modelId: a.modelId, sceneId: a.sceneId };
  if (a.type === "update_scene") return { type: "update_scene" as const, sceneId: a.sceneId, field: a.field, value: a.value };
  if (a.type === "create_scene") return { type: "create_scene" as const, title: a.title, voiceover: a.voiceover, durationSec: a.durationSec, prompt: a.prompt };
  if (a.type === "run_workflow") return { type: "run_workflow" as const, presetId: a.presetId, prompt: a.prompt };
  if (a.type === "split_script") return { type: "split_script" as const, script: a.script };
  if (a.type === "plan_agent") return { type: "plan_agent" as const, goal: a.goal };
  return { type: "submit_approval" as const, sceneId: a.sceneId };
}

/** 綁分鏡的生成只允許「能填進分鏡格」的模型：文字（LLM）成品不入分鏡、配樂（text-to-audio）沒有專屬槽會覆蓋旁白 */
const sceneFillable = (m: GenModel) => m.kind !== "text" && m.category !== "text-to-audio";

/** 依模態（categoryLabel）把模型聚合成下拉分組（保留後端已排好的 flagship→economy→budget 次序） */
function buildGroups(list: GenModel[]): Array<{ label: string; items: GenModel[] }> {
  const groups: Array<{ label: string; items: GenModel[] }> = [];
  for (const m of list) {
    let g = groups.find((x) => x.label === m.categoryLabel);
    if (!g) { g = { label: m.categoryLabel, items: [] }; groups.push(g); }
    g.items.push(m);
  }
  return groups;
}

/** 解析一段 SSE 區塊（以空行分隔）為 {event, data}；data 為 JSON.parse 後的物件（壞掉回 null） */
function parseSse(chunk: string): { event: string; data: unknown } {
  let event = "";
  const dataLines: string[] = [];
  for (const line of chunk.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  const raw = dataLines.join("\n");
  let data: unknown = null;
  if (raw) { try { data = JSON.parse(raw); } catch { data = null; } }
  return { event, data };
}

/**
 * AI 專案助手（進階版）：問專案進度/生成/分鏡/審批，並可「提議」動作。
 * 安全：任何花點數或改資料的動作都用 ConfirmButton，使用者按確認才真的執行。
 * 思考過程：問答走 SSE 串流，把「思考中／正在查什麼／查到什麼」即時逐筆呈現；串流不可用時自動退回 tRPC 一次性問答。
 * 收起／清除：對話可整段收起（省版面、不丟執行中狀態）或一鍵清空重來；生成動作可在執行前自己換模型（多模態）。
 */
export function ProjectAssistant({ projectId, embedded = false }: { projectId: string; embedded?: boolean }) {
  const utils = trpc.useUtils();
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  // 思考過程串流狀態：active＝正在問答中，events＝已收到的思考步驟（逐筆追加即時顯示）
  const [thinking, setThinking] = useState<{ active: boolean; events: ThinkEvent[] }>({ active: false, events: [] });
  // 已執行的提議動作鍵（turnIndex:actionIndex）＋正在執行中的鍵——停用「已執行」的按鈕，避免重複點擊
  const [executed, setExecuted] = useState<Set<string>>(new Set());
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  // 使用者在執行前自選的模型（動作鍵 → 模型 id）：只影響 generate 動作，覆蓋助手原提議的 modelId
  const [modelOverride, setModelOverride] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const push = (t: Turn) => {
    setTurns((prev) => [...prev, t]);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
  };
  const bumpScroll = () => requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));

  // 助手可代操的多模態生成模型（免來源），供「換模型」下拉；載入失敗就沿用助手原提議，不擋流程
  const genModels = trpc.assistant.generateModels.useQuery(undefined, { staleTime: 5 * 60_000 });
  const allModels = useMemo(() => (genModels.data ?? []) as GenModel[], [genModels.data]);
  const modelById = useMemo(() => {
    const map = new Map<string, GenModel>();
    for (const m of allModels) map.set(m.id, m);
    return map;
  }, [allModels]);
  // 下拉分組：全部（未綁分鏡的 generate 可用）／可填分鏡（綁分鏡時只露這些，排除 LLM／配樂）
  const allGroups = useMemo(() => buildGroups(allModels), [allModels]);
  const sceneGroups = useMemo(() => buildGroups(allModels.filter(sceneFillable)), [allModels]);

  const run = trpc.assistant.runAction.useMutation({
    onSuccess: (r) => {
      // 動作可能改了生成/分鏡/審批/額度——讓相關畫面重新抓（create_scene、split_script 建的新分鏡由 scenes.invalidate 涵蓋）
      utils.generation.invalidate();
      utils.scenes.invalidate();
      utils.approvals.invalidate();
      utils.quota.invalidate();
      // 工作流啟動後讓工作流卡立刻看到新 run（粗粒度整組 invalidate 即可，卡片自己會輪詢推進）
      if (r.kind === "run_workflow") utils.workflows.invalidate();
      // 代理排完計畫：讓下方「代理執行」立刻出現待核准的計畫（統一入口的目標→計畫→核准動線）
      if (r.kind === "plan_agent") utils.agents.invalidate();
      push({ role: "ai", text: `✓ ${r.message}` });
    },
    onError: (e) => push({ role: "ai", text: `動作沒成功：${e.message}` }),
  });

  // tRPC 一次性問答：串流不可用時的退路（onSuccess/onError 直接補一則 AI 回覆）
  const ask = trpc.assistant.ask.useMutation({
    onSuccess: (r) => push({ role: "ai", text: r.answer, actions: r.actions as Action[], steps: r.steps }),
    onError: (e) => push({ role: "ai", text: e.message }),
  });

  const busy = thinking.active || ask.isPending;

  /** 串流問答：讀 SSE 逐筆更新思考過程，done 補上 AI 回覆。回傳 true＝已處理（含 error），false＝請退回 tRPC。 */
  async function askViaStream(message: string): Promise<boolean> {
    let handled = false;
    try {
      const res = await fetch("/api/assistant/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, message }),
      });
      if (!res.ok || !res.body) return false; // 串流不可用（舊瀏覽器/代理擋 SSE/驗證失敗）→ 退回 tRPC
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) >= 0) {
          const { event, data } = parseSse(buf.slice(0, sep));
          buf = buf.slice(sep + 2);
          if (event === "step" && data) {
            const ev = data as ThinkEvent;
            setThinking((t) => ({ active: true, events: [...t.events, ev] }));
            bumpScroll();
          } else if (event === "done" && data) {
            handled = true;
            const r = data as AskResult;
            push({ role: "ai", text: r.answer, actions: r.actions, steps: r.steps });
          } else if (event === "error") {
            handled = true; // 終局錯誤：已處理，不要再退回 tRPC 重跑
            push({ role: "ai", text: (data as { message?: string })?.message || "AI 助手暫時沒回應，請稍後再試" });
          }
          // event === "open" 只是開流訊號，忽略
        }
      }
      return handled;
    } catch {
      return false; // 網路/讀取中斷 → 退回 tRPC
    }
  }

  const send = async () => {
    const m = input.trim();
    if (!m || busy) return;
    push({ role: "you", text: m });
    setInput("");
    setThinking({ active: true, events: [] });
    const handled = await askViaStream(m);
    setThinking({ active: false, events: [] });
    if (!handled) ask.mutate({ projectId, message: m }); // 串流沒完成 → 一次性問答補上（免費，不重複扣點）
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

  /** 生成動作的完整說明（按鈕臉＋確認框共用，換模型後三者一致）：有 info 就用實際會送的模型與估點重建；否則退回後端原 label */
  const genLabel = (act: Extract<Action, { type: "generate" }>, info?: GenModel): string => {
    if (!info) return act.label;
    return act.sceneNo
      ? `用 ${info.label} 為第 ${act.sceneNo} 鏡${act.sceneTitle ? `「${act.sceneTitle}」` : ""}生成（${info.points} 點）`
      : `用 ${info.label} 生成：${act.prompt.slice(0, 24)}…（${info.points} 點）`;
  };

  const thinkIcon = (phase: ThinkEvent["phase"]): "Loader" | "Search" | "Check" =>
    phase === "step" ? "Check" : phase === "lookup" ? "Search" : "Loader";

  // 四合一（專案 AI 代理系統）分頁模式：外殼與標題由 AiHub 提供；「收起」由分頁切換取代，不再另設
  const showCollapse = !embedded;
  const body = (
    <>
      {(!embedded || turns.length > 0) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          {!embedded && (
            <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
              <Icon name="Sparkles" size={18} style={{ color: "var(--primary-ink)" }} /> AI 專案助手
            </h2>
          )}
          <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
            {turns.length > 0 && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                title="清空這段對話，重新開始"
                onClick={clear}
                disabled={busy || pendingKey !== null}
              >
                <Icon name="Trash2" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />清除
              </button>
            )}
            {showCollapse && (
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
            )}
          </div>
        </div>
      )}

      {/* 收起時顯示提示；本體恆掛在 DOM（用 hidden 切換）——aria-controls 不懸空，執行中/展開中的動作狀態也不會被卸載清掉 */}
      {showCollapse && collapsed && (
        <p className="hint" style={{ marginTop: 8 }}>
          助手已收起{turns.length > 0 ? `（保留 ${turns.length} 則對話）` : ""}{busy ? "・仍在思考中" : ""}。點「展開」繼續。
        </p>
      )}

      <div id="sec-assistant-body" hidden={collapsed}>
        <p className="hint" style={{ marginTop: 4 }}>
          一個對話統包：<b>問</b>（進度、還沒審的分鏡、該用哪個模型…，我會<b>邊想邊查</b>素材庫／分鏡／生成紀錄／模型目錄／<b>資料庫</b>，唯讀）、<b>發想</b>（要分鏡 idea 我直接給，並可一鍵存成草稿）、<b>拆分鏡</b>（貼腳本進來）、<b>下目標</b>（多步驟目標我會交給代理排計畫，你核准估點後由伺服器背景逐步執行）。任何花點數或改資料的動作都要你按確認；提問本身由 NVIDIA NIM 免費額度驅動，不扣點。
        </p>

        {/* 快速開場：問答／發想／下目標都從同一個入口——點一顆帶入輸入框，按「問」才送出 */}
        {turns.length === 0 && !thinking.active && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {[
              "這個專案進度到哪？",
              "給我 3 個分鏡 idea",
              "把知識庫的腳本拆成分鏡，並為每一鏡生成畫面",
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

        {(turns.length > 0 || thinking.active) && (
          // role="log"＋aria-live：AI 回覆與思考步驟都是非同步 push 進來的，沒有活躍區報讀器會完全靜音
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
                {/* 多步工具透明化：助手回答前查了什麼一行列給使用者看（歷史留存；即時過程見下方思考面板） */}
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
                      // 綁分鏡的 generate 只讓換到「能填進分鏡格」的模型；未綁分鏡可換任何多模態模型
                      const groups = gen ? (gen.action.sceneId ? sceneGroups : allGroups) : [];
                      const chosenId = gen?.action.modelId ?? "";
                      const chosenInGroups = groups.some((g) => g.items.some((m) => m.id === chosenId));
                      // 生成動作的顯示文字：換模型後由 genLabel 依實際會送的模型＋估點重建（按鈕臉＋確認框同源）
                      const faceLabel = gen ? genLabel(gen.action, gen.info) : payloadAct.label;
                      const confirmMsg =
                        payloadAct.type === "generate"
                          ? `執行「${gen ? genLabel(gen.action, gen.info) : payloadAct.label}」？${gen?.info ? "" : "（點數見上方說明）"}`
                          : payloadAct.type === "run_workflow"
                            ? `執行「${payloadAct.label}」？各步驟會分別扣點。`
                            : payloadAct.type === "split_script"
                              ? `執行「${payloadAct.label}」？會呼叫 AI 導演拆分鏡（免費）。`
                              : payloadAct.type === "plan_agent"
                                ? `把這個目標交給 AI 代理？只會排出逐步計畫與估點（免費）——你在「代理執行」核准後才會開始花點執行。`
                                : `執行「${payloadAct.label}」？`;
                      return (
                        <div key={j} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {/* 換模型（多模態）：只在 generate 動作出現，執行前可改用哪個模型／模態 */}
                          {gen && !isDone && (
                            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-11)", color: "var(--fg-secondary)" }}>
                              <Icon name="SlidersHorizontal" size={12} /> 模型
                              <select
                                aria-label="選擇生成模型"
                                value={chosenId}
                                disabled={isRunning || genModels.isLoading || groups.length === 0}
                                onChange={(e) => setModelOverride((prev) => ({ ...prev, [actKey]: e.target.value }))}
                                style={{ fontSize: "var(--fs-11)", padding: "2px 4px", maxWidth: 260 }}
                              >
                                {/* 目前選定的 id 不在可選清單（助手提議了不適用此分鏡的模型／清單未載入）時補一顆，確保 select 不空白 */}
                                {!chosenInGroups && (
                                  <option value={chosenId}>
                                    {modelById.get(chosenId)?.label ?? chosenId}{gen.action.sceneId ? "（不適用此分鏡）" : ""}
                                  </option>
                                )}
                                {groups.map((g) => (
                                  <optgroup key={g.label} label={g.label}>
                                    {g.items.map((m) => (
                                      <option key={m.id} value={m.id}>
                                        {m.tierLabel}・{m.label} — {m.points} 點{m.recommended ? " 推薦" : ""}{m.verified ? "" : " 未驗證"}
                                      </option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                            </label>
                          )}
                          {/* 選定模型的特性一行說明（幫使用者判斷該不該換；含推薦／未驗證標示，與挑選器一致） */}
                          {gen?.info && !isDone && (
                            <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-secondary)", maxWidth: 320, lineHeight: 1.4 }}>
                              {gen.info.recommended && <span className="chip on" style={{ marginRight: 4 }}>推薦</span>}
                              {gen.info.strengths}
                              {!gen.info.verified && <span style={{ color: "var(--gold-ink)" }}>（新模型 ID，首跑校準；失敗自動退點）</span>}
                            </div>
                          )}
                          <ConfirmButton
                            triggerClassName="btn-tonal btn-sm"
                            disabled={isDone || isRunning}
                            title={isDone ? "此動作已執行" : "確認執行助手提議的動作"}
                            message={confirmMsg}
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
                                          : payloadAct.type === "plan_agent" ? "Film"
                                            : "Pencil"
                              }
                              size={13}
                              style={{ verticalAlign: "-2px", marginRight: 4 }}
                            />
                            {isDone ? "已執行" : faceLabel}
                          </ConfirmButton>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}

            {/* 即時思考過程：串流進行中逐筆呈現「思考中／正在查什麼／查到什麼」 */}
            {thinking.active && (
              <div style={{ alignSelf: "flex-start", maxWidth: "90%" }} role="status">
                <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-secondary)", marginBottom: 2 }}>助手</div>
                <div style={{ background: "var(--card2)", border: "1px solid var(--border-soft)", borderRadius: "var(--r-12)", padding: "8px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-12)", fontWeight: 600, color: "var(--fg-secondary)" }}>
                    <Icon name="Sparkles" size={13} style={{ color: "var(--primary-ink)" }} /> 思考過程
                  </div>
                  {thinking.events.length === 0 ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-12)", color: "var(--fg-secondary)" }}>
                      <Icon name="Loader" size={12} className="spin" /> 連線中…
                    </div>
                  ) : (
                    thinking.events.map((e, k) => {
                      const isLast = k === thinking.events.length - 1;
                      const active = isLast && e.phase !== "step";
                      return (
                        <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-12)", color: "var(--fg-secondary)" }}>
                          <Icon name={thinkIcon(e.phase)} size={12} className={active ? "spin" : undefined} style={e.phase === "step" ? { color: "var(--success-ink, var(--primary-ink))" } : undefined} />
                          {e.text}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "flex-start" }}>
          <input
            aria-label="問 AI 專案助手"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void send(); } }}
            placeholder="問進度、要 idea、貼腳本、下目標…例：把腳本拆成分鏡並逐鏡出圖"
            disabled={busy}
            style={{ flex: 1 }}
          />
          <button className="primary" onClick={() => void send()} disabled={busy || !input.trim()}>
            {busy ? "思考中…" : "問"}
          </button>
        </div>
      </div>
    </>
  );

  if (embedded) return <div data-fb="AI 助手">{body}</div>;
  return (
    <section className="card" data-fb="AI 助手" id="sec-assistant">
      {body}
    </section>
  );
}
