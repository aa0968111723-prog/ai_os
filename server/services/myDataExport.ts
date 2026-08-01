/**
 * 個資自助匯出的「可讀版」（給非技術的內容創作者看得懂）。
 *
 * 背景：原本 /api/me/export 只回原始 JSON（英文欄位名、UUID、ISO 時間、queued/done 等英文列舉），
 * 一般創作者打開「我的資料.json」滿眼大括號與代號，根本看不懂（使用者實際回饋）。
 * 這支模組把同一份資料轉成「自我說明」的單檔 HTML：中文欄位、中文化列舉、在地化日期、
 * 表格化呈現、手機也好讀。原始 JSON 仍保留（?format=json），供資料可攜（個資法「請求複本」）。
 *
 * 安全：這是「把使用者自己的內容嵌進 HTML」，故所有使用者欄位一律經 esc() 逐字跳脫，
 * 杜絕 HTML/標籤注入；檔案自我包含（inline CSS、零 JS、零外部資源），下載後本機開啟即可讀，
 * 端點以 Content-Disposition: attachment 交付、不在應用網域內渲染。
 */
import { getModel } from "../../shared/models";

/** 專案匯出：世界觀可讀摘要（含進階層） */
export interface MyDataProjectWorldview {
  logline?: string;
  message?: string;
  audience?: string;
  tones?: string[];
  styles?: string[];
  themes?: string[];
  people?: string[];
  taboos?: string[];
  references?: string[];
  acts?: { hook?: string; turn?: string; cta?: string };
}

export interface MyDataProjectScene {
  orderIndex: number;
  title: string;
  status: string;
  durationSec: number;
  prompt?: string | null;
  voiceover?: string | null;
  inTrash?: boolean;
  /** 分鏡是否已綁畫面／旁白素材（不暴露 asset UUID） */
  hasVisualAsset?: boolean;
  hasNarration?: boolean;
}

export interface MyDataProjectExport {
  id: string;
  title: string;
  kind: string;
  platform: string;
  format: string;
  status: string;
  groupId: string;
  groupName: string;
  relation: "owner" | "member" | "contributor";
  myProjectRole: "editor" | "viewer" | "owner" | null;
  worldview: MyDataProjectWorldview;
  createdAt: string | Date;
  updatedAt: string | Date;
  counts: {
    scenes: number;
    knowledge: number;
    characters: number;
    scenePresets: number;
    assets: number;
    myGenerations: number;
    scenesInTrash?: number;
    knowledgeInTrash?: number;
  };
  scenes: MyDataProjectScene[];
  knowledge: Array<{
    title: string;
    kind: string;
    pinned: boolean;
    summary?: string | null;
    content?: string;
    contentTruncated?: boolean;
    inTrash?: boolean;
    createdAt?: string | Date;
    createdByMe?: boolean;
  }>;
  characters: Array<{
    name: string;
    appearance?: string;
    notes?: string | null;
    hasReferenceImage?: boolean;
  }>;
  scenePresets: Array<{
    name: string;
    palette?: string;
    lighting?: string | null;
    hasReferenceImage?: boolean;
  }>;
  /** 專案素材清單（擁有／成員可見） */
  assets?: Array<{
    title: string;
    kind: string;
    mime?: string | null;
    sizeBytes?: number | null;
    locked?: boolean;
    isAiGenerated?: boolean;
    landState?: string | null;
    uploadedByMe?: boolean;
    inTrash?: boolean;
    tags?: string[];
    createdAt: string | Date;
  }>;
  /** 你上傳的素材 */
  myAssets: Array<{
    title: string;
    kind: string;
    mime?: string | null;
    sizeBytes?: number | null;
    locked?: boolean;
    isAiGenerated?: boolean;
    landState?: string | null;
    uploadedByMe?: boolean;
    inTrash?: boolean;
    tags?: string[];
    createdAt: string | Date;
  }>;
  members?: Array<{ userId: string; name: string; role: string }>;
}

