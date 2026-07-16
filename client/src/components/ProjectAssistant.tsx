import { useRef, useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { ConfirmButton } from "./interactions";

/** 助手提議的動作（與後端 assistant.ask 回傳對齊）：確認後原樣送 runAction 執行 */
type Action =
  | { type: "generate"; label: string; prompt: string; modelId: string; sceneId?: string }
  | { type: "update_scene"; label: string; sceneId: string; field: "title" | "voiceover" | "durationSec"; value: string }
  | { type: "submit_approval"; label: string; sceneId: string }
  | { type: "create_scene"; label: string; title: string; voiceover?: string; durationSec?: number }
  | { type: "run_workflow"; label: string; presetId: string; prompt: string };

type Turn = { role: "you" | "ai"; text: string; actions?: Action[] };

/** 送 runAction 的乾淨 payload（去掉只給人看的 label） */
function toPayload(a: Action) {
  if (a.type === "generate") return { type: "generate" as const, prompt: a.prompt, modelId: a.modelId, sceneId: a.sceneId };
  if (a.type === "update_scene") return { type: "update_scene" as const, sceneId: a.sceneId, field: a.field, value: a.value };
  if (a.type === "create_scene") return { type: "create_scene" as const, title: a.title, voiceover: a.voiceover, durationSec: a.durationSec };
  if (a.type === "run_workflow") return { type: "run_workflow" as const, presetId: a.presetId, prompt: a.prompt };
  return { type: "submit_approval" as const, sceneId: a.sceneId };
}

/**
 * AI 專案助手（進階版）：問專案進度/生成/分鏡/審批，並可「提議」動作。
 * 安全：任何花點數或改資料的動作都用 ConfirmButton，使用者按確認才真的執行。
 */
export function ProjectAssistant({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  // 已執行的提議動作鍵（turnIndex:actionIndex）＋正在執行中的鍵——停用「已執行」的按鈕，避免重複點擊
  // 重跑動作（generate 重複扣點／submit_approval 重複建版）；per-button 停用而非全域鎖住所有按鈕
  const [executed, setExecuted] = useState<Set<string>>(new Set());
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const push = (t: Turn) => {
    setTurns((prev) => [...prev, t]);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
  };

  const ask = trpc.assistant.ask.useMutation({
    onSuccess: (r) => push({ role: "ai", text: r.answer, actions: r.actions as Action[] }),
    onError: (e) => push({ role: "ai", text: e.message }),
  });
  const run = trpc.assistant.runAction.useMutation({
    onSuccess: (r) => {
      // 動作可能改了生成/分鏡/審批/額度——讓相關畫面重新抓（create_scene 由 scenes.invalidate 涵蓋）
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

  return (
    <section className="card" data-fb="AI 助手" id="sec-assistant">
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="Sparkles" size={18} style={{ color: "var(--primary-ink)" }} /> AI 專案助手
      </h2>
      <p className="hint" style={{ marginTop: -4 }}>
        問我這個專案的進度、生成了什麼、哪些分鏡還沒審…；我也能<b>提議動作</b>（生成／新增分鏡／改分鏡／送審／跑工作流），你按確認才執行。每次提問約 1 點。
      </p>

      {turns.length > 0 && (
        <div ref={scrollRef} style={{ maxHeight: 320, overflowY: "auto", margin: "12px 0", display: "flex", flexDirection: "column", gap: 10 }}>
          {turns.map((t, i) => (
            <div key={i} style={{ alignSelf: t.role === "you" ? "flex-end" : "flex-start", maxWidth: "90%" }}>
              <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-secondary)", marginBottom: 2, textAlign: t.role === "you" ? "right" : "left" }}>
                {t.role === "you" ? "你" : "助手"}
              </div>
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
                    return (
                      <ConfirmButton
                        key={j}
                        triggerClassName="btn-tonal btn-sm"
                        disabled={isDone || isRunning}
                        title={isDone ? "此動作已執行" : "確認執行助手提議的動作"}
                        message={
                          act.type === "generate"
                            ? `執行「${act.label}」？會依模型扣點。`
                            : act.type === "run_workflow"
                              ? `執行「${act.label}」？各步驟會分別扣點。`
                              : `執行「${act.label}」？`
                        }
                        confirmLabel="執行"
                        onConfirm={async () => {
                          setPendingKey(actKey);
                          try {
                            await run.mutateAsync({ projectId, action: toPayload(act) });
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
                            act.type === "generate" ? "Sparkles"
                              : act.type === "submit_approval" ? "Check"
                                : act.type === "create_scene" ? "Plus"
                                  : act.type === "run_workflow" ? "Play"
                                    : "Pencil"
                          }
                          size={13}
                          style={{ verticalAlign: "-2px", marginRight: 4 }}
                        />
                        {isDone ? "已執行" : act.label}
                      </ConfirmButton>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {ask.isPending && <div className="hint" style={{ fontSize: "var(--fs-13)" }}>助手思考中…</div>}
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
    </section>
  );
}
