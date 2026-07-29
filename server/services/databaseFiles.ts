/**
 * 資料庫文件層（AI 可讀檔案的核心服務）：
 * - 文字抽取：txt/md/csv/json/html/srt/vtt 純解析；PDF（pdf-parse）；DOCX（mammoth）——
 *   抽出的純文字存 data_files.text_content，AI（MCP 工具與團隊助手）讀這裡，不再各自解析原檔。
 * - 網址匯入：Google 文件/試算表/簡報/雲端硬碟公開連結自動轉匯出網址；Notion 頁面走官方 API
 *   （需 NOTION_TOKEN 且頁面已分享給整合）；一般網頁抓 HTML 轉純文字。
 * - 安全：SSRF 防護（協定白名單＋私有位址阻擋）、抓取逾時與大小上限、配額守門。
 * - 配額：每人（上傳者計）預設 5GB，settings.fileQuotaGb 可調（0＝不限）。
 */
import { Worker } from "node:worker_threads";
import { lookup as dnsLookup } from "node:dns/promises";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { getSettings } from "./points";
import { proxyFetch } from "./http";

/** 抽出文字的長度上限：夠放整本逐字稿，又不會單列灌爆 DB/上下文組裝 */
export const MAX_TEXT_CHARS = 300_000;
/** 網址匯入的抓取上限（bytes）：擋「拿匯入當下載器」與記憶體壓力 */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
/** 抽取時最多讀進記憶體的原檔大小：超過就只存檔不抽字（PDF 巨檔等） */
export const MAX_EXTRACT_BYTES = 30 * 1024 * 1024;
/** 預設每人配額：5GB（settings.fileQuotaGb 可調；0＝不限） */
const DEFAULT_QUOTA_GB = 5;

/* ── 二進位文件抽取的隔離守門（解壓縮炸彈／CPU 炸彈 DoS 防護） ──
 * docx 是 OOXML zip、可用極高壓縮比把 30MB 輸入膨脹成數 GB；pdf 可構造成 CPU 密集。
 * 兩者一律丟進 worker thread 解析：以「V8 heap 上限（膨脹超限只炸 worker、主程序存活）」＋
 * 「牆鐘逾時（終止卡死/滴流的解析）」雙重圍住，絕不在請求處理器的事件迴圈上同步解壓/解析。
 * 舊版只擋壓縮前 30MB、之後把 buffer 同步交給 mammoth/pdf-parse，任何有寫入權的使用者上傳
 * 一顆 zip 炸彈即可 OOM 或卡死整個單容器部署。 */
