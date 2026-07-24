import { useEffect, useRef, useState } from "react";
import { trpc } from "../api";
import { Icon, type IconName } from "./Icon";

/**
 * #0 桌面通知：首次徵求授權，已授權才發。某些瀏覽器（未授權/背景分頁）建構子會丟例外，包 try 忽略。
 * 純附加通知——不影響任何既有輪詢與顯示邏輯。
 */
function notifyDesktop(items: { title: string; body: string }[]): void {
  if (items.length === 0 || typeof Notification === "undefined") return;
  const fire = () => {
    if (Notification.permission !== "granted") return;
    for (const it of items) {
      try {
        new Notification(it.title, { body: it.body });
      } catch {
        /* 某些瀏覽器 constructor 受限，忽略即可 */
      }
    }
  };
  if (Notification.permission === "default") {
    Notification.requestPermission().then(fire).catch(() => {});
  } else {
    fire();
  }
}

/** 與伺服器 workflowRuns.steps 的 jsonb 同形狀（tRPC 端 jsonb 推導不出型別,前端自己標） */
interface RunStep {
  note: string;
  status: "pending" | "running" | "done" | "failed" | "stopped";
  generationId?: string;
  detail?: string;
}

const STEP_ICON: Record<RunStep["status"], IconName> = { done: "CheckCircle2", failed: "XCircle", stopped: "CircleStop", running: "Loader", pending: "Clock" };
const RUN_STATUS_LABEL: Record<string, string> = { running: "執行中", done: "已完成", failed: "失敗", stopped: "已停止" };

/** 與伺服器 runner 相同的「活躍」語義：run 還在跑，或按停後仍有一步在生成收尾——這期間都要輪詢 */
function isActiveRun(r: { status: string; steps: unknown }): boolean {
  return r.status === "running" || (r.steps as RunStep[]).some((s) => s.status === "running");
}

/** 工作流:一鍵串多個模型——由伺服器背景逐步執行,關掉頁面也會繼續跑(#53 根治)。
 *  charIds/sceneIds＝生成台勾選的角色/場景卡（二合一）：啟動時一併帶入，整條串鏈的視覺步驟注入同一套錨點；
 *  promptRequest＝提示詞庫「用於工作流」的咒語（nonce 遞增才套用一次） */
