import { useEffect, useRef, useState } from "react";
import { MAX_GENERATE_CHARACTERS, MAX_GENERATE_PROPS, MAX_GENERATE_SCENE_PRESETS } from "@shared/cardLimits";
import { getModel } from "@shared/models";
import { trpc } from "../api";
import { Icon, type IconName } from "./Icon";

import { Button, Card, Chip, Hint, Meta, Pill, type PillStatus } from "./ui";
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
/** run 狀態 → Pill 色階；`stopped` 站內沒有對應色階（`.pill.stopped` 不存在），落回中性 */
const RUN_PILL_STATUS: Record<string, PillStatus> = { running: "running", done: "done", failed: "failed" };

/** 與伺服器 runner 相同的「活躍」語義：run 還在跑，或按停後仍有一步在生成收尾——這期間都要輪詢 */
function isActiveRun(r: { status: string; steps: unknown }): boolean {
  return r.status === "running" || (r.steps as RunStep[]).some((s) => s.status === "running");
}

function modelLabel(modelId: string): string {
  return getModel(modelId)?.label ?? modelId;
}

/** 製作範本（底層仍為 workflow）：一鍵串多個模型，由伺服器背景逐步執行，關掉頁面也會繼續跑。
 *  charIds/sceneIds/propIds＝生成台勾選的角色/場景/素材卡：啟動時一併帶入，整條串鏈的視覺步驟注入同一套錨點；
 *  promptRequest＝提示詞庫「用於製作範本」的咒語（nonce 遞增才套用一次）；
 *  pickRequest＝跨模式帶入的 templateId 預選（nonce 遞增才套用一次）；
 *  embedded＝嵌在工作台 TemplateMode 內時不包外層 card */