const EXTRACT_WORKER_MEM_MB = 384;        // worker old-space 上限：夠放合法大文件，擋得住膨脹到 GB 的炸彈
const EXTRACT_WORKER_TIMEOUT_MS = 20_000; // 單檔解析牆鐘上限：卡死/滴流檔到點即終止 worker
const MAX_PDF_PAGES = 800;                // pdf-parse 頁數上限：擋「數萬頁」構造檔的 CPU 放大
// worker 以 eval 字串載入（避免 esbuild 單檔打包後找不到獨立 worker 檔）；跑在 CommonJS 情境下，
// require 直接可用。pdf-parse 是舊式 CJS 套件，直接 require 套件根會觸發它的 debug 模式（讀測試 PDF 而炸），
// 故深入 lib/pdf-parse.js（官方 README 建議做法）。mammoth/pdf-parse 為 external 相依，執行期存在 node_modules。
const EXTRACT_WORKER_CODE = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  try {
    const buffer = Buffer.from(workerData.buf);
    let text = null;
    if (workerData.kind === 'pdf') {
      const pdfParse = require('pdf-parse/lib/pdf-parse.js');
      const out = await pdfParse(buffer, { max: ${MAX_PDF_PAGES} });
      text = out && out.text;
    } else if (workerData.kind === 'docx') {
      const mammoth = require('mammoth');
      const out = await mammoth.extractRawText({ buffer });
      text = out && out.value;
    }
    parentPort.postMessage({ ok: true, text: text == null ? null : String(text).slice(0, ${MAX_TEXT_CHARS}) });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: (e && e.message) ? e.message : String(e) });
  }
})();
`;

/** 在受限 worker 內解析 pdf/docx；回 null＝失敗/超限/逾時（呼叫端一律降級為「僅存檔」）。 */
function extractInWorker(kind: "pdf" | "docx", buf: Buffer): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(v);
    };
    const worker = new Worker(EXTRACT_WORKER_CODE, {
      eval: true,
      workerData: { kind, buf },
      resourceLimits: { maxOldGenerationSizeMb: EXTRACT_WORKER_MEM_MB },
    });
    const timer = setTimeout(() => {
      console.warn(`[databaseFiles] 文字抽取逾時（${kind}，${EXTRACT_WORKER_TIMEOUT_MS}ms）——終止 worker，僅存檔`);
      finish(null);
    }, EXTRACT_WORKER_TIMEOUT_MS);
    worker.on("message", (m: { ok: boolean; text?: string | null; error?: string }) => {
      if (!m.ok) console.warn(`[databaseFiles] 文字抽取失敗（${kind}，僅存檔）：`, m.error);
      finish(m.ok ? (m.text ?? null) : null);
    });
    worker.on("error", (err) => {
      // 含 worker heap OOM（zip 炸彈膨脹超過上限）：只炸這個 worker，主程序不受影響
      console.warn(`[databaseFiles] 文字抽取 worker 錯誤（${kind}，僅存檔）：`, err instanceof Error ? err.message : err);
      finish(null);
    });
    worker.on("exit", () => finish(null)); // 非正常退出（被 OOM 終止等）也收斂成 null
  });
}

/* ── 純文字抽取 ─────────────────────────────────── */

/** htmlToText 單次處理上限：抽純文字供 LLM 閱讀，超大輸入截斷即可（防事件迴圈被攻擊者 HTML 卡死） */
const HTML_TO_TEXT_MAX_CHARS = 3_000_000;

/** HTML → 純文字：去 script/style/註解 → 標籤換行語意（p/br/li/tr…）→ 去標籤 → 實體解碼 → 收斂空白 */
export function htmlToText(html: string): string {
  // DoS 防護（修 htmltotext-eventloop-dos）：(1) 先截斷超大輸入——25-30MB 的攻擊者 HTML 在請求事件迴圈上
  // 同步處理會癱瘓整個單容器服務；抽文字給 LLM 讀，截到 3M 字已遠超任何正常文件。
  // (2) 去標籤用 <[^<>]*> 取代原 <[^>]+>：後者對「大量 < 而無 >」的病態輸入呈 O(n²) 回溯（實測 5MB 即卡 60 秒+）；
  //     改用 [^<>]（連 < 也排除）後，每個 < 位置的掃描一遇到下一個 < 就停、不再長距回溯，整體退化為線性。
  //     真實 HTML 標籤內不含 <，故正常標籤照樣被去除，行為不變。
  const src = html.length > HTML_TO_TEXT_MAX_CHARS ? html.slice(0, HTML_TO_TEXT_MAX_CHARS) : html;
  let s = src
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ");
  // 區塊級標籤視為換行，行內標籤視為空字串——保留段落結構讓 LLM 讀得順
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|blockquote|section|article|table)>/gi, "\n");
  s = s.replace(/<(br|hr)\s*\/?>/gi, "\n");
  s = s.replace(/<[^<>]*>/g, "");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 31 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    });
  return s.replace(/[ \t\r]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

/** SRT/VTT 字幕 → 純文字：去序號、時間軸、WEBVTT 頭與 cue 設定，只留台詞 */
export function subtitleToText(raw: string): string {
  return raw
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (/^WEBVTT/i.test(t) || /^NOTE\b/.test(t)) return false;
      if (/^\d+$/.test(t)) return false; // SRT 序號
      if (/\d{1,2}:\d{2}(:\d{2})?[.,]\d{3}\s*-->\s*/.test(t)) return false; // 時間軸
      return true;
    })
    .join("\n")
    .trim();
}

/** mime（含副檔名後備）→ 抽取類別；null＝此格式暫不可讀（僅存檔） */
export function extractKindOf(mime: string, name: string): "text" | "html" | "subtitle" | "pdf" | "docx" | null {
  const m = mime.split(";")[0].trim().toLowerCase();
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  if (m === "text/html" || ext === "html" || ext === "htm") return "html";
  if (m === "text/vtt" || m === "application/x-subrip" || ext === "srt" || ext === "vtt") return "subtitle";
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || ext === "docx") return "docx";
  if (m.startsWith("text/") || m === "application/json" || ["txt", "md", "csv", "json", "log", "tsv"].includes(ext)) return "text";
  return null;
}

/**
 * 從原檔 buffer 抽純文字。回 null＝此格式暫不可讀或解析失敗（僅存檔，AI 讀不到內文）。
 * 解析失敗不拋錯——檔案照存，之後格式支援擴充可再補抽。
 * pdf/docx 走受限 worker（見 extractInWorker）：解壓縮/CPU 炸彈只炸 worker、不拖垮主程序。
 */
export async function extractTextFromBuffer(mime: string, name: string, buf: Buffer): Promise<string | null> {
  if (buf.length > MAX_EXTRACT_BYTES) return null;
  const kind = extractKindOf(mime, name);
  if (!kind) return null;
  try {
    switch (kind) {
      case "text":
        return buf.toString("utf8").slice(0, MAX_TEXT_CHARS).trim() || null;
      case "html":
        return htmlToText(buf.toString("utf8")).slice(0, MAX_TEXT_CHARS) || null;
      case "subtitle":
        return subtitleToText(buf.toString("utf8")).slice(0, MAX_TEXT_CHARS) || null;
      case "pdf": {
        const text = await extractInWorker("pdf", buf);
        return text ? text.replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT_CHARS) || null : null;
      }
      case "docx": {
        const text = await extractInWorker("docx", buf);
        return text ? text.trim().slice(0, MAX_TEXT_CHARS) || null : null;
      }
    }
  } catch (err) {
    console.warn(`[databaseFiles] 文字抽取失敗（${name}，僅存檔）：`, err instanceof Error ? err.message : err);
    return null;
  }
}

/* ── 網址匯入：Google／Notion／一般網頁 ─────────────── */

/**
 * 判斷一個「已解析的字面 IP」是否落在私有／保留／內部網段（IPv4 與 IPv6）。
 * 這是 SSRF 的最終判準：主機名經 DNS 解析成 IP 後，逐一 IP 過此函式——任何一個是內部位址就擋。
 * 因為 getaddrinfo 會把 0x7f.0.0.1／2130706433／127.1／IPv4-mapped IPv6 這類「奇異寫法」
 * 一律正規化成真實 IP，故只要在「解析後」判斷，這些繞過字面字串檢查的編碼全部一併涵蓋。
 */
export function isPrivateIp(ip: string): boolean {
  const addr = ip.toLowerCase().trim();
  // IPv4-mapped IPv6（::ffff:a.b.c.d 或 ::ffff:hex）→ 取出內嵌 IPv4 再判
  const mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIp(mapped[1]);
  if (addr.includes(":")) {
    // IPv6：loopback(::1)／未指定(::)／ULA(fc00::/7＝fc,fd)／link-local(fe80::/10＝fe8,fe9,fea,feb)
    if (addr === "::1" || addr === "::") return true;
    if (/^(fc|fd)/.test(addr)) return true;
    if (/^fe[89ab]/.test(addr)) return true;
    return false;
  }
  const m = addr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 127 || a === 10 || a === 0 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254) ||       // link-local（含 AWS/GCP metadata 169.254.169.254）
    (a === 100 && b >= 64 && b <= 127) // CGNAT 100.64.0.0/10
  );
}

/**
 * 主機名 → 解析成 IP 並確認「全部」都是公開位址（否則丟人話錯誤）。★這是 SSRF 的權威防線★
 * ssrfGuardError 只擋「字面內部位址」，擋不了「一個正常主機名 DNS 解析到內網」的情形
 * （例如 169.254.169.254.nip.io、或攻擊者自架 A 記錄指向 10.x）——那才是真正可讀取內網/雲端
 * metadata 的 SSRF。這裡在連線前先解析並逐一 IP 檢查，把 DNS 名稱與各種數字編碼一網打盡。
 * 殘留風險：解析與實際連線之間的 DNS rebinding（TOCTOU）——內部工具威脅模型可接受；
 * 正式擴大部署時建議改走「出口代理白名單」徹底根除。
 */
export async function assertPublicHostOrError(hostname: string): Promise<string | null> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  // 有設出口代理（HTTPS_PROXY/HTTP_PROXY）時，真正的解析與連線由代理執行，本機 DNS 非權威、
  // 也可能解不到外部名稱（純代理出口環境）。但仍「先嘗試本機解析」：只要解得到就照樣逐一判 IP，
  // 補上「公開主機名 DNS 解析到內網（169.254.169.254／10.x…）」這條代理未必擋得住的 SSRF 破口
  // （舊版在代理模式一律 return null 直接放行，等於整條權威防線關閉）。只有本機真的解不到時，
  // 才把邊界交回出口代理、不誤擋正常匯入；字面內部位址在任何情況下都已由 ssrfGuardError 快篩擋下。
  const proxied = !!(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy);
  let addrs: Array<{ address: string }>;
  try {
    addrs = await dnsLookup(host, { all: true });
  } catch {
    return proxied ? null : "無法解析這個網址的主機（DNS 查詢失敗）";
  }
  if (addrs.length === 0) return proxied ? null : "無法解析這個網址的主機";
  for (const { address } of addrs) {
    if (isPrivateIp(address)) return "不能匯入內部網址";
  }
  return null;
}

/**
 * SSRF 防護（字面位址快篩）：只允許 http(s)，擋 localhost 與私有網段的「字面位址」。
 * ★ 這只是快篩；權威判準是 fetchImport 內對每一跳呼叫的 assertPublicHostOrError（DNS 解析後判 IP）。
 * 回錯誤訊息（人話）；null＝放行（仍須通過後續 DNS 解析檢查）。
 */
export function ssrfGuardError(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return "網址格式不正確";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "只支援 http/https 網址";
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return "不能匯入內部網址";
  }
  // 非點分十進位的「數字型主機名」（整數 IP 2130706433、十六進位 0x7f000001、缺段 127.1）——
  // 各平台 getaddrinfo 可能把它們解成 IPv4，一律擋下（深度防禦，正常網站不會用這種主機名）
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4 && (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host) || /^[\d.]+$/.test(host))) {
    return "不能匯入內部網址";
  }
  // IPv4 字面位址：loopback／私有網段／link-local／CGNAT／0.0.0.0
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (
      a === 127 || a === 10 || a === 0 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    ) return "不能匯入內部網址";
  }
  // IPv6 字面位址：loopback／unique-local／link-local／IPv4 映射一律擋（內部工具不需要）
  if (host.includes(":")) {
    if (host === "::1" || host === "::" || /^(fc|fd|fe8|fe9|fea|feb)/i.test(host) || host.startsWith("::ffff:")) {
      return "不能匯入內部網址";
    }
  }
  return null;
}

export interface NormalizedImport {
  /** 實際要抓的網址（Google 連結會轉成匯出端點） */
  fetchUrl: string;
  /** 來源類型（顯示與後續處理分支用） */
  kind: "google-doc" | "google-sheet" | "google-slides" | "google-drive" | "notion" | "web";
  /** 建議檔名後綴（Google 匯出時已知格式） */
  suggestedExt?: string;
  /** Google 檔案 id（kind 為 google-* 時有值）——個人 Drive 授權路徑用它打 Drive API 抓私有檔 */
  fileId?: string;
}

/** Notion 官方與自訂站台網域。必須用「相等或點號子網域」判斷，避免 fake-notion.com 類誤判。 */
export function isNotionHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return ["notion.so", "notion.com", "notion.site"].some((base) => host === base || host.endsWith(`.${base}`));
}

/**
 * 匯入網址正規化：
 * - Google 文件/試算表/簡報 →「任何人知道連結都能看」時可直接匯出 txt/csv/txt；
 * - Google 雲端硬碟檔案 → uc?export=download 直載；
 * - Notion → kind='notion'（由 fetchNotionText 走官方 API，絕不回退網頁爬取）；
 * - 其他 → 原樣抓（HTML 會轉純文字）。
 */
export function normalizeImportUrl(rawUrl: string): NormalizedImport {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { fetchUrl: rawUrl, kind: "web" };
  }
  const host = u.hostname.toLowerCase();
  if (host === "docs.google.com") {
    const doc = u.pathname.match(/^\/document\/d\/([\w-]+)/);
    if (doc) return { fetchUrl: `https://docs.google.com/document/d/${doc[1]}/export?format=txt`, kind: "google-doc", suggestedExt: ".txt", fileId: doc[1] };
    const sheet = u.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/);
    if (sheet) return { fetchUrl: `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=csv`, kind: "google-sheet", suggestedExt: ".csv", fileId: sheet[1] };
    const slides = u.pathname.match(/^\/presentation\/d\/([\w-]+)/);
    if (slides) return { fetchUrl: `https://docs.google.com/presentation/d/${slides[1]}/export/txt`, kind: "google-slides", suggestedExt: ".txt", fileId: slides[1] };
  }
  if (host === "drive.google.com") {
    const file = u.pathname.match(/^\/file\/d\/([\w-]+)/);
    if (file) return { fetchUrl: `https://drive.google.com/uc?export=download&id=${file[1]}`, kind: "google-drive", fileId: file[1] };
    const id = u.searchParams.get("id");
    if (u.pathname === "/uc" && id) return { fetchUrl: `https://drive.google.com/uc?export=download&id=${id}`, kind: "google-drive", fileId: id };
  }
  if (isNotionHost(host)) {
    // Notion 的 source=copy_link／pvs／v 等參數不參與 Page ID；保存乾淨來源，避免後續行為漂移。
    u.search = "";
    u.hash = "";
    return { fetchUrl: u.toString(), kind: "notion" };
  }
  return { fetchUrl: rawUrl, kind: "web" };
}

