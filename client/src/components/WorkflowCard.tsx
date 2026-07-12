import { useEffect, useRef, useState } from "react";
import { trpc } from "../api";

/** waiting＝輪詢逾時但後端仍在生成（≠失敗，成品稍後會出現在生成紀錄）;stopped＝使用者按停後未送出的步驟 */
interface StepLog { note: string; status: "running" | "done" | "failed" | "waiting" | "stopped"; detail?: string }

/** 工作流:一鍵串多個模型(每步各自扣點;逐步顯示進度) */
export function WorkflowCard({ projectId }: { projectId: string }) {
  const workflows = trpc.models.workflows.useQuery();
  const utils = trpc.useUtils();
  const [wfId, setWfId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [logs, setLogs] = useState<StepLog[]>([]);
  const [running, setRunning] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  // 迴圈真的因按停而中斷才顯示「已停止」——按停時若已在最後一步,步驟會照常做完,不能謊稱停了
  const [stoppedEarly, setStoppedEarly] = useState(false);
  // run 迴圈閉包讀不到最新 state,停止旗標必須走 ref
  const stopRef = useRef(false);

  const wf = workflows.data?.find((w) => w.id === wfId) ?? workflows.data?.[0];

  // 關閉/重整分頁會中斷還沒送出的步驟(已送出的後端會繼續),執行中先攔一下
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "工作流還在進行,離開會中斷尚未開始的步驟";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const run = async () => {
    if (!wf || !prompt.trim() || running) return;
    setRunning(true);
    setStopRequested(false);
    setStoppedEarly(false);
    stopRef.current = false;
    setLogs(wf.steps.map((s) => ({ note: s.note, status: "running" as const })));
    const client = utils.client;
    let prevText = "";
    let prevUrl = "";
    try {
      for (let i = 0; i < wf.steps.length; i++) {
        if (stopRef.current) {
          setLogs((ls) => ls.map((l, j) => (j >= i ? { ...l, status: "stopped", detail: "未送出,不扣點" } : l)));
          setStoppedEarly(true);
          break;
        }
        const step = wf.steps[i];
        // 模板:{prompt}=使用者輸入、{prev}=上一步文字結果
        const stepPrompt = step.promptTemplate.replaceAll("{prompt}", prompt.trim()).replaceAll("{prev}", prevText || prompt.trim());
        const gen = await client.generation.submit.mutate({
          projectId,
          modelId: step.modelId,
          prompt: stepPrompt,
          sourceUrl: step.usePrevAsSource && prevUrl ? prevUrl : undefined,
        });
        // 輪詢到完成——上限依產物類型放寬:影片常見 3-10 分鐘,固定 3 分鐘會把「仍在生成」誤報成失敗
        const maxTries = gen.kind === "video" ? 300 : gen.kind === "audio" ? 120 : 60; // 影片 15 分、音訊 6 分、其他 3 分
        let status = gen;
        for (let t = 0; t < maxTries && (status.status === "queued" || status.status === "running"); t++) {
          await new Promise((r) => setTimeout(r, 3000));
          status = await client.generation.status.query({ id: gen.id });
        }
        if (status.status === "queued" || status.status === "running") {
          // 逾時 ≠ 失敗:後端輪詢會繼續收斂這筆生成,點數不會重複扣;
          // 標成 waiting 而非 failed,提示使用者稍後回來看生成紀錄;其後步驟不再送出,一併標清楚
          setLogs((ls) => ls.map((l, j) =>
            j === i ? { ...l, status: "waiting", detail: "仍在生成中——結果稍後會出現在下方生成紀錄,可稍後回來看" }
            : j > i ? { ...l, status: "stopped", detail: "前一步還沒完成,未送出" }
            : l));
          return;
        }
        if (status.status !== "done") throw new Error(`步驟「${step.note}」失敗:${status.error ?? "未知錯誤"}`);
        prevText = status.resultText ?? prevText;
        prevUrl = status.resultUrl ?? prevUrl;
        setLogs((ls) => ls.map((l, j) => (j === i ? { ...l, status: "done", detail: status.resultText?.slice(0, 60) ?? status.resultUrl ?? "" } : l)));
      }
    } catch (err) {
      setLogs((ls) => {
        const idx = ls.findIndex((l) => l.status === "running");
        return ls.map((l, j) => (j === idx ? { ...l, status: "failed", detail: err instanceof Error ? err.message : String(err) } : l));
      });
    } finally {
      setRunning(false);
      // 成功/失敗/逾時/中停都要刷新:fal submit 失敗時伺服器也已寫入 failed 列並退點,列表得看得到
      utils.generation.listByProject.invalidate({ projectId });
      utils.quota.my.invalidate();
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
      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="primary" disabled={!prompt.trim() || running} onClick={run}>
          {running ? "執行中…" : `執行工作流(約 −${wf?.points ?? 0} 點)`}
        </button>
        {running && (
          <button disabled={stopRequested} onClick={() => { stopRef.current = true; setStopRequested(true); }}>
            {stopRequested ? "正在生成的這一步做完就停…" : "停止後續步驟"}
          </button>
        )}
      </div>
      {stoppedEarly && !running && <p className="hint" style={{ marginTop: 6 }}>已停止(已完成的步驟不受影響)。</p>}
      {stopRequested && !stoppedEarly && !running && logs.every((l) => l.status === "done") && (
        <p className="hint" style={{ marginTop: 6 }}>按停時所有步驟都已送出,流程已自然完成。</p>
      )}
      {logs.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {logs.map((l, i) => (
            <div key={i} className="hint" style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span>{l.status === "done" ? "✅" : l.status === "failed" ? "❌" : l.status === "waiting" ? "🕒" : l.status === "stopped" ? "⏹️" : "⏳"}</span>
              <span>{l.note}</span>
              {l.detail && <span className="mono" style={{ fontSize: 11, opacity: 0.8 }}>{l.detail}</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
