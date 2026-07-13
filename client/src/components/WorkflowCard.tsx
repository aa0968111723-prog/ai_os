import { useEffect, useState } from "react";
import { trpc } from "../api";

/** 與伺服器 workflowRuns.steps 的 jsonb 同形狀（tRPC 端 jsonb 推導不出型別,前端自己標） */
interface RunStep {
  note: string;
  status: "pending" | "running" | "done" | "failed" | "stopped";
  generationId?: string;
  detail?: string;
}

const STEP_ICON: Record<RunStep["status"], string> = { done: "✅", failed: "❌", stopped: "⏹️", running: "⏳", pending: "🕓" };
const RUN_STATUS_LABEL: Record<string, string> = { running: "執行中", done: "已完成", failed: "失敗", stopped: "已停止" };

/** 與伺服器 runner 相同的「活躍」語義：run 還在跑，或按停後仍有一步在生成收尾——這期間都要輪詢 */
function isActiveRun(r: { status: string; steps: unknown }): boolean {
  return r.status === "running" || (r.steps as RunStep[]).some((s) => s.status === "running");
}

/** 工作流:一鍵串多個模型——由伺服器背景逐步執行,關掉頁面也會繼續跑(#53 根治) */
export function WorkflowCard({ projectId }: { projectId: string }) {
  const workflows = trpc.models.workflows.useQuery();
  const utils = trpc.useUtils();
  const [wfId, setWfId] = useState("");
  const [prompt, setPrompt] = useState("");

  const wf = workflows.data?.find((w) => w.id === wfId) ?? workflows.data?.[0];

  const me = trpc.auth.me.useQuery();
  const runs = trpc.workflows.listByProject.useQuery(
    { projectId },
    {
      // 可以完全停:推進是伺服器的事,這裡輪詢只為看結果——沒有活躍的就不打 API,重進頁會 refetch
      refetchInterval: (query) => (query.state.data?.some(isActiveRun) ? 4000 : false),
      refetchIntervalInBackground: true,
    },
  );
  const hasActive = runs.data?.some(isActiveRun) ?? false;
  // 自己發起的活躍 run：伺服器端 start 也會擋（同人同專案一次一條），這裡先把按鈕鎖起來少一次白打
  const hasMyActive = (runs.data ?? []).some((r) => isActiveRun(r) && r.userId === me.data?.user.id);

  // 執行中每步的成品/扣點會陸續落庫——生成紀錄與點數跟著刷;結束時再刷最後一次(收最後一步的成品)
  useEffect(() => {
    if (!hasActive) return;
    const refresh = () => {
      utils.generation.listByProject.invalidate({ projectId });
      utils.quota.my.invalidate();
    };
    const timer = setInterval(refresh, 4000);
    return () => {
      clearInterval(timer);
      refresh();
    };
  }, [hasActive, projectId, utils]);

  const start = trpc.workflows.start.useMutation({
    onSuccess: () => {
      setPrompt("");
      runs.refetch();
    },
  });
  const stop = trpc.workflows.stop.useMutation({ onSuccess: () => runs.refetch() });

  return (
    <section className="card">
      <h2>工作流(一鍵串鏈)</h2>
      <p className="hint">選一條流程 → 填一次想法 → 由伺服器在背景執行——關掉頁面也會繼續跑,成品進下方生成紀錄。</p>
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
        <button
          className="primary"
          disabled={!wf || !prompt.trim() || start.isPending || hasMyActive}
          onClick={() => wf && start.mutate({ projectId, presetId: wf.id, prompt: prompt.trim() })}
        >
          {start.isPending ? "送出中…" : `執行工作流(約 −${wf?.points ?? 0} 點)`}
        </button>
        {hasMyActive && <span className="hint">已有一條在跑</span>}
      </div>
      {start.error && <p className="hint" style={{ marginTop: 6 }}>啟動失敗:{start.error.message}</p>}
      {stop.error && <p className="hint" style={{ marginTop: 6 }}>停止失敗:{stop.error.message}</p>}
      {(runs.data ?? []).map((r) => {
        const steps = r.steps as RunStep[];
        const label = workflows.data?.find((w) => w.id === r.presetId)?.label ?? r.presetId;
        return (
          <div key={r.id} style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid rgba(128,128,128,.25)" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <strong style={{ fontSize: 13 }}>{label}</strong>
              <span className="hint">{RUN_STATUS_LABEL[r.status] ?? r.status}・{new Date(r.createdAt).toLocaleString("zh-TW", { hour12: false })}</span>
              {r.status === "running" && (
                <button disabled={stop.isPending} onClick={() => stop.mutate({ runId: r.id })}>
                  {stop.isPending ? "停止中…" : "停止後續步驟"}
                </button>
              )}
            </div>
            <p className="hint" style={{ margin: "4px 0" }}>想法:{r.prompt}</p>
            {steps.map((s, i) => (
              <div key={i} className="hint" style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span>{STEP_ICON[s.status] ?? "🕓"}</span>
                <span>{s.note}</span>
                {s.status === "pending" && <span className="mono" style={{ fontSize: 11, opacity: 0.8 }}>排隊中</span>}
                {s.detail && <span className="mono" style={{ fontSize: 11, opacity: 0.8 }}>{s.detail}</span>}
              </div>
            ))}
            {r.status === "failed" && r.error && <p className="hint" style={{ marginTop: 4 }}>原因:{r.error}</p>}
            {r.status === "stopped" && <p className="hint" style={{ marginTop: 4 }}>已停止(已完成與正在生成的步驟不受影響)。</p>}
          </div>
        );
      })}
    </section>
  );
}