/** Notion 網址 → 頁面 id；支援 notion.so／notion.com／notion.site 與 app.notion.com 等子網域。 */
export function notionPageIdFromUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    if (!isNotionHost(u.hostname)) return null;
    const path = decodeURIComponent(u.pathname);
    const standard = path.match(/(?:^|[^0-9a-f])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:$|[^0-9a-f])/i);
    const compact = path.match(/(?:^|[^0-9a-f])([0-9a-f]{32})(?:$|[^0-9a-f])/i);
    const match = standard?.[1] ?? compact?.[1];
    if (!match) return null;
    const hex = match.replace(/-/g, "").toLowerCase();
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return null;
  }
}

/** Notion 富文字陣列 → 純文字 */
function notionRichText(rt: unknown): string {
  if (!Array.isArray(rt)) return "";
  return rt.map((r) => (r as { plain_text?: string }).plain_text ?? "").join("");
}

/**
 * 走 Notion 官方 API 抓頁面純文字（頁面需「分享給整合」）。
 * token 優先序：呼叫端傳入的「個人 token」（整合連接頁自助設定）→ 站方 NOTION_TOKEN；
 * 個人 token 對此頁無權（404）且站方另有共用 token 時自動退回站方再試一次——
 * 與 Google「個人授權失敗退回公開路徑」同口徑，設了個人 token 不會弄壞原本靠站方 token 的頁面。
 */