/** 匯出資料形狀（loadMyDataExportPayload 組出；日期允許字串或 Date） */
export interface MyDataExportPayload {
  exportedAt: string | Date;
  user: {
    id: string;
    name: string;
    email: string;
    createdAt: string | Date | null;
    /** 介面密度偏好（guide／concise）；不含密碼與權限旗標細節 */
    uiDensity?: string | null;
    accountStatus?: string | null;
  };
  groups: Array<{ groupId: string; groupName: string; teamId: string; teamName: string; role: string }>;
  projects?: MyDataProjectExport[];
  /** 點數／生成粗統計（一眼看懂消耗） */
  usageSummary?: {
    pointsCharged: number;
    pointsRefunded: number;
    pointsNet: number;
    generationsByStatus: Record<string, number>;
    generationsByKind: Record<string, number>;
  };
  generations: Array<{
    id: string;
    projectId?: string | null;
    projectTitle?: string | null;
    modelId: string;
    kind: string;
    prompt: string;
    status: string;
    pointsEst: number;
    pointsActual: number | null;
    pointsRefunded?: number;
    name?: string | null;
    favorite?: boolean | null;
    error?: string | null;
    resultText?: string | null;
    resultTextTruncated?: boolean;
    sceneRole?: string | null;
    characterCount?: number;
    scenePresetCount?: number;
    linkedWorkflow?: boolean;
    linkedAgent?: boolean;
    /** params 物件的鍵名（不展開可能含敏感 URL 的值） */
    paramKeys?: string[];
    createdAt: string | Date;
  }>;
  messages: Array<{
    id: string;
    projectId: string | null;
    projectTitle?: string | null;
    body: string;
    createdAt: string | Date;
  }>;
  feedback: Array<{
    id: string;
    scores: unknown;
    best: string | null;
    worst: string | null;
    note: string | null;
    createdAt: string | Date;
    updatedAt: string | Date;
  }>;
  notes: Array<{
    id: string;
    title: string;
    content: string;
    projectId?: string | null;
    projectTitle?: string | null;
    mentionCount?: number;
    fromMessage?: boolean;
    updatedAt: string | Date;
  }>;
  scheduleItems: Array<{
    id: string;
    title: string;
    startsAt: string | Date;
    endsAt: string | Date | null;
    note: string | null;
    projectId?: string | null;
    projectTitle?: string | null;
    mentionCount?: number;
    fromMessage?: boolean;
    createdAt: string | Date;
  }>;
  costLedger?: Array<{
    id: string;
    groupId: string;
    groupName?: string;
    delta: number;
    reason: string;
    generationId?: string | null;
    createdAt: string | Date;
  }>;
  agentRuns?: Array<{
    id: string;
    projectId: string;
    projectTitle?: string | null;
    goal: string;
    summary: string;
    status: string;
    estPoints: number;
    error?: string | null;
    steps?: Array<{ note?: string; status?: string; kind?: string }>;
    /** 計畫摘要可讀片段（成功條件／假設／風險等，截斷） */
    planHighlights?: string[];
    createdAt: string | Date;
    updatedAt: string | Date;
  }>;
  /** 組級代理 campaign（跨專案指揮） */
  groupAgentRuns?: Array<{
    id: string;
    groupId: string;
    groupName?: string;
    goal: string;
    summary: string;
    status: string;
    budgetPoints: number;
    spentPoints: number;
    steps?: Array<{ note?: string; status?: string; kind?: string }>;
    error?: string | null;
    createdAt: string | Date;
    updatedAt: string | Date;
  }>;
  prompts?: Array<{
    id: string;
    projectId?: string | null;
    projectTitle?: string | null;
    text: string;
    modelId?: string | null;
    useCount: number;
    characterCount?: number;
    scenePresetCount?: number;
    createdAt: string | Date;
    updatedAt: string | Date;
  }>;
  approvals?: Array<{
    id: string;
    projectId: string;
    projectTitle?: string | null;
    sceneId?: string | null;
    version: number;
    status: string;
    reason?: string | null;
    role: "submitted" | "decided";
    createdAt: string | Date;
    decidedAt?: string | Date | null;
  }>;
  dmMessages?: Array<{
    id: string;
    direction: "in" | "out";
    peerId: string;
    peerName: string;
    body: string;
    kind: string;
    createdAt: string | Date;
  }>;
  exportJobs?: Array<{
    id: string;
    projectId: string;
    projectTitle?: string | null;
    status: string;
    zipName?: string | null;
    error?: string | null;
    doneEntries?: number;
    totalEntries?: number;
    bytesWritten?: number;
    createdAt: string | Date;
  }>;
  workflowRuns?: Array<{
    id: string;
    projectId: string;
    projectTitle?: string | null;
    presetId: string;
    prompt: string;
    status: string;
    currentStep: number;
    error?: string | null;
    steps?: Array<{ note?: string; status?: string }>;
    characterCount?: number;
    scenePresetCount?: number;
    createdAt: string | Date;
  }>;
  /** 你建立的長文版本快照（知識／筆記歷史） */
  textVersions?: Array<{
    id: string;
    projectId: string;
    projectTitle?: string | null;
    kind: string;
    title?: string | null;
    contentPreview: string;
    contentTruncated: boolean;
    createdAt: string | Date;
  }>;
  /** 指派給你或你建立的專案任務 */
  projectTasks?: Array<{
    id: string;
    projectId: string;
    projectTitle?: string | null;
    title: string;
    description?: string | null;
    status: string;
    priority: string;
    taskType: string;
    relation: "assignee" | "creator" | "both";
    dueAt?: string | Date | null;
    createdAt: string | Date;
  }>;
  /** 你的個人資料庫（結構＋列數；不含他人可見範圍的完整列資料） */
  personalDatabases?: Array<{
    id: string;
    name: string;
    description?: string | null;
    fieldLabels: string[];
    rowCount: number;
    fileCount: number;
    agentAccess: string;
    sampleRows: Array<Record<string, unknown>>;
    createdAt: string | Date;
    updatedAt: string | Date;
  }>;
  /** 外部整合連線狀態（永不含 token／密鑰） */
  integrations?: Array<{
    kind: string;
    name: string;
    status: string;
    baseUrl?: string | null;
    lastUsedAt?: string | Date | null;
    createdAt: string | Date;
  }>;
  googleCalendar?: {
    connected: boolean;
    googleEmail?: string | null;
    status?: string | null;
    lastSyncAt?: string | Date | null;
  } | null;
  externalAccounts?: Array<{
    provider: string;
    accountEmail?: string | null;
    status: string;
    mode: string;
    lastUsedAt?: string | Date | null;
    createdAt: string | Date;
  }>;
}

/** 從 projects.worldview jsonb 抽出可讀摘要（含進階層；截斷防爆） */
export function summarizeWorldview(raw: unknown): MyDataProjectWorldview {
  if (!raw || typeof raw !== "object") return {};
  const w = raw as Record<string, unknown>;
  const str = (k: string, max = 800) =>
    typeof w[k] === "string" ? (w[k] as string).slice(0, max) : undefined;
  const arr = (k: string, maxItems = 20) =>
    Array.isArray(w[k])
      ? (w[k] as unknown[]).filter((x): x is string => typeof x === "string").slice(0, maxItems)
      : undefined;
  const out: MyDataProjectWorldview = {};
  const logline = str("logline");
  const message = str("message");
  const audience = str("audience");
  const tones = arr("tones") ?? arr("tone");
  const styles = arr("styles") ?? arr("style");
  const themes = arr("themes") ?? arr("theme");
  const people = arr("people");
  const taboos = arr("taboos", 30);
  const references = arr("references", 15);
  if (logline) out.logline = logline;
  if (message) out.message = message;
  if (audience) out.audience = audience;
  if (tones?.length) out.tones = tones;
  if (styles?.length) out.styles = styles;
  if (themes?.length) out.themes = themes;
  if (people?.length) out.people = people;
  if (taboos?.length) out.taboos = taboos;
  if (references?.length) out.references = references;
  if (w.acts && typeof w.acts === "object") {
    const a = w.acts as Record<string, unknown>;
    const acts = {
      hook: typeof a.hook === "string" ? a.hook.slice(0, 500) : undefined,
      turn: typeof a.turn === "string" ? a.turn.slice(0, 500) : undefined,
      cta: typeof a.cta === "string" ? a.cta.slice(0, 500) : undefined,
    };
    if (acts.hook || acts.turn || acts.cta) out.acts = acts;
  }
  return out;
}

/** HTML 特殊字元跳脫（&<>"'）——所有使用者內容進 HTML 前一律經此，防 HTML/標籤注入 */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 中文化對照：查無對照就原樣顯示（不硬吞未知值，方便日後新增類型也不致空白）
const ROLE_LABEL: Record<string, string> = { admin: "管理員", leader: "組長", member: "組員" };
const GEN_STATUS_LABEL: Record<string, string> = {
  queued: "排隊中",
  running: "生成中",
  done: "已完成",
  failed: "失敗",
  awaiting_approval: "等待審核",
  rejected: "已退回",
};
const GEN_KIND_LABEL: Record<string, string> = {
  image: "圖片",
  video: "影片",
  text: "文字",
  audio: "聲音／配音",
};
const PROJECT_STATUS_LABEL: Record<string, string> = {
  active: "進行中",
  archived: "已封存",
  paused: "暫停",
};
const SCENE_STATUS_LABEL: Record<string, string> = {
  todo: "待做",
  drafting: "草稿",
  pending: "待審",
  approved: "已通過",
  needs_work: "需修改",
  done: "完成",
};
const RELATION_LABEL: Record<string, string> = {
  owner: "擁有者",
  member: "專案成員",
  contributor: "有生成貢獻",
};
const KNOWLEDGE_KIND_LABEL: Record<string, string> = {
  transcript: "開示稿",
  testimony: "見證",
  script: "腳本",
  note: "筆記",
};

