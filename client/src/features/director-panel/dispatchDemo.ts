/**
 * M7 示範資料 + demoDirectorApi。
 *
 * 後端 dispatch router（M1–M6）尚未落地，DirectorPanel 在沒有注入 api 時
 * 以這份示範資料跑完整流程（拆解 → 成本 → 執行 → 完成），方便檢視與測試 UI。
 * M8 串接時以 tRPC adapter 實作同一 DispatchDirectorApi 介面替換，UI 不動。
 */
import type {
  CostEstimate,
  DispatchDirectorApi,
  DispatchPlanDraft,
  DispatchPlanStatusPayload,
} from "./dispatchTypes";
import { advanceDemoSubtasks, topologicalOrder } from "./dispatchDag";

export const DEMO_PLAN_ID = "demo-plan";

export const demoDraft: DispatchPlanDraft = {
  title: "把分鏡做成 10 秒廣告短片",
  goal: "把三張分鏡圖合成一支 10 秒廣告短片並配上旁白",
  summary: {
    rationale: "先出三張定裝分鏡與旁白文案（互不依賴、可平行），再依序配音、合成影片、整理紀錄。",
    successCriteria: ["三張分鏡圖完成", "10 秒影片輸出", "旁白音軌與影片同步"],
    risks: ["合成素材缺圖時需要補出圖"],
  },
  subtasks: [
    {
      id: "s1",
      type: "image",
      prompt: "開場鏡：產品置中於 16:9 廣角場景，金黃主光",
      params: { modelId: "nim-flash", aspectRatio: "16:9", destination: "asset" },
    },
    {
      id: "s2",
      type: "image",
      prompt: "中景鏡：人物手持產品微笑，16:9",
      params: { modelId: "nim-flash", aspectRatio: "16:9", destination: "asset" },
    },
    {
      id: "s3",
      type: "image",
      prompt: "特寫鏡：產品細節與光澤，16:9",
      params: { modelId: "nim-flash", aspectRatio: "16:9", destination: "asset" },
    },
    {
      id: "s4",
      type: "llm",
      prompt: "寫一段 10 秒廣告旁白，約 30 字，語氣溫暖",
      params: { modelId: "llm-4o-mini", destination: "note" },
    },
    {
      id: "s5",
      type: "audio",
      prompt: "依旁白文案配音，10 秒",
      params: { modelId: "tts-1", durationSec: 10, destination: "asset" },
      dependsOn: ["s4"],
    },
    {
      id: "s6",
      type: "video",
      prompt: "依三張分鏡合成 10 秒影片，搭配音音軌",
      params: { modelId: "fal-veo", durationSec: 10, aspectRatio: "16:9", destination: "both" },
      dependsOn: ["s1", "s2", "s3", "s5"],
    },
    {
      id: "s7",
      type: "note",
      prompt: "整理本次製作紀錄：流程、模型、產出清單",
      params: { modelId: "llm-4o-mini", destination: "note" },
      dependsOn: ["s6"],
    },
  ],
};

export const demoEstimate: CostEstimate = {
  totalPoints: 198,
  currency: "points",
  breakdown: "3 張圖 × 15pt + 文字 8pt + 配音 20pt + 影片 120pt + 紀錄 5pt",
  perSubtask: [
    { id: "s1", type: "image", model: "nim-flash", estPoints: 15, breakdown: "出圖 16:9 × 15pt" },
    { id: "s2", type: "image", model: "nim-flash", estPoints: 15, breakdown: "出圖 16:9 × 15pt" },
    { id: "s3", type: "image", model: "nim-flash", estPoints: 15, breakdown: "出圖 16:9 × 15pt" },
    { id: "s4", type: "llm", model: "llm-4o-mini", estPoints: 8, breakdown: "文字生成 × 8pt" },
    { id: "s5", type: "audio", model: "tts-1", estPoints: 20, breakdown: "配音 10 秒 × 20pt" },
    { id: "s6", type: "video", model: "fal-veo", estPoints: 120, breakdown: "影片合成 10 秒 × 120pt" },
    { id: "s7", type: "note", model: "llm-4o-mini", estPoints: 5, breakdown: "筆記整理 × 5pt" },
  ],
};

const demoProvider = "demo-llm";

function planStatusPayload(step: number): DispatchPlanStatusPayload {
  const subtasks = advanceDemoSubtasks(demoDraft.subtasks, step);
  const doneCount = subtasks.filter((s) => s.status === "done").length;
  const status =
    doneCount === subtasks.length ? "done" : doneCount > 0 || subtasks.some((s) => s.status === "running") ? "running" : "running";
  return {
    planId: DEMO_PLAN_ID,
    status,
    subtasks,
    progressLog: [],
    costEstimate: demoEstimate,
    doneCount,
    totalCount: subtasks.length,
  };
}

/**
 * 示範 adapter：無網路、零延遲、可重複呼叫。
 * 每次 planStatus 依拓撲序推進 2 步，約 3 次輪詢後全部完成。
 */
let demoStep = 0;

export const demoDirectorApi: DispatchDirectorApi = {
  async planPreview() {
    return { draft: demoDraft, costEstimate: demoEstimate, provider: demoProvider };
  },
  async planCreate() {
    demoStep = 1;
    return { planId: DEMO_PLAN_ID, costEstimate: demoEstimate, status: "proposed" };
  },
  async planApprove({ planId }) {
    return { planId, status: "running" };
  },
  async planStatus({ planId }) {
    const total = topologicalOrder(demoDraft.subtasks).length;
    // 每次輪詢推進 2 步：1 → 3 → 5 → 7（全完成）
    demoStep = Math.min(demoStep + 2, total + 1);
    return planStatusPayload(demoStep);
  },
  async planStop({ planId }) {
    return { planId, status: "cancelled" };
  },
  async planRetry({ planId }) {
    demoStep = 1;
    return { planId, status: "running" };
  },
};