export async function fetchNotionText(pageId: string, userToken?: string | null): Promise<string> {
  const siteToken = process.env.NOTION_TOKEN;
  const primary = userToken || siteToken;
  if (!primary) {
    throw new Error(
      "Notion 匯入需要先設定 token：到「整合連接」頁貼上你自己的 Notion integration token" +
      "（notion.so/my-integrations 建立整合、把頁面分享給它），或請管理員設定站方 NOTION_TOKEN；" +
      "也可改用 Notion 的「匯出」功能下載 Markdown/CSV 後上傳。",
    );
  }
  try {
    return await fetchNotionTextWithToken(pageId, primary);
  } catch (err) {
    // 用型別判斷「頁面對此 token 無權（404）」而非比對錯誤訊息字串——訊息之後改寫/i18n 不會默默弄壞退回邏輯
    if (err instanceof NotionPageNotFoundError && userToken && siteToken && siteToken !== userToken) {
      return await fetchNotionTextWithToken(pageId, siteToken);
    }
    throw err;
  }
}

/** Notion 頁面對此 token 不可見（HTTP 404）：專屬型別，讓「退回站方 token」的判斷不綁錯誤訊息字串 */
export class NotionPageNotFoundError extends Error {}

async function fetchNotionTextWithToken(pageId: string, token: string): Promise<string> {
  const headers = { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28" };
  const lines: string[] = [];
  let blockCount = 0;

  async function walk(blockId: string, depth: number): Promise<void> {
    if (depth > 4 || blockCount > 800 || lines.join("\n").length > MAX_TEXT_CHARS) return;
    let cursor: string | undefined;
    do {
      const qs = cursor ? `?start_cursor=${cursor}&page_size=100` : "?page_size=100";
      const res = await proxyFetch(`https://api.notion.com/v1/blocks/${blockId}/children${qs}`, { headers, timeoutMs: 20_000 });
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("Notion Token 已失效或格式錯誤——請到「連接的資料來源」重新設定 Integration Secret。");
        }
        if (res.status === 403) {
          throw new Error("Notion 整合沒有讀取內容的權限——請確認整合已開啟 Read content capability。");
        }
        if (res.status === 404) {
          throw new NotionPageNotFoundError("頁面未授權：請在 Notion 頁面右上角點擊 ⋯ → Connections，將頁面連結給 Aios 整合。");
        }
        if (res.status === 429) {
          throw new Error("Notion API 請求過於頻繁，請稍後再試。");
        }
        if (res.status >= 500) {
          throw new Error("Notion 服務暫時無法使用，請稍後再試。");
        }
        throw new Error(`Notion API 錯誤（${res.status}）`);
      }
      const data = (await res.json()) as { results?: Array<Record<string, unknown>>; has_more?: boolean; next_cursor?: string };
      for (const block of data.results ?? []) {
        blockCount += 1;
        const type = String(block.type ?? "");
        const payload = block[type] as { rich_text?: unknown; cells?: unknown[][] } | undefined;
        const text = notionRichText(payload?.rich_text);
        if (type === "table_row" && Array.isArray(payload?.cells)) {
          lines.push(payload.cells.map((c) => notionRichText(c)).join(" | "));
        } else if (text) {
          const prefix = type === "bulleted_list_item" || type === "numbered_list_item" ? "- " : type.startsWith("heading") ? "# " : "";
          lines.push(prefix + text);
        }
        if (block.has_children === true && type !== "child_page" && type !== "child_database") {
          await walk(String(block.id), depth + 1);
        }
      }
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
  }

  await walk(pageId, 0);
  const text = lines.join("\n").trim();
  if (!text) throw new Error("這個 Notion 頁面沒有可讀的文字內容");
  return text.slice(0, MAX_TEXT_CHARS);
}