function label(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}

// 問卷 6 題的白話題幹（鏡像 client/src/pages/FeedbackPage.tsx 的 ITEMS）。
// feedback.scores 的鍵是 context/cost/... 等英文代碼，直接顯示創作者看不懂，故在此對照回題目。
const FEEDBACK_LABELS: Record<string, string> = {
  context: "AI 懂不懂我們的素材（不用重複解釋）",
  cost: "額度夠用、花費看得懂",
  collab: "協作／審批比試算表好用",
  ai: "AI 導演的 idea 有沒有用",
  daily: "能融入平常剪輯流程",
  usability: "不用教也會用",
};

/** 模型技術代號 → 友善名稱（如 fal-ai/flux-2/pro → FLUX.2 [pro]）；查無對照就顯示原代號 */
function modelLabel(id: string): string {
  return getModel(id)?.label ?? id;
}

/**
 * 在地化日期時間（台灣時區、繁中）。回傳如「2026年7月17日 下午11:59」。
 * 無值或無法解析時回「—」而非拋錯（匯出不能因單筆壞資料整份失敗）。
 */
export function fmtDateTime(value: string | Date | null | undefined): string {
  if (value == null || value === "") return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

/**
 * feedback.scores 是 jsonb（鍵為 context/cost/… 等問卷代碼、值 1–5 分）——
 * 攤成「白話題目：分數」的可讀清單；未知鍵退回原字串（不硬吞）。
 */
function renderScores(scores: unknown): string {
  if (!scores || typeof scores !== "object") return "—";
  const entries = Object.entries(scores as Record<string, unknown>);
  if (entries.length === 0) return "—";
  return entries
    .map(([k, v]) => `<div class="score"><span>${esc(label(FEEDBACK_LABELS, k))}</span><b>${esc(v)}／5</b></div>`)
    .join("");
}

/** 章節外框：標題＋筆數徽章＋內容（空資料以柔性空狀態呈現，不留只有標題的空殼） */
function section(id: string, title: string, count: number, bodyHtml: string): string {
  const badge = `<span class="count">${count}</span>`;
  const body = count > 0 ? bodyHtml : `<p class="empty">目前沒有這類資料。</p>`;
  return `<section id="${id}" class="card">
      <h2>${esc(title)} ${badge}</h2>
      ${body}
    </section>`;
}

/** 把多行純文字安全轉成 HTML（逐字跳脫後把換行變 <br>），供留言／筆記等長文欄位使用 */
function multiline(text: string): string {
  return esc(text).replace(/\r?\n/g, "<br>");
}

/**
 * 產生「我的資料」可讀 HTML（單一自我包含檔案）。純函式、可單元測試：
 * 相同輸入 → 相同輸出（唯一變動來源是 payload.exportedAt，由呼叫端決定）。
 */
function renderProjectsHtml(projects: MyDataProjectExport[]): string {
  if (projects.length === 0) return "";
  const blocks = projects
    .map((p) => {
      const wv = p.worldview;
      const wvBits = [
        wv.logline ? `故事：${esc(wv.logline)}` : "",
        wv.message ? `訊息：${esc(wv.message)}` : "",
        wv.audience ? `觀眾：${esc(wv.audience)}` : "",
        wv.tones?.length ? `調性：${esc(wv.tones.join("、"))}` : "",
        wv.styles?.length ? `風格：${esc(wv.styles.join("、"))}` : "",
        wv.themes?.length ? `主軸：${esc(wv.themes.join("、"))}` : "",
        wv.people?.length ? `人物：${esc(wv.people.join("、"))}` : "",
        wv.taboos?.length ? `禁忌：${esc(wv.taboos.join("、"))}` : "",
        wv.acts?.hook ? `開場：${esc(wv.acts.hook)}` : "",
        wv.acts?.turn ? `轉折：${esc(wv.acts.turn)}` : "",
        wv.acts?.cta ? `行動呼籲：${esc(wv.acts.cta)}` : "",
        wv.references?.length ? `參考：${esc(wv.references.join("、"))}` : "",
      ]
        .filter(Boolean)
        .join("<br>");
      const sceneRows = p.scenes
        .map((s) => {
          const bind = [
            s.hasVisualAsset ? "有畫面" : null,
            s.hasNarration ? "有旁白音" : null,
          ]
            .filter(Boolean)
            .join("·");
          return `<tr>
              <td class="num">${s.orderIndex + 1}</td>
              <td>${esc(s.title)}${s.inTrash ? " <span class=\"badge-trash\">回收桶</span>" : ""}</td>
              <td>${esc(label(SCENE_STATUS_LABEL, s.status))}</td>
              <td class="num">${s.durationSec}s</td>
              <td class="nowrap">${esc(bind || "—")}</td>
              <td class="prompt">${s.prompt ? esc(s.prompt.slice(0, 400)) : "—"}</td>
              <td class="prompt">${s.voiceover ? esc(s.voiceover.slice(0, 300)) : "—"}</td>
            </tr>`;
        })
        .join("");
      const knBlocks = p.knowledge
        .map((k) => {
          const body = k.content
            ? multiline(k.content)
            : k.summary
              ? `<em>摘要：</em>${multiline(k.summary)}`
              : "—";
          return `<div class="kn-item">
            <h4>${esc(k.title)}${k.pinned ? " · 置頂" : ""}${k.inTrash ? " · 回收桶" : ""}${k.createdByMe ? " · 我建立" : ""}</h4>
            <div class="note-when">${esc(label(KNOWLEDGE_KIND_LABEL, k.kind))}${k.createdAt ? `　·　${esc(fmtDateTime(k.createdAt))}` : ""}${k.contentTruncated ? "　·　全文已截斷" : ""}</div>
            <div class="note-body">${body}</div>
          </div>`;
        })
        .join("");
      const charBlocks = p.characters
        .map(
          (c) =>
            `<div class="kn-item"><h4>${esc(c.name)}${c.hasReferenceImage ? " · 有參考圖" : ""}</h4>
            <div class="note-body"><b>外觀：</b>${c.appearance ? multiline(c.appearance) : "—"}
            ${c.notes ? `<br><b>個性／備註：</b>${multiline(c.notes)}` : ""}</div></div>`,
        )
        .join("");
      const presetBlocks = p.scenePresets
        .map(
          (c) =>
            `<div class="kn-item"><h4>${esc(c.name)}${c.hasReferenceImage ? " · 有參考圖" : ""}</h4>
            <div class="note-body">色板：${esc(c.palette || "—")}${c.lighting ? `　·　光線：${esc(c.lighting)}` : ""}</div></div>`,
        )
        .join("");
      const assetSrc = (p.assets && p.assets.length ? p.assets : p.myAssets) ?? [];
      const assetRows = assetSrc
        .map(
          (a) =>
            `<tr>
              <td class="nowrap">${esc(fmtDateTime(a.createdAt))}</td>
              <td>${esc(label(GEN_KIND_LABEL, a.kind))}</td>
              <td>${esc(a.title)}${a.locked ? " 🔒" : ""}${a.inTrash ? " <span class=\"badge-trash\">回收桶</span>" : ""}${a.tags?.length ? `<br><span class="muted-tags">${esc(a.tags.join("、"))}</span>` : ""}</td>
              <td class="nowrap">${a.sizeBytes != null ? Math.round(a.sizeBytes / 1024) + " KB" : "—"}</td>
              <td>${a.isAiGenerated ? "AI" : a.uploadedByMe ? "我上傳" : "—"}</td>
              <td>${esc(a.landState || "—")}</td>
            </tr>`,
        )
        .join("");
      const memberRows = (p.members ?? [])
        .map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.role === "viewer" ? "檢視者" : "編輯者")}</td></tr>`)
        .join("");
      return `<div class="proj">
        <h3>${esc(p.title)}</h3>
        <div class="proj-meta">
          ${esc(p.groupName)}　·　${esc(label(PROJECT_STATUS_LABEL, p.status))}　·　
          ${esc(label(RELATION_LABEL, p.relation))}
          ${p.myProjectRole ? `（專案角色：${esc(p.myProjectRole === "owner" ? "擁有者" : p.myProjectRole === "viewer" ? "檢視者" : "編輯者")}）` : ""}
          <br>類型 ${esc(p.kind)}　·　平台 ${esc(p.platform)}　·　畫幅 ${esc(p.format)}
          <br>建立 ${esc(fmtDateTime(p.createdAt))}　·　更新 ${esc(fmtDateTime(p.updatedAt))}
        </div>
        <div class="proj-counts">
          分鏡 ${p.counts.scenes}${p.counts.scenesInTrash ? `（回收桶 ${p.counts.scenesInTrash}）` : ""}　·　
          知識 ${p.counts.knowledge}${p.counts.knowledgeInTrash ? `（回收桶 ${p.counts.knowledgeInTrash}）` : ""}　·　
          角色 ${p.counts.characters}　·　場景卡 ${p.counts.scenePresets}　·　
          素材 ${p.counts.assets}　·　我的生成 ${p.counts.myGenerations}
        </div>
        ${wvBits ? `<div class="proj-wv"><b>世界觀（含進階）</b><br>${wvBits}</div>` : ""}
        ${
          p.scenes.length
            ? `<p class="note">分鏡詳情（本檔最多 ${p.scenes.length} 格）</p>
          <div class="scroll"><table><thead><tr><th>#</th><th>標題</th><th>狀態</th><th>秒數</th><th>綁定</th><th>提示詞</th><th>旁白詞</th></tr></thead><tbody>${sceneRows}</tbody></table></div>`
            : ""
        }
        ${knBlocks ? `<p class="note">知識庫全文／摘要</p>${knBlocks}` : ""}
        ${charBlocks ? `<p class="note">角色定裝</p>${charBlocks}` : ""}
        ${presetBlocks ? `<p class="note">場景設定</p>${presetBlocks}` : ""}
        ${
          assetRows
            ? `<p class="note">素材清單${p.assets?.length ? "（專案可見）" : "（我上傳的）"}</p>
          <div class="scroll"><table><thead><tr><th>時間</th><th>類型</th><th>標題</th><th>大小</th><th>來源</th><th>落地</th></tr></thead><tbody>${assetRows}</tbody></table></div>`
            : ""
        }
        ${
          memberRows
            ? `<p class="note">專案權限成員</p>
          <div class="scroll"><table><thead><tr><th>姓名</th><th>角色</th></tr></thead><tbody>${memberRows}</tbody></table></div>`
            : ""
        }
      </div>`;
    })
    .join("");
  return `<p class="note">含你擁有、被指定專案權限，或你曾生成過的專案。知識可含全文（過長會截斷）；媒體二進位請用交付包或素材備份。</p>${blocks}`;
}

export function renderMyDataHtml(payload: MyDataExportPayload): string {
  const { user, groups, generations, messages, feedback, notes, scheduleItems } = payload;
  const projects = payload.projects ?? [];
  const costLedger = payload.costLedger ?? [];
  const agentRuns = payload.agentRuns ?? [];
  const groupAgentRuns = payload.groupAgentRuns ?? [];
  const prompts = payload.prompts ?? [];
  const approvals = payload.approvals ?? [];
  const dmMessages = payload.dmMessages ?? [];
  const exportJobs = payload.exportJobs ?? [];
  const workflowRuns = payload.workflowRuns ?? [];
  const textVersions = payload.textVersions ?? [];
  const projectTasks = payload.projectTasks ?? [];
  const personalDatabases = payload.personalDatabases ?? [];
  const integrations = payload.integrations ?? [];
  const externalAccounts = payload.externalAccounts ?? [];
  const usage = payload.usageSummary;
  const gcal = payload.googleCalendar;

  // 概覽數字（讓創作者一眼看到自己有多少資料）
  const stats: Array<[string, number]> = [
    ["所屬組別", groups.length],
    ["相關專案", projects.length],
    ["生成紀錄", generations.length],
    ["點數帳本", costLedger.length],
    ["代理計畫", agentRuns.length + groupAgentRuns.length],
    ["任務", projectTasks.length],
    ["私訊", dmMessages.length],
    ["個人資料庫", personalDatabases.length],
  ];
  const statCards = stats
    .map(([k, v]) => `<div class="stat"><div class="n">${v}</div><div class="k">${esc(k)}</div></div>`)
    .join("");

  const usageHtml = usage
    ? `<div class="proj-wv" style="margin-top:10px">
        <b>用量摘要（本檔所列帳本／生成）</b><br>
        扣點合計 ${usage.pointsCharged}　·　退點合計 ${usage.pointsRefunded}　·　淨消耗 ${usage.pointsNet}
        ${
          Object.keys(usage.generationsByKind).length
            ? `<br>生成類型：${esc(
                Object.entries(usage.generationsByKind)
                  .map(([k, n]) => `${label(GEN_KIND_LABEL, k)} ${n}`)
                  .join("、"),
              )}`
            : ""
        }
        ${
          Object.keys(usage.generationsByStatus).length
            ? `<br>生成狀態：${esc(
                Object.entries(usage.generationsByStatus)
                  .map(([k, n]) => `${label(GEN_STATUS_LABEL, k)} ${n}`)
                  .join("、"),
              )}`
            : ""
        }
      </div>`
    : "";

  const groupsRows = groups
    .map(
      (g) =>
        `<tr><td>${esc(g.teamName)}</td><td>${esc(g.groupName)}</td><td>${esc(label(ROLE_LABEL, g.role))}</td></tr>`,
    )
    .join("");
  const groupsTable = `<table><thead><tr><th>團隊</th><th>組別</th><th>我的角色</th></tr></thead><tbody>${groupsRows}</tbody></table>`;

  const genRows = generations
    .map((g) => {
      const anchors = [
        g.characterCount ? `角色×${g.characterCount}` : null,
        g.scenePresetCount ? `場景×${g.scenePresetCount}` : null,
        g.linkedWorkflow ? "工作流" : null,
        g.linkedAgent ? "代理" : null,
        g.paramKeys?.length ? `參數：${g.paramKeys.slice(0, 8).join(",")}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `<tr>
          <td class="nowrap">${esc(fmtDateTime(g.createdAt))}</td>
          <td>${esc(g.projectTitle || "—")}</td>
          <td>${esc(g.name || "—")}${g.favorite ? " ★" : ""}</td>
          <td>${esc(label(GEN_KIND_LABEL, g.kind))}${g.sceneRole ? `／${esc(g.sceneRole)}` : ""}</td>
          <td><span class="status s-${esc(g.status)}">${esc(label(GEN_STATUS_LABEL, g.status))}</span></td>
          <td class="prompt">${esc(g.prompt)}${anchors ? `<br><span class="note-when">${esc(anchors)}</span>` : ""}${g.error ? `<br><span class="err">錯誤：${esc(g.error)}</span>` : ""}${g.resultText ? `<br><em>文字輸出：</em>${esc(g.resultText.slice(0, 500))}${g.resultTextTruncated ? "…" : ""}` : ""}</td>
          <td class="nowrap" title="${esc(g.modelId)}">${esc(modelLabel(g.modelId))}</td>
          <td class="num">${g.pointsActual ?? g.pointsEst}${g.pointsRefunded ? `（退 ${g.pointsRefunded}）` : ""}</td>
        </tr>`;
    })
    .join("");
  const genTable = `<p class="note">「我用 AI 生成過的內容」紀錄。點數欄為實際扣點；尚未完成者顯示預估。含名稱、錨點、錯誤、文字輸出摘要。</p>
    <div class="scroll"><table><thead><tr><th>時間</th><th>專案</th><th>名稱</th><th>類型</th><th>狀態</th><th>指令／結果</th><th>模型</th><th>點數</th></tr></thead><tbody>${genRows}</tbody></table></div>`;

  const msgRows = messages
    .map(
      (m) =>
        `<tr><td class="nowrap">${esc(fmtDateTime(m.createdAt))}</td><td>${esc(m.projectTitle || "—")}</td><td class="prompt">${multiline(m.body)}</td></tr>`,
    )
    .join("");
  const msgTable = `<div class="scroll"><table><thead><tr><th>時間</th><th>專案</th><th>內容</th></tr></thead><tbody>${msgRows}</tbody></table></div>`;

  const fbBlocks = feedback
    .map(
      (f) =>
        `<div class="fb">
          <div class="fb-when">${esc(fmtDateTime(f.updatedAt || f.createdAt))}</div>
          <dl>
            <dt>評分</dt><dd>${renderScores(f.scores)}</dd>
            <dt>最滿意</dt><dd>${f.best ? multiline(f.best) : "—"}</dd>
            <dt>最不滿意</dt><dd>${f.worst ? multiline(f.worst) : "—"}</dd>
            <dt>其他建議</dt><dd>${f.note ? multiline(f.note) : "—"}</dd>
          </dl>
        </div>`,
    )
    .join("");

  const noteBlocks = notes
    .map(
      (n) =>
        `<div class="note-item">
          <h3>${esc(n.title || "（未命名筆記）")}</h3>
          <div class="note-when">最後更新：${esc(fmtDateTime(n.updatedAt))}${n.projectTitle ? `　·　專案：${esc(n.projectTitle)}` : ""}${n.mentionCount ? `　·　@提及 ${n.mentionCount} 人` : ""}${n.fromMessage ? "　·　來自留言" : ""}</div>
          <div class="note-body">${multiline(n.content)}</div>
        </div>`,
    )
    .join("");

  const schedRows = scheduleItems
    .map(
      (s) =>
        `<tr>
          <td>${esc(s.title)}${s.fromMessage ? " <span class=\"note-when\">（留言轉）</span>" : ""}</td>
          <td>${esc(s.projectTitle || "—")}</td>
          <td class="nowrap">${esc(fmtDateTime(s.startsAt))}</td>
          <td class="nowrap">${esc(fmtDateTime(s.endsAt))}</td>
          <td>${s.note ? multiline(s.note) : "—"}${s.mentionCount ? `<br><span class="note-when">@${s.mentionCount}</span>` : ""}</td>
        </tr>`,
    )
    .join("");
  const schedTable = `<div class="scroll"><table><thead><tr><th>項目</th><th>專案</th><th>開始</th><th>結束</th><th>備註</th></tr></thead><tbody>${schedRows}</tbody></table></div>`;

  const costRows = costLedger
    .map(
      (c) =>
        `<tr>
          <td class="nowrap">${esc(fmtDateTime(c.createdAt))}</td>
          <td>${esc(c.groupName || c.groupId)}</td>
          <td class="num" style="color:${c.delta < 0 ? "var(--bad)" : "var(--ok)"}">${c.delta > 0 ? "+" : ""}${c.delta}</td>
          <td class="prompt">${esc(c.reason)}</td>
        </tr>`,
    )
    .join("");
  const costTable = `<p class="note">點數帳本（扣點為負、退點為正）。這是你個人的消耗軌跡。</p>
    <div class="scroll"><table><thead><tr><th>時間</th><th>組別</th><th>變動</th><th>原因</th></tr></thead><tbody>${costRows}</tbody></table></div>`;

  const agentBlocks = agentRuns
    .map((a) => {
      const stepLines = (a.steps ?? [])
        .map((s, i) => `${i + 1}. [${esc(s.status || "?")}] ${esc(s.kind || "")} ${esc(s.note || "")}`)
        .join("<br>");
      const highlights = (a.planHighlights ?? []).map((h) => `· ${esc(h)}`).join("<br>");
      return `<div class="kn-item">
        <h4>${esc(a.goal)}</h4>
        <div class="note-when">${esc(a.projectTitle || "—")}　·　${esc(a.status)}　·　估點 ${a.estPoints}　·　${esc(fmtDateTime(a.createdAt))}</div>
        ${a.summary ? `<div class="note-body">${multiline(a.summary)}</div>` : ""}
        ${highlights ? `<div class="note-body"><b>計畫重點：</b><br>${highlights}</div>` : ""}
        ${a.error ? `<div class="err">錯誤：${esc(a.error)}</div>` : ""}
        ${stepLines ? `<div class="note-body"><b>步驟：</b><br>${stepLines}</div>` : ""}
      </div>`;
    })
    .join("");

  const groupAgentBlocks = groupAgentRuns
    .map((a) => {
      const stepLines = (a.steps ?? [])
        .map((s, i) => `${i + 1}. [${esc(s.status || "?")}] ${esc(s.kind || "")} ${esc(s.note || "")}`)
        .join("<br>");
      return `<div class="kn-item">
        <h4>${esc(a.goal)}</h4>
        <div class="note-when">${esc(a.groupName || a.groupId)}　·　${esc(a.status)}　·　授權 ${a.budgetPoints}／已用 ${a.spentPoints}　·　${esc(fmtDateTime(a.createdAt))}</div>
        ${a.summary ? `<div class="note-body">${multiline(a.summary)}</div>` : ""}
        ${a.error ? `<div class="err">錯誤：${esc(a.error)}</div>` : ""}
        ${stepLines ? `<div class="note-body"><b>步驟：</b><br>${stepLines}</div>` : ""}
      </div>`;
    })
    .join("");
  const agentsCombined =
    (agentBlocks || "") +
    (groupAgentBlocks
      ? `${agentBlocks ? '<p class="note" style="margin-top:12px">組級代理（跨專案）</p>' : ""}${groupAgentBlocks}`
      : "");

  const promptRows = prompts
    .map(
      (p) =>
        `<tr>
          <td class="nowrap">${esc(fmtDateTime(p.updatedAt))}</td>
          <td>${esc(p.projectTitle || "—")}</td>
          <td class="prompt">${esc(p.text.slice(0, 400))}${p.characterCount || p.scenePresetCount ? `<br><span class="note-when">錨點 角色×${p.characterCount ?? 0} 場景×${p.scenePresetCount ?? 0}</span>` : ""}</td>
          <td class="nowrap" title="${esc(p.modelId || "")}">${esc(p.modelId ? modelLabel(p.modelId) : "—")}</td>
          <td class="num">${p.useCount}</td>
        </tr>`,
    )
    .join("");
  const promptTable = `<div class="scroll"><table><thead><tr><th>更新</th><th>專案</th><th>咒語</th><th>模型</th><th>使用次數</th></tr></thead><tbody>${promptRows}</tbody></table></div>`;

  const approvalRowsHtml = approvals
    .map(
      (a) =>
        `<tr>
          <td class="nowrap">${esc(fmtDateTime(a.createdAt))}</td>
          <td>${esc(a.projectTitle || "—")}</td>
          <td>${a.role === "submitted" ? "我送審" : "我裁決"}</td>
          <td>${esc(a.status)}</td>
          <td>${a.reason ? esc(a.reason) : "—"}</td>
        </tr>`,
    )
    .join("");
  const approvalTable = `<div class="scroll"><table><thead><tr><th>時間</th><th>專案</th><th>角色</th><th>狀態</th><th>理由</th></tr></thead><tbody>${approvalRowsHtml}</tbody></table></div>`;

  const dmRowsHtml = dmMessages
    .map(
      (d) =>
        `<tr>
          <td class="nowrap">${esc(fmtDateTime(d.createdAt))}</td>
          <td>${d.direction === "out" ? "我 → " : ""}${esc(d.peerName)}${d.direction === "in" ? " → 我" : ""}</td>
          <td class="prompt">${multiline(d.body)}</td>
        </tr>`,
    )
    .join("");
  const dmTable = `<p class="note">私訊（你參與的對話；對方姓名一併列出）。</p>
    <div class="scroll"><table><thead><tr><th>時間</th><th>對象</th><th>內容</th></tr></thead><tbody>${dmRowsHtml}</tbody></table></div>`;

  const exportJobRowsHtml = exportJobs
    .map((j) => {
      const progress =
        j.totalEntries != null && j.totalEntries > 0
          ? `${j.doneEntries ?? 0}/${j.totalEntries}`
          : "—";
      const bytes =
        j.bytesWritten != null && j.bytesWritten > 0
          ? `${Math.round(j.bytesWritten / 1024)} KB`
          : "—";
      return `<tr>
          <td class="nowrap">${esc(fmtDateTime(j.createdAt))}</td>
          <td>${esc(j.projectTitle || "—")}</td>
          <td>${esc(j.status)}</td>
          <td>${esc(j.zipName || "—")}</td>
          <td class="num">${esc(progress)}</td>
          <td class="nowrap">${esc(bytes)}</td>
          <td>${j.error ? esc(j.error) : "—"}</td>
        </tr>`;
    })
    .join("");
  const exportJobTable = `<div class="scroll"><table><thead><tr><th>時間</th><th>專案</th><th>狀態</th><th>檔名</th><th>進度</th><th>大小</th><th>錯誤</th></tr></thead><tbody>${exportJobRowsHtml}</tbody></table></div>`;

  const workflowRowsHtml = workflowRuns
    .map((w) => {
      const stepLines = (w.steps ?? [])
        .map((s, i) => `${i + 1}.[${esc(s.status || "?")}] ${esc(s.note || "")}`)
        .join(" ");
      return `<tr>
          <td class="nowrap">${esc(fmtDateTime(w.createdAt))}</td>
          <td>${esc(w.projectTitle || "—")}</td>
          <td>${esc(w.presetId)}</td>
          <td>${esc(w.status)}（步 ${w.currentStep}）</td>
          <td class="prompt">${esc(w.prompt.slice(0, 200))}${stepLines ? `<br><span class="note-when">${stepLines}</span>` : ""}${w.characterCount || w.scenePresetCount ? `<br><span class="note-when">錨點 角色×${w.characterCount ?? 0} 場景×${w.scenePresetCount ?? 0}</span>` : ""}</td>
        </tr>`;
    })
    .join("");
  const workflowTable = `<div class="scroll"><table><thead><tr><th>時間</th><th>專案</th><th>範本</th><th>狀態</th><th>提示／步驟</th></tr></thead><tbody>${workflowRowsHtml}</tbody></table></div>`;

  const textVersionBlocks = textVersions
    .map(
      (t) =>
        `<div class="kn-item">
          <h4>${esc(t.title || "（無標題）")} · ${esc(t.kind)}</h4>
          <div class="note-when">${esc(t.projectTitle || "—")}　·　${esc(fmtDateTime(t.createdAt))}${t.contentTruncated ? "　·　已截斷" : ""}</div>
          <div class="note-body">${multiline(t.contentPreview)}</div>
        </div>`,
    )
    .join("");

  const taskRows = projectTasks
    .map(
      (t) =>
        `<tr>
          <td class="nowrap">${esc(fmtDateTime(t.createdAt))}</td>
          <td>${esc(t.projectTitle || "—")}</td>
          <td>${esc(t.title)}</td>
          <td>${esc(t.status)}／${esc(t.priority)}</td>
          <td>${t.relation === "both" ? "指派＋建立" : t.relation === "assignee" ? "指派給我" : "我建立"}</td>
          <td class="nowrap">${esc(fmtDateTime(t.dueAt))}</td>
          <td class="prompt">${t.description ? esc(t.description.slice(0, 240)) : "—"}</td>
        </tr>`,
    )
    .join("");
  const taskTable = `<div class="scroll"><table><thead><tr><th>建立</th><th>專案</th><th>標題</th><th>狀態</th><th>關係</th><th>期限</th><th>說明</th></tr></thead><tbody>${taskRows}</tbody></table></div>`;

  const dbBlocks = personalDatabases
    .map((d) => {
      const sample = d.sampleRows
        .map((row, i) => {
          const cells = Object.entries(row)
            .slice(0, 8)
            .map(([k, v]) => `${esc(k)}：${esc(typeof v === "string" ? v.slice(0, 80) : JSON.stringify(v)?.slice(0, 80))}`)
            .join("；");
          return `<div class="note-when">列 ${i + 1}：${cells || "—"}</div>`;
        })
        .join("");
      return `<div class="kn-item">
        <h4>${esc(d.name)}</h4>
        <div class="note-when">欄位 ${d.fieldLabels.length}　·　列 ${d.rowCount}　·　檔案 ${d.fileCount}　·　AI ${esc(d.agentAccess)}　·　更新 ${esc(fmtDateTime(d.updatedAt))}</div>
        ${d.description ? `<div class="note-body">${multiline(d.description)}</div>` : ""}
        ${d.fieldLabels.length ? `<div class="note-body">欄位：${esc(d.fieldLabels.join("、"))}</div>` : ""}
        ${sample}
      </div>`;
    })
    .join("");

  const integRows = [
    ...integrations.map(
      (i) =>
        `<tr><td>${esc(i.kind)}</td><td>${esc(i.name || "—")}</td><td>${esc(i.status)}</td><td class="nowrap">${esc(fmtDateTime(i.lastUsedAt || i.createdAt))}</td><td>${esc(i.baseUrl || "—")}</td></tr>`,
    ),
    ...(gcal?.connected
      ? [
          `<tr><td>google-calendar</td><td>${esc(gcal.googleEmail || "已連結")}</td><td>${esc(gcal.status || "active")}</td><td class="nowrap">${esc(fmtDateTime(gcal.lastSyncAt))}</td><td>—</td></tr>`,
        ]
      : []),
    ...externalAccounts.map(
      (e) =>
        `<tr><td>${esc(e.provider)}</td><td>${esc(e.accountEmail || "—")}</td><td>${esc(e.status)}（${esc(e.mode)}）</td><td class="nowrap">${esc(fmtDateTime(e.lastUsedAt || e.createdAt))}</td><td>—</td></tr>`,
    ),
  ].join("");
  const integTable = integRows
    ? `<p class="note">只列連線狀態與顯示用信箱；<b>絕不包含</b> token、refresh token 或 API 金鑰。</p>
    <div class="scroll"><table><thead><tr><th>類型</th><th>名稱／帳號</th><th>狀態</th><th>最近</th><th>網址</th></tr></thead><tbody>${integRows}</tbody></table></div>`
    : "";
  const integCount =
    integrations.length + externalAccounts.length + (gcal?.connected ? 1 : 0);

  const exportedAtStr = esc(fmtDateTime(payload.exportedAt));

  // 自我包含 HTML：inline CSS、零 JS、零外部資源、響應式、可列印。
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>我的資料 · AI Director OS</title>
<style>
  :root{
    --bg:#f7f5f0; --card:#ffffff; --ink:#2b2a26; --muted:#6b675e; --line:#e6e1d7;
    --accent:#8a6d3b; --accent-soft:#f0e9db; --ok:#2e7d5b; --warn:#b8860b; --bad:#b3453a;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,-apple-system,"Segoe UI",sans-serif;
    line-height:1.7;-webkit-text-size-adjust:100%}
  .wrap{max-width:960px;margin:0 auto;padding:24px 16px 64px}
  header.top{padding:8px 0 4px}
  header.top .eyebrow{color:var(--accent);font-weight:700;letter-spacing:.04em;font-size:14px;margin:0}
  header.top h1{margin:.15em 0 .1em;font-size:26px}
  header.top .sub{color:var(--muted);margin:.2em 0 0;font-size:15px}
  .intro{background:var(--accent-soft);border:1px solid var(--line);border-radius:12px;
    padding:14px 16px;margin:18px 0;color:#5a4b2f;font-size:14.5px}
  .intro b{color:#4a3c22}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin:18px 0 8px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;text-align:center}
  .stat .n{font-size:26px;font-weight:800;color:var(--accent)}
  .stat .k{font-size:13px;color:var(--muted);margin-top:2px}
  nav.toc{margin:14px 0 4px;font-size:14px}
  nav.toc a{color:var(--accent);text-decoration:none;margin-right:14px;white-space:nowrap}
  nav.toc a:hover{text-decoration:underline}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 18px 8px;margin:16px 0}
  .card h2{margin:.1em 0 .5em;font-size:19px;display:flex;align-items:center;gap:8px}
  .count{display:inline-block;min-width:22px;text-align:center;background:var(--accent-soft);
    color:var(--accent);border-radius:999px;font-size:13px;font-weight:700;padding:1px 8px}
  dl.kv{margin:.2em 0 1em;display:grid;grid-template-columns:auto 1fr;gap:2px 14px}
  dl.kv dt{color:var(--muted)}
  dl.kv dd{margin:0}
  .scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
  table{border-collapse:collapse;width:100%;font-size:14px;margin:.2em 0 1em}
  th,td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
  th{color:var(--muted);font-weight:600;white-space:nowrap;background:#faf8f3}
  td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  td.nowrap{white-space:nowrap;color:var(--muted)}
  td.prompt{min-width:200px}
  .status{display:inline-block;border-radius:999px;padding:1px 9px;font-size:12.5px;white-space:nowrap;
    background:#eee;color:#555}
  .status.s-done{background:#e2f1ea;color:var(--ok)}
  .status.s-failed,.status.s-rejected{background:#f6e3e1;color:var(--bad)}
  .status.s-awaiting_approval{background:#f6efd9;color:var(--warn)}
  .status.s-running,.status.s-queued{background:#e7edf6;color:#3a5a9b}
  .note{color:var(--muted);font-size:13.5px;margin:.1em 0 .7em}
  .empty{color:var(--muted);font-style:normal;padding:2px 0 12px}
  .fb{border-bottom:1px solid var(--line);padding:6px 0 10px}
  .fb-when{color:var(--muted);font-size:13px;margin-bottom:4px}
  .fb dl,.note-item{margin:0}
  .fb dt{color:var(--muted);font-size:13px;margin-top:6px}
  .fb dd{margin:0 0 2px}
  .score{display:flex;justify-content:space-between;gap:16px;max-width:440px;
    border-bottom:1px dashed var(--line);padding:3px 0}
  .score b{color:var(--accent);white-space:nowrap;font-variant-numeric:tabular-nums}
  .note-item{border-bottom:1px solid var(--line);padding:6px 0 12px}
  .note-item h3{margin:.1em 0 .1em;font-size:16px}
  .note-when{color:var(--muted);font-size:13px;margin-bottom:6px}
  .note-body{white-space:normal}
  .proj{border-bottom:1px solid var(--line);padding:10px 0 16px;margin-bottom:8px}
  .proj h3{margin:.1em 0 .25em;font-size:17px}
  .proj-meta,.proj-counts{color:var(--muted);font-size:13px;margin-bottom:6px;line-height:1.6}
  .proj-wv{background:var(--accent-soft);border-radius:10px;padding:10px 12px;margin:8px 0;font-size:13.5px;line-height:1.65}
  .kn-item{border-bottom:1px solid var(--line);padding:8px 0 12px}
  .kn-item h4{margin:.1em 0 .2em;font-size:15px}
  .badge-trash{font-size:11px;color:var(--bad);font-weight:600}
  .muted-tags{font-size:12px;color:var(--muted)}
  .err{color:var(--bad);font-size:13px}
  footer{color:var(--muted);font-size:13px;margin-top:26px;text-align:center;line-height:1.8}
  a{color:var(--accent)}
  @media (max-width:520px){
    header.top h1{font-size:22px}
    .card{padding:14px 12px 4px}
    th,td{padding:7px 8px}
  }
  @media print{
    body{background:#fff}
    .card,.stat,.intro{border-color:#ccc}
    nav.toc{display:none}
  }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <p class="eyebrow">AI Director OS</p>
    <h1>我的資料</h1>
    <p class="sub">${esc(user.name)}　·　匯出時間：${exportedAtStr}</p>
  </header>

  <div class="intro">
    這份是你在系統裡的<b>更深一層個人資料複本</b>：帳號偏好、組別、相關專案（世界觀進階、分鏡綁定、
    知識全文、角色／場景定裝與參考圖標記、素材標籤、成員）、生成錨點與參數鍵、點數帳本與用量摘要、
    專案／組級 AI 代理、任務、提示詞、審批、私訊、交付進度、工作流步驟、長文版本歷史、
    個人資料庫（欄位與列樣例）、外部整合狀態（無密鑰），以及留言／回饋／筆記／排程。
    <b>不含密碼、token、媒體二進位檔</b>。媒體請用交付包或素材備份。
    瀏覽器開啟即可讀；<b>?format=json</b> 給機器可讀完整結構。
  </div>

  <div class="stats">${statCards}</div>
  ${usageHtml}

  <nav class="toc">
    <a href="#account">帳號</a>
    <a href="#groups">組別</a>
    <a href="#projects">專案</a>
    <a href="#generations">生成</a>
    <a href="#ledger">帳本</a>
    <a href="#agents">代理</a>
    <a href="#tasks">任務</a>
    <a href="#prompts">咒語</a>
    <a href="#approvals">審批</a>
    <a href="#dm">私訊</a>
    <a href="#messages">留言</a>
    <a href="#notes">筆記</a>
    <a href="#versions">版本</a>
    <a href="#schedule">排程</a>
    <a href="#databases">資料庫</a>
    <a href="#integrations">整合</a>
    <a href="#exports">交付</a>
    <a href="#workflows">工作流</a>
    <a href="#feedback">回饋</a>
  </nav>

  <section id="account" class="card">
    <h2>帳號基本資料</h2>
    <dl class="kv">
      <dt>姓名</dt><dd>${esc(user.name)}</dd>
      <dt>電子郵件</dt><dd>${esc(user.email)}</dd>
      <dt>加入時間</dt><dd>${esc(fmtDateTime(user.createdAt))}</dd>
      <dt>介面密度</dt><dd>${esc(user.uiDensity === "concise" ? "精簡" : user.uiDensity === "guide" ? "引導" : user.uiDensity || "—")}</dd>
      <dt>帳號狀態</dt><dd>${esc(user.accountStatus === "disabled" ? "已停用" : user.accountStatus === "active" ? "使用中" : user.accountStatus || "—")}</dd>
    </dl>
  </section>

  ${section("groups", "所屬組別", groups.length, groupsTable)}
  ${section("projects", "相關專案（深度）", projects.length, renderProjectsHtml(projects))}
  ${section("generations", "AI 生成紀錄（深度）", generations.length, genTable)}
  ${section("ledger", "點數帳本", costLedger.length, costTable)}
  ${section("agents", "AI 代理計畫（專案＋組級）", agentRuns.length + groupAgentRuns.length, agentsCombined)}
  ${section("tasks", "專案任務（指派／我建）", projectTasks.length, taskTable)}
  ${section("prompts", "提示詞庫（我存過的咒語）", prompts.length, promptTable)}
  ${section("approvals", "審批紀錄（我送審／我裁決）", approvals.length, approvalTable)}
  ${section("dm", "私訊", dmMessages.length, dmTable)}
  ${section("messages", "專案留言", messages.length, msgTable)}
  ${section("notes", "我的筆記", notes.length, noteBlocks)}
  ${section("versions", "長文版本歷史（我存的快照）", textVersions.length, textVersionBlocks)}
  ${section("schedule", "我建立的排程", scheduleItems.length, schedTable)}
  ${section("databases", "個人資料庫", personalDatabases.length, dbBlocks)}
  ${section("integrations", "外部整合連線", integCount, integTable)}
  ${section("exports", "交付打包紀錄", exportJobs.length, exportJobTable)}
  ${section("workflows", "工作流／製作範本執行", workflowRuns.length, workflowTable)}
  ${section("feedback", "我的意見回饋", feedback.length, fbBlocks)}

  <footer>
    由 AI Director OS 產生 · 這是你個人資料的可讀複本<br>
    如需更正或刪除資料，請洽團隊管理員。
  </footer>
</div>
</body>
</html>
`;
}
