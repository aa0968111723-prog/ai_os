import { useState } from "react";
import { trpc } from "../api";

interface StepLog { note: string; status: "running" | "done" | "failed"; detail?: string }

/** 工作流:一鍵串多個模型(每步各自扣點;逐步顯示進度) */
export function WorkflowCard({ projectId }: { projectId: string }) {
  const workflows = trpc.models.workflows.useQuery();
  const utils = trpc.useUtils();
  const [wfId, setWfId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [logs, setLogs] = useState<StepLog[]>([]);
  const [running, setRunning] = useState(false);

  const wf = workflows.data?.find((w) => w.id === wfId) ?? workflows.data?.[0];

  const run = async () => {
    if (!wf || !prompt.trim() || running) return;
    setRunning(true);
    setLogs(wf.steps.map((s) => ({ note: s.note, status: "running" as const })));
    const client = utils.client;
    let prevText = "";
    let prevUrl = "";
    try {
      for (let i = 0; i < wf.steps.length; i++) {
        const step = wf.steps[i];
        // 模板:{prompt}=使用者輸入、{prev}=上一步文字結果
        const stepDef = wf.steps[i];
        const template = (workflowTemplates[wf.id]?.[i] ?? "{prompt}");
        const stepPrompt = template.replaceAll("{prompt}", prompt.trim()).replaceAll("{prev}", prevText || prompt.trim());
        const usePrev = workflowUsePrev[wf.id]?.[i] === true;
        const gen = await client.generation.submit.mutate({
          projectId,
          modelId: stepDef.modelId,
          prompt: stepPrompt,
          sourceUrl: usePrev && prevUrl ? prevUrl : undefined,
        });
        // 輪詢到完成
        let status = gen;
        for (let t = 0; t < 60 && (status.status === "queued" || status.status === "running"); t++) {
          await new Promise((r) => setTimeout(r, 3000));
          status = await client.generation.status.query({ id: gen.id });
        }
        if (status.status !== "done") throw new Error(`步驟「${step.note}」失敗:${status.error ?? "逾時"}`);
        prevText = status.resultText ?? prevText;
        prevUrl = status.resultUrl ?? prevUrl;
        setLogs((ls) => ls.map((l, j) => (j === i ? { ...l, status: "done", detail: status.resultText?.slice(0, 60) ?? status.resultUrl ?? "" } : l)));
      }
      utils.generation.listByProject.invalidate({ projectId });
      utils.quota.my.invalidate();
    } catch (err) {
      setLogs((ls) => {
        const idx = ls.findIndex((l) => l.status === "running");
        return ls.map((l, j) => (j === idx ? { ...l, status: "failed", detail: err instanceof Error ? err.message : String(err) } : l));
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="card">
      <h2>工作流(一鍵串鏈)</h2>
      <p className="hint">選一條流程 → 填一次想法 → 自動串多個模型;每步各自扣點、成品全進生成紀錄。</p>
      <label>流程</label>
      <select value={wf?.id ?? ""} onChange={(e) => setWfId(e.target.value)}>
        {(workflows.data ?? []).map((w) => (
          <option key={w.id} value={w.id}>
            {w.tierLabel}・{w.label} — 約 {w.points} 點({w.steps.length} 步)
          </option>
        ))}
      </select>
      {wf && <p className="hint" style={{ marginTop: 4 }}>{wf.strengths}|適合:{wf.bestFor}</p>}
      <label>你的想法(一句話)</label>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="例:清晨禪堂中一炷香緩緩升起,傳達放下與新生" />
      <div style={{ marginTop: 10 }}>
        <button className="primary" disabled={!prompt.trim() || running} onClick={run}>
          {running ? "執行中…" : `執行工作流(約 −${wf?.points ?? 0} 點)`}
        </button>
      </div>
      {logs.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {logs.map((l, i) => (
            <div key={i} className="hint" style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span>{l.status === "done" ? "✅" : l.status === "failed" ? "❌" : "⏳"}</span>
              <span>{l.note}</span>
              {l.detail && <span className="mono" style={{ fontSize: 11, opacity: 0.8 }}>{l.detail}</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** 步驟提示詞模板(與 shared/models.ts 的 WORKFLOW_PRESETS 對齊;前端持模板避免後端往返) */
const workflowTemplates: Record<string, string[]> = {
  "wf/full-short-flagship": [
    "把以下構想潤飾成一段 40 字內的影片畫面描述(供文生影片模型使用,繁體中文):{prompt}",
    "{prev}",
    "{prev}",
  ],
  "wf/brand-storyboard-flagship": [
    "把主題「{prompt}」化為一句電影感畫面描述(40 字內,繁體中文)",
    "{prev}",
    "保持構圖不變,將整體色調調整為溫暖的琥珀色晨光",
  ],
  "wf/quote-card-flagship": [
    "從以下內容擷取一句 20 字內的金句(只回金句本身):{prompt}",
    "極簡禪意海報,溫暖米色背景,優雅繁體中文書法字:「{prev}」",
  ],
  "wf/full-short-economy": [
    "把以下構想潤飾成一段 40 字內的影片畫面描述(繁體中文):{prompt}",
    "{prev}",
    "{prev}",
  ],
  "wf/narrated-scene-economy": ["{prompt}", "{prompt}"],
  "wf/quote-card-economy": [
    "從以下內容擷取一句 20 字內的金句(只回金句本身):{prompt}",
    "極簡禪意海報構圖,溫暖米色背景,大面留白,主題:{prev}",
  ],
  "wf/draft-minimal": ["{prompt}", "{prompt}"],
};
const workflowUsePrev: Record<string, boolean[]> = {
  "wf/brand-storyboard-flagship": [false, false, true],
};