/**
 * 抓網址內容（含逾時與大小上限）；回 buffer＋實際 content-type。
 * ★ 重導向「手動逐跳」跟隨（上限 5 跳）且每一跳都重跑 ssrfGuardError——
 * 自動 follow 的話，公開網址 302 到 169.254.169.254／內網服務就繞過了入口檢查（審查確認的高風險洞）。
 */
/**
 * 逐塊讀取回應主體，累計位元組超過 max 立即取消串流並丟錯。
 * 避免 `arrayBuffer()` 在檢查大小前就把整個（可能造假 content-length 的）主體讀進記憶體。
 * （integrations 的 Drive/外部 API 抓取共用同一道上限——export 給它用）
 */
export async function readBodyCapped(res: Response, max: number): Promise<Buffer> {
  const tooBig = () => new Error(`檔案太大（上限 ${Math.round(max / 1024 / 1024)}MB）`);
  const reader = res.body?.getReader?.();
  if (!reader) {
    // 沒有可讀串流（理論上少見）：退回 arrayBuffer，但仍在使用前檢查大小
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > max) throw tooBig();
    return buf;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        throw tooBig();
      }
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks);
}

export async function fetchImport(url: string): Promise<{ buf: Buffer; mime: string; finalUrl: string }> {
  let initial: URL;
  try {
    initial = new URL(url);
  } catch {
    throw new Error("網址格式不正確");
  }
  if (isNotionHost(initial.hostname)) {
    throw new Error("Notion 連結必須透過官方 API 匯入——請確認頁面已在 Connections 授權給 Aios 整合。");
  }

  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const guard = ssrfGuardError(current);
    if (guard) throw new Error(hop === 0 ? guard : "來源網址重導向到內部位址——已擋下");
    // ★ 權威 SSRF 判準：把主機名 DNS 解析成 IP，任一 IP 落在內網/保留段就擋（每一跳都重驗，
    //   杜絕「公開網址 302 到 169.254.169.254／內網服務」與各種數字/DNS 名稱繞過字面檢查）。
    let hostname: string;
    try {
      hostname = new URL(current).hostname;
    } catch {
      throw new Error("網址格式不正確");
    }
    // 每一跳都必須重驗：一般短網址可能 302 到 Notion。若只檢查初始 URL，
    // 重導目標會誤走 HTML 爬取並把 Notion SPA 空殼當成匯入內容。
    if (isNotionHost(hostname)) {
      throw new Error("Notion 連結必須透過官方 API 匯入——請確認頁面已在 Connections 授權給 Aios 整合。");
    }
    const dnsGuard = await assertPublicHostOrError(hostname);
    if (dnsGuard) throw new Error(hop === 0 ? dnsGuard : "來源網址重導向到內部位址——已擋下");
    const res = await proxyFetch(current, { timeoutMs: 25_000, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`抓取失敗（HTTP ${res.status}）`);
      current = new URL(loc, current).toString(); // 相對 Location 以當前網址解析
      continue;
    }
    if (!res.ok) throw new Error(`抓取失敗（HTTP ${res.status}）——請確認連結是公開的（Google：「任何人知道連結都能檢視」）`);
    const lenHeader = Number(res.headers.get("content-length") ?? 0);
    if (lenHeader > MAX_IMPORT_BYTES) throw new Error(`檔案太大（上限 ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)}MB）`);
    // 串流累計並在超限時「立即中止」——不能先 arrayBuffer() 全量緩衝再檢查：伺服器省略/謊報
    // content-length 就能串數 GB 撐爆記憶體（OOM DoS，審查發現的高風險）。
    const buf = await readBodyCapped(res, MAX_IMPORT_BYTES);
    // Google 私有檔會 200 回登入頁 HTML——由呼叫端依 kind 判斷「期望非 HTML 卻拿到 HTML」給人話錯誤
    const mime = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
    return { buf, mime, finalUrl: current };
  }
  throw new Error("來源網址重導向次數過多（超過 5 次）");
}