export function WorkflowCard({
  projectId,
  charIds = [],
  sceneIds = [],
  propIds = [],
  promptRequest,
  pickRequest,
  embedded = false,
}: {
  projectId: string;
  charIds?: string[];
  sceneIds?: string[];
  propIds?: string[];
  promptRequest?: { text: string; nonce: number } | null;
  /** Pre-select workflow preset from draft.templateId / run_template bring-in */
  pickRequest?: { templateId: string; nonce: number } | null;
  /** When true, render without outer card chrome (lives inside workbench) */
  embedded?: boolean;
}) {
  const workflows = trpc.models.workflows.useQuery();
  const utils = trpc.useUtils();
  const [wfId, setWfId] = useState("");
  const [prompt, setPrompt] = useState("");
  /** Set when pickRequest.templateId is not in the loaded list (after data arrives) */
  const [pickMissId, setPickMissId] = useState<string | null>(null);

  // 提示詞庫／工作台帶入：把咒語填進想法框（已手打內容時先問，不默默覆蓋——與生成台 applyPrompt 同禮節）
  useEffect(() => {
    if (!promptRequest) return;
    if (prompt.trim() && prompt !== promptRequest.text && !window.confirm("要覆蓋製作範本想法框裡已輸入的文字嗎？")) return;
    setPrompt(promptRequest.text);
    // 只在 nonce 遞增時套用一次；prompt 刻意不入依賴（入了會在使用者打字時重問）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptRequest?.nonce]);

  // 跨模式帶入 templateId：預選範本；列表載入後仍對不到則提示
  useEffect(() => {
    if (!pickRequest?.templateId) return;
    const list = workflows.data;
    if (!list?.length) return;
    if (list.some((w) => w.id === pickRequest.templateId)) {
      setWfId(pickRequest.templateId);
      setPickMissId(null);
    } else {
      setPickMissId(pickRequest.templateId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickRequest?.nonce, workflows.data]);

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
  // #0 完成通知：偵測 run 由 running 轉 done/failed 的「邊緣」，發一則桌面通知。
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
        finished.push({ title: r.status === "done" ? "製作範本完成 ✓" : "製作範本失敗", body: r.prompt.slice(0, 20) });
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
      // 分頁/篩選視圖同步失效，否則逐步落庫的成品在該視圖看不到
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

  const body = (
    <>
      {!embedded && <h2>製作範本（固定自動流程）</h2>}
      <Hint style={{ marginTop: embedded ? 4 : undefined }}>
        適合步驟固定、會重複使用的製作方式。選一個範本、填一次想法，系統會在背景依序完成；關掉頁面也會繼續，成品會進入生成紀錄。
      </Hint>
      <label htmlFor="wf-flow">選擇製作範本</label>
      <select id="wf-flow" value={wf?.id ?? ""} onChange={(e) => setWfId(e.target.value)}>
        {(workflows.data ?? []).map((w) => (
          <option key={w.id} value={w.id}>
            {w.tierLabel}・{w.label} — 約 {w.points} 點（{w.steps.length} 步）
          </option>
        ))}
      </select>
      {wf && <Meta as="p" style={{ marginTop: 4 }}>{wf.strengths}|適合：{wf.bestFor}</Meta>}
      {pickMissId ? (
        <Meta as="p" role="status" style={{ marginTop: 6, color: "var(--gold-ink)" }}>
          帶入範本無法對應：
          <b className="mono">{pickMissId}</b>
          （列表中沒有這個 id，已保留目前選擇）
        </Meta>
      ) : null}

      {/* §6.4 計畫預覽：步驟、模型、估點、核准閘門（單一區塊，不另掛 CreationCostSummary） */}
      {wf && (
        <div
          className="workflow-plan-preview"
          data-testid="workflow-plan-preview"
          role="status"
          aria-live="polite"
          style={{
            marginTop: 10,
            padding: "8px 10px",
            border: "1px solid var(--border-soft)",
            borderRadius: "var(--radius-md)",
            background: "var(--card2)",
          }}
        >
          <strong style={{ fontSize: "var(--fs-13)" }}>計畫預覽</strong>
          <Meta as="ol" style={{ margin: "6px 0 0", paddingLeft: 20 }}>
            {wf.steps.map((s, i) => (
              <li key={i} style={{ marginBottom: 2 }}>
                {s.note}
                <span className="mono" style={{ marginLeft: 6, fontSize: "var(--fs-11)", opacity: 0.85 }}>
                  {modelLabel(s.modelId)}
                </span>
                {s.usePrevAsSource ? (
                  <Chip style={{ marginLeft: 4, fontSize: "var(--fs-11)" }}>
                    沿用上步
                  </Chip>
                ) : null}
              </li>
            ))}
          </Meta>
          <Hint layer="always" style={{ margin: "6px 0 0" }}>
            本次模式：製作範本・預估消耗：約 {wf.points} 點（{wf.steps.length} 步）・產物寫入生成紀錄
          </Hint>
          <Hint style={{ margin: "2px 0 0" }}>
            是否需要核准：各步生成若達門檻仍走既有核准流程（背景執行不中斷）
          </Hint>
        </div>
      )}

      <label htmlFor="wf-idea" style={{ display: "block", marginTop: 10 }}>
        這次想完成什麼？（一句話）
      </label>
      <textarea id="wf-idea" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="例：清晨禪堂中一炷香緩緩升起，傳達放下與新生" />
      {/* 回看線：啟動會沿用生成台勾選的角色/場景/素材卡，整條串鏈畫風一致（沒勾就不帶） */}
      {(charIds.length > 0 || sceneIds.length > 0 || propIds.length > 0) && (
        <Meta as="p" style={{ marginTop: 6 }}>
          帶入生成台勾選：
          {charIds.length > 0 && <Chip selected style={{ marginLeft: 4 }}>角色 {charIds.length}</Chip>}
          {sceneIds.length > 0 && <Chip selected style={{ marginLeft: 4 }}>場景 {sceneIds.length}</Chip>}
          {propIds.length > 0 && <Chip selected style={{ marginLeft: 4 }}>素材 {propIds.length}</Chip>}
          <span style={{ marginLeft: 4 }}>——視覺步驟都注入同一套錨點</span>
        </Meta>
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
              // 「沿用勾選」是順手帶入，不因超勾讓整條製作範本啟動失敗
              characterIds: charIds.length ? charIds.slice(0, MAX_GENERATE_CHARACTERS) : undefined,
              scenePresetIds: sceneIds.length ? sceneIds.slice(0, MAX_GENERATE_SCENE_PRESETS) : undefined,
              propIds: propIds.length ? propIds.slice(0, MAX_GENERATE_PROPS) : undefined,
            })
          }
        >
          {start.isPending ? "送出中…" : `執行製作範本（約 −${wf?.points ?? 0} 點）`}
        </button>
        {hasMyActive && <Hint as="span" layer="always">已有一個製作範本在執行</Hint>}
      </div>
      {start.error && <Meta as="p" style={{ marginTop: 6 }}>啟動失敗：{start.error.message}</Meta>}
      {stop.error && <Meta as="p" style={{ marginTop: 6 }}>停止失敗：{stop.error.message}</Meta>}

      {(runs.data ?? []).map((r) => {
        const steps = r.steps as RunStep[];
        const label = workflows.data?.find((w) => w.id === r.presetId)?.label ?? r.presetId;
        return (
          <div key={r.id} style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid var(--border-soft)" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <strong style={{ fontSize: "var(--fs-13)" }}>{label}</strong>
              <Pill status={RUN_PILL_STATUS[r.status]}>{RUN_STATUS_LABEL[r.status] ?? r.status}</Pill>
              <Meta>{new Date(r.createdAt).toLocaleString("zh-TW", { hour12: false })}</Meta>
              {r.status === "running" && (
                <button disabled={stop.isPending} onClick={() => stop.mutate({ runId: r.id })}>
                  {stop.isPending ? "停止中…" : "停止後續步驟"}
                </button>
              )}
            </div>
            <Meta as="p" style={{ margin: "4px 0" }}>
              想法：{r.prompt}
              {/* 這條 run 帶了哪些錨點（落庫在 run 上，重整/他人看到的都一致） */}
              {((r.characterIds as string[] | null)?.length ?? 0) > 0 && <Chip style={{ marginLeft: 6 }}>角色 {(r.characterIds as string[]).length}</Chip>}
              {((r.scenePresetIds as string[] | null)?.length ?? 0) > 0 && <Chip style={{ marginLeft: 4 }}>場景 {(r.scenePresetIds as string[]).length}</Chip>}
            </Meta>
            {steps.map((s, i) => (
              <Meta key={i} as="div" style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ display: "inline-flex" }}><Icon name={STEP_ICON[s.status] ?? "Clock"} size={13} /></span>
                <span>{s.note}</span>
                {s.status === "pending" && <span className="mono" style={{ fontSize: "var(--fs-11)", opacity: 0.8 }}>排隊中</span>}
                {s.detail && <span className="mono" style={{ fontSize: "var(--fs-11)", opacity: 0.8 }}>{s.detail}</span>}
                {/* 細膩回看線：每一步點過去就是它的生成列（成品/錯誤/點數都在那裡） */}
                {s.generationId && (s.status === "done" || s.status === "failed" || s.status === "running") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    style={{ padding: "0 6px", fontSize: "var(--fs-11)" }}
                    title="捲到這一步的生成紀錄"
                    onClick={() => {
                      const el = document.getElementById(`generation-${s.generationId}`);
                      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                      else window.alert("這筆生成不在目前列表（可能較舊）——到生成紀錄用「載入更多」或搜尋找它");
                    }}
                  >
                    查看生成
                  </Button>
                )}
              </Meta>
            ))}
            {r.status === "failed" && r.error && <Meta as="p" style={{ marginTop: "var(--sp-4)" }}>原因：{r.error}</Meta>}
            {r.status === "stopped" && <Meta as="p" style={{ marginTop: 4 }}>已停止（已完成與正在生成的步驟不受影響）。</Meta>}
          </div>
        );
      })}
    </>
  );

  if (embedded) {
    return (
      <div data-fb="製作範本" data-testid="workflow-card">
        {body}
      </div>
    );
  }

  return (
    <Card as="section" data-fb="製作範本" data-testid="workflow-card">
      {body}
    </Card>
  );
}