export function WorkflowCard({
  projectId,
  charIds = [],
  sceneIds = [],
  promptRequest,
}: {
  projectId: string;
  charIds?: string[];
  sceneIds?: string[];
  promptRequest?: { text: string; nonce: number } | null;
}) {
  const workflows = trpc.models.workflows.useQuery();
  const utils = trpc.useUtils();
  const [wfId, setWfId] = useState("");
  const [prompt, setPrompt] = useState("");

  // 提示詞庫「用於工作流」：把咒語填進想法框（已手打內容時先問，不默默覆蓋——與生成台 applyPrompt 同禮節）
  useEffect(() => {
    if (!promptRequest) return;
    if (prompt.trim() && prompt !== promptRequest.text && !window.confirm("要覆蓋工作流想法框裡已輸入的文字嗎？")) return;
    setPrompt(promptRequest.text);
    // 只在 nonce 遞增時套用一次；prompt 刻意不入依賴（入了會在使用者打字時重問）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptRequest?.nonce]);

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
  // #0 完成通知：偵測工作流 run 由 running 轉 done/failed 的「邊緣」，發一則桌面通知。
  // 推進本就在伺服器背景做，這裡純附加通知、不改既有輪詢。
  const prevRunStatusRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const rows = runs.data;
    if (!rows) return;
    const prev = prevRunStatusRef.current;
    const isFirst = prev.size === 0; // 首輪只建基準，不通知（避免載入既有已結束 run 時洗一排通知）
    const finished: { title: string; body: string }[] = [];
    for (const r of rows) {
      const before = prev.get(r.id);
      if (!isFirst && before === "running" && (r.status === "done" || r.status === "failed")) {
        finished.push({ title: r.status === "done" ? "工作流完成 ✓" : "工作流失敗", body: r.prompt.slice(0, 20) });
      }
      prev.set(r.id, r.status);
    }
    for (const id of Array.from(prev.keys())) {
      if (!rows.some((r) => r.id === id)) prev.delete(id);
    }
    notifyDesktop(finished);
  }, [runs.data]);

  const hasActive = runs.data?.some(isActiveRun) ?? false;
  // 自己發起的活躍 run：伺服器端 start 也會擋（同人同專案一次一條），這裡先把按鈕鎖起來少一次白打
  const hasMyActive = (runs.data ?? []).some((r) => isActiveRun(r) && r.userId === me.data?.user.id);

  // 執行中每步的成品/扣點會陸續落庫——生成紀錄與點數跟著刷;結束時再刷最後一次(收最後一步的成品)
  useEffect(() => {
    if (!hasActive) return;
    const refresh = () => {
      utils.generation.listByProject.invalidate({ projectId });
      // 分頁/篩選視圖同步失效，否則工作流逐步落庫的成品在該視圖看不到（修 agent-workflow-refresh-missing-paged）
      utils.generation.listByProjectPaged.invalidate({ projectId });
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
      // 啟動時伺服器把「想法」存進提示詞庫（三合一）——本分頁的庫要立刻看得到
      utils.prompts.list.invalidate({ projectId });
    },
  });
  const stop = trpc.workflows.stop.useMutation({ onSuccess: () => runs.refetch() });

  return (
    <section className="card" data-fb="工作流">
      <h2>工作流（一鍵串鏈）</h2>
      <p className="hint">選一條流程 → 填一次想法 → 由伺服器在背景執行——關掉頁面也會繼續跑，成品進下方生成紀錄。</p>
      <label htmlFor="wf-flow">流程</label>
      <select id="wf-flow" value={wf?.id ?? ""} onChange={(e) => setWfId(e.target.value)}>
        {(workflows.data ?? []).map((w) => (
          <option key={w.id} value={w.id}>
            {w.tierLabel}・{w.label} — 約 {w.points} 點（{w.steps.length} 步）
          </option>
        ))}
      </select>
      {wf && <p className="hint" style={{ marginTop: 4 }}>{wf.strengths}|適合：{wf.bestFor}</p>}
      <label htmlFor="wf-idea">你的想法（一句話）</label>
      <textarea id="wf-idea" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="例：清晨禪堂中一炷香緩緩升起，傳達放下與新生" />
      {/* 二合一回看線：啟動會沿用生成台勾選的角色/場景卡，整條串鏈畫風一致（沒勾就不帶） */}
      {(charIds.length > 0 || sceneIds.length > 0) && (
        <p className="hint" style={{ marginTop: 6 }}>
          帶入生成台勾選：
          {charIds.length > 0 && <span className="chip on" style={{ marginLeft: 4 }}>角色 {charIds.length}</span>}
          {sceneIds.length > 0 && <span className="chip on" style={{ marginLeft: 4 }}>場景 {sceneIds.length}</span>}
          <span style={{ marginLeft: 4 }}>——視覺步驟都注入同一套錨點</span>
        </p>
      )}
      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          className="primary"
          disabled={!wf || !prompt.trim() || start.isPending || hasMyActive}
          onClick={() =>
            wf &&
            start.mutate({
              projectId,
              presetId: wf.id,
              prompt: prompt.trim(),
              // 與 generation.submit 的 zod 上限同口徑（6/4）：勾超過就取前幾張——
              // 「沿用勾選」是順手帶入，不因超勾讓整條工作流啟動失敗
              characterIds: charIds.length ? charIds.slice(0, 6) : undefined,
              scenePresetIds: sceneIds.length ? sceneIds.slice(0, 4) : undefined,
            })
          }
        >
          {start.isPending ? "送出中…" : `執行工作流（約 −${wf?.points ?? 0} 點）`}
        </button>
        {hasMyActive && <span className="hint">已有一條在跑</span>}
      </div>
      {start.error && <p className="hint" style={{ marginTop: 6 }}>啟動失敗：{start.error.message}</p>}
      {stop.error && <p className="hint" style={{ marginTop: 6 }}>停止失敗：{stop.error.message}</p>}
      {(runs.data ?? []).map((r) => {
        const steps = r.steps as RunStep[];
        const label = workflows.data?.find((w) => w.id === r.presetId)?.label ?? r.presetId;
        return (
          <div key={r.id} style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid var(--border-soft)" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <strong style={{ fontSize: "var(--fs-13)" }}>{label}</strong>
              <span className={`pill ${r.status}`}>{RUN_STATUS_LABEL[r.status] ?? r.status}</span>
              <span className="hint">{new Date(r.createdAt).toLocaleString("zh-TW", { hour12: false })}</span>
              {r.status === "running" && (
                <button disabled={stop.isPending} onClick={() => stop.mutate({ runId: r.id })}>
                  {stop.isPending ? "停止中…" : "停止後續步驟"}
                </button>
              )}
            </div>
            <p className="hint" style={{ margin: "4px 0" }}>
              想法：{r.prompt}
              {/* 這條 run 帶了哪些錨點（落庫在 run 上，重整/他人看到的都一致） */}
              {((r.characterIds as string[] | null)?.length ?? 0) > 0 && <span className="chip" style={{ marginLeft: 6 }}>角色 {(r.characterIds as string[]).length}</span>}
              {((r.scenePresetIds as string[] | null)?.length ?? 0) > 0 && <span className="chip" style={{ marginLeft: 4 }}>場景 {(r.scenePresetIds as string[]).length}</span>}
            </p>
            {steps.map((s, i) => (
              <div key={i} className="hint" style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ display: "inline-flex" }}><Icon name={STEP_ICON[s.status] ?? "Clock"} size={14} className={s.status === "running" ? "spin" : undefined} /></span>
                <span>{s.note}</span>
                {s.status === "pending" && <span className="mono" style={{ fontSize: "var(--fs-11)", opacity: 0.8 }}>排隊中</span>}
                {s.detail && <span className="mono" style={{ fontSize: "var(--fs-11)", opacity: 0.8 }}>{s.detail}</span>}
                {/* 細膩回看線：每一步點過去就是它的生成列（成品/錯誤/點數都在那裡） */}
                {s.generationId && (s.status === "done" || s.status === "failed" || s.status === "running") && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    style={{ padding: "0 6px", fontSize: "var(--fs-11)" }}
                    title="捲到這一步的生成紀錄"
                    onClick={() => {
                      const el = document.getElementById(`generation-${s.generationId}`);
                      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                      else window.alert("這筆生成不在目前列表（可能較舊）——到生成紀錄用「載入更多」或搜尋找它");
                    }}
                  >
                    查看生成
                  </button>
                )}
              </div>
            ))}
            {r.status === "failed" && r.error && <p className="hint" style={{ marginTop: "var(--sp-4)" }}>原因：{r.error}</p>}
            {r.status === "stopped" && <p className="hint" style={{ marginTop: 4 }}>已停止（已完成與正在生成的步驟不受影響）。</p>}
          </div>
        );
      })}
    </section>
  );
}