/* ── 配額（每人 5GB，可調） ─────────────────────── */

export async function fileQuotaBytes(): Promise<number | null> {
  const settings = await getSettings();
  const gb = settings.fileQuotaGb ?? DEFAULT_QUOTA_GB;
  return gb <= 0 ? null : gb * 1024 * 1024 * 1024; // 0＝不限
}

export async function userFileUsage(userId: string): Promise<number> {
  // 只計「資料庫還活著」的文件：庫被軟刪後文件對使用者不可達也不可刪，
  // 再算進配額會把空間永久卡死（審查發現）；磁碟實體用量另有 checkDiskSpace 水位守門
  const [row] = await db
    .select({ used: sql<number>`coalesce(sum(${schema.dataFiles.sizeBytes}), 0)` })
    .from(schema.dataFiles)
    .innerJoin(schema.dataTables, eq(schema.dataTables.id, schema.dataFiles.tableId))
    .where(and(eq(schema.dataFiles.uploadedBy, userId), isNull(schema.dataTables.deletedAt)));
  return Number(row?.used ?? 0);
}

/** 配額守門：回錯誤訊息（人話）；null＝放行 */
export async function quotaGuardError(userId: string, incomingBytes: number): Promise<string | null> {
  const quota = await fileQuotaBytes();
  if (quota == null) return null;
  const used = await userFileUsage(userId);
  if (used + incomingBytes > quota) {
    return `你的文件儲存空間已滿（已用 ${formatBytes(used)}／${formatBytes(quota)}）——刪除舊文件釋放空間，或請管理員調高配額`;
  }
  return null;
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
