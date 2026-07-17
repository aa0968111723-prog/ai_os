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

/** 匯出資料的形狀（與 server/index.ts 組出的 payload 對齊；日期允許字串或 Date） */
export interface MyDataExportPayload {
  exportedAt: string | Date;
  user: { id: string; name: string; email: string; createdAt: string | Date | null };
  groups: Array<{ groupId: string; groupName: string; teamId: string; teamName: string; role: string }>;
  generations: Array<{
    id: string;
    modelId: string;
    kind: string;
    prompt: string;
    status: string;
    pointsEst: number;
    pointsActual: number | null;
    createdAt: string | Date;
  }>;
  messages: Array<{ id: string; projectId: string | null; body: string; createdAt: string | Date }>;
  feedback: Array<{
    id: string;
    scores: unknown;
    best: string | null;
    worst: string | null;
    note: string | null;
    createdAt: string | Date;
    updatedAt: string | Date;
  }>;
  notes: Array<{ id: string; title: string; content: string; updatedAt: string | Date }>;
  scheduleItems: Array<{
    id: string;
    title: string;
    startsAt: string | Date;
    endsAt: string | Date | null;
    note: string | null;
    createdAt: string | Date;
  }>;
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
export function renderMyDataHtml(payload: MyDataExportPayload): string {
  const { user, groups, generations, messages, feedback, notes, scheduleItems } = payload;

  // 概覽數字（讓創作者一眼看到自己有多少資料）
  const stats: Array<[string, number]> = [
    ["所屬組別", groups.length],
    ["生成紀錄", generations.length],
    ["留言", messages.length],
    ["意見回饋", feedback.length],
    ["筆記", notes.length],
    ["排程", scheduleItems.length],
  ];
  const statCards = stats
    .map(([k, v]) => `<div class="stat"><div class="n">${v}</div><div class="k">${esc(k)}</div></div>`)
    .join("");

  const groupsRows = groups
    .map(
      (g) =>
        `<tr><td>${esc(g.teamName)}</td><td>${esc(g.groupName)}</td><td>${esc(label(ROLE_LABEL, g.role))}</td></tr>`,
    )
    .join("");
  const groupsTable = `<table><thead><tr><th>團隊</th><th>組別</th><th>我的角色</th></tr></thead><tbody>${groupsRows}</tbody></table>`;

  const genRows = generations
    .map(
      (g) =>
        `<tr>
          <td class="nowrap">${esc(fmtDateTime(g.createdAt))}</td>
          <td>${esc(label(GEN_KIND_LABEL, g.kind))}</td>
          <td><span class="status s-${esc(g.status)}">${esc(label(GEN_STATUS_LABEL, g.status))}</span></td>
          <td class="prompt">${esc(g.prompt)}</td>
          <td class="nowrap" title="${esc(g.modelId)}">${esc(modelLabel(g.modelId))}</td>
          <td class="num">${g.pointsActual ?? g.pointsEst}</td>
        </tr>`,
    )
    .join("");
  const genTable = `<p class="note">「我用 AI 生成過的內容」紀錄。點數欄為實際扣點；尚未完成者顯示預估點數。</p>
    <div class="scroll"><table><thead><tr><th>時間</th><th>類型</th><th>狀態</th><th>我下的指令（提示詞）</th><th>使用的模型</th><th>點數</th></tr></thead><tbody>${genRows}</tbody></table></div>`;

  const msgRows = messages
    .map((m) => `<tr><td class="nowrap">${esc(fmtDateTime(m.createdAt))}</td><td class="prompt">${multiline(m.body)}</td></tr>`)
    .join("");
  const msgTable = `<div class="scroll"><table><thead><tr><th>時間</th><th>內容</th></tr></thead><tbody>${msgRows}</tbody></table></div>`;

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
          <div class="note-when">最後更新：${esc(fmtDateTime(n.updatedAt))}</div>
          <div class="note-body">${multiline(n.content)}</div>
        </div>`,
    )
    .join("");

  const schedRows = scheduleItems
    .map(
      (s) =>
        `<tr>
          <td>${esc(s.title)}</td>
          <td class="nowrap">${esc(fmtDateTime(s.startsAt))}</td>
          <td class="nowrap">${esc(fmtDateTime(s.endsAt))}</td>
          <td>${s.note ? multiline(s.note) : "—"}</td>
        </tr>`,
    )
    .join("");
  const schedTable = `<div class="scroll"><table><thead><tr><th>項目</th><th>開始</th><th>結束</th><th>備註</th></tr></thead><tbody>${schedRows}</tbody></table></div>`;

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
    這份檔案是你在系統裡「屬於你自己的」資料整理成的可讀報告——包含帳號、你所屬的組別，以及你做過的
    生成、留言、回饋、筆記與排程。<b>只有你本人的資料</b>，不含別人的內容，也不含密碼。
    直接用瀏覽器打開就能看；想印出來或存 PDF，用瀏覽器「列印」即可。
    需要給工程或系統匯入用的原始檔，可在網址結尾加上 <b>?format=json</b>。
  </div>

  <div class="stats">${statCards}</div>

  <nav class="toc">
    <a href="#account">帳號</a>
    <a href="#groups">組別</a>
    <a href="#generations">生成紀錄</a>
    <a href="#messages">留言</a>
    <a href="#feedback">意見回饋</a>
    <a href="#notes">筆記</a>
    <a href="#schedule">排程</a>
  </nav>

  <section id="account" class="card">
    <h2>帳號基本資料</h2>
    <dl class="kv">
      <dt>姓名</dt><dd>${esc(user.name)}</dd>
      <dt>電子郵件</dt><dd>${esc(user.email)}</dd>
      <dt>加入時間</dt><dd>${esc(fmtDateTime(user.createdAt))}</dd>
    </dl>
  </section>

  ${section("groups", "所屬組別", groups.length, groupsTable)}
  ${section("generations", "AI 生成紀錄", generations.length, genTable)}
  ${section("messages", "我的留言", messages.length, msgTable)}
  ${section("feedback", "我的意見回饋", feedback.length, fbBlocks)}
  ${section("notes", "我的筆記", notes.length, noteBlocks)}
  ${section("schedule", "我建立的排程", scheduleItems.length, schedTable)}

  <footer>
    由 AI Director OS 產生 · 這是你個人資料的可讀複本<br>
    如需更正或刪除資料，請洽團隊管理員。
  </footer>
</div>
</body>
</html>
`;
}
