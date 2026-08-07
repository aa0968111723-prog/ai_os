import { useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";
import { MCP_TOOLS } from "../../../shared/mcpCatalog";
import { humanizeAuditAction, summarizeAuditInput } from "../../../shared/auditWording";

import { Card, Hint, Meta, Pill, Skeleton } from "../components/ui";
/**
 * MCP 專區（接上外部 AI 的控制中心）：連線設定 → 建立金鑰（可設唯讀／到期）→ 我的金鑰（權限一目了然）
 * → 測試連線（whoami）→ 工具手冊 → 近期活動。
 * 核心語意：金鑰＝你本人的身分。外部 AI 客戶端帶你的金鑰連進來，只能做你本來就能做的事——
 * 你的組、你的專案權限、你的點數額度、你的核准門檻都照算；唯讀金鑰再進一步只准讀取。
 */

/** 三步驟上手的一步：號碼圈＋粗體標題＋白話說明 */
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <span
        aria-hidden
        style={{ flex: "none", width: 26, height: 26, borderRadius: "50%", background: "var(--primary-solid)", color: "var(--primary-fg)", display: "grid", placeItems: "center", fontSize: "var(--fs-13)", fontWeight: 700, marginTop: 2 }}
      >
        {n}
      </span>
      <span style={{ fontSize: "var(--fs-14)", lineHeight: 1.8, minWidth: 0 }}>
        <b>{title}</b>：{children}
      </span>
    </li>
  );
}

/** 各客戶端接法：收合卡（同說明頁 Faq 樣式），手機上不佔版面、要看再點開 */
function ClientGuide({ name, defaultOpen = false, children }: { name: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <Card as="details" open={defaultOpen} variant="quiet" style={{ padding: 0, overflow: "hidden" }}>
      <summary style={{ minHeight: 44, padding: "12px 16px", cursor: "pointer", fontWeight: 600, fontSize: "var(--fs-14)", userSelect: "none" }}>{name}</summary>
      <div style={{ padding: "10px 16px 14px", borderTop: "1px solid var(--border)", lineHeight: 1.8, fontSize: "var(--fs-14)" }}>{children}</div>
    </Card>
  );
}

/** 複製鈕：成功顯示「已複製」約 2 秒；剪貼簿不可用時退回 prompt 手動複製 */
function CopyButton({ text, label = "複製" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  return (
    <button
      type="button"
      style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 12px", fontSize: "var(--fs-12)", flex: "none" }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("自動複製失敗，請手動複製：", text);
        }
      }}
    >
      {copied ? <><Icon name="Check" size={12} />已複製</> : label}
    </button>
  );
}

/** 接上後的照抄範例：白話需求＋對應會動到的工具（維持與 MCP_TOOLS 目錄一致） */
const EXAMPLE_PROMPTS: { say: string; note: string }[] = [
  { say: "幫我看看我專案現在的狀態，整理成三行重點。", note: "查全貌（get_project_status）——分鏡、生成、排程一次看" },
  { say: "幫我找適合做中文對嘴影片的模型，列出價錢，先不要送出生成。", note: "只查不扣點（find_model）——唯讀金鑰也能用" },
  { say: "用最省的模型幫第 2 場分鏡生一張場景圖，完成後把成品給我。", note: "會扣點（submit_generation）——照你的額度與核准門檻" },
  { say: "幫我規劃這支影片接下來的製作步驟，列出計畫等我核准再執行。", note: "交給內建助手多步執行（plan_agent → 你核准後才動工）" },
  { say: "把「下週五交片」加進專案排程。", note: "掛上專案與組行事曆（add_schedule_item）" },
];

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
}

/** 相對時間（給活動列表用）：剛剛／N 分鐘前／N 小時前／日期 */
function relTime(d: Date | string): string {
  const t = (typeof d === "string" ? new Date(d) : d).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return "剛剛";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小時前`;
  return fmtDate(d);
}

/** 到期狀態文字（含「已過期」判斷） */
function expiryLabel(expiresAt: Date | string | null): { text: string; expired: boolean } {
  if (!expiresAt) return { text: "永久", expired: false };
  const t = (typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt).getTime();
  const expired = t <= Date.now();
  return { text: expired ? "已過期" : `到期 ${fmtDate(expiresAt)}`, expired };
}

export function McpPage() {
  const utils = trpc.useUtils();
  const tokens = trpc.mcpTokens.list.useQuery();
  const activity = trpc.mcpTokens.recentActivity.useQuery({ limit: 30 });

  const [label, setLabel] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [expireDays, setExpireDays] = useState<string>("0"); // "0"＝永久
  const [fresh, setFresh] = useState<{ id: string; label: string; token: string; readOnly: boolean } | null>(null);

  const create = trpc.mcpTokens.create.useMutation({
    onSuccess: (data) => {
      setFresh({ id: data.id, label: data.label, token: data.token, readOnly: data.readOnly });
      setLabel("");
      setTestResult(null);
      utils.mcpTokens.list.invalidate();
    },
  });
  const revoke = trpc.mcpTokens.revoke.useMutation({
    onSuccess: (_d, vars) => {
      if (fresh?.id === vars.id) setFresh(null);
      utils.mcpTokens.list.invalidate();
    },
  });

  const origin = typeof window !== "undefined" ? window.location.origin : "https://你的網域";
  const endpoint = `${origin}/api/mcp`;
  const list = tokens.data ?? [];
  // 「使用中」須排除已撤銷與已過期：與伺服器端 resolveMcpIdentity 的判定一致
  const activeCount = list.filter(
    (t) => !t.revokedAt && (!t.expiresAt || new Date(t.expiresAt).getTime() > Date.now()),
  ).length;

  // Claude Desktop（及相容客戶端）的 mcpServers 設定：帶剛建立的金鑰。
  // "type": "http" 不可省——缺了部分客戶端（Claude Desktop 新版設定格式）無法辨識傳輸方式（QA-012）。
  const clientConfig = JSON.stringify(
    { mcpServers: { "ai-director": { type: "http", url: endpoint, headers: { "x-api-key": fresh?.token ?? "你的金鑰" } } } },
    null, 2,
  );
  const claudeCodeCmd = `claude mcp add --transport http ai-director ${endpoint} --header "x-api-key: ${fresh?.token ?? "你的金鑰"}"`;

  // 測試連線（QA-012）：走完整 MCP 握手 initialize → notifications/initialized → tools/list，
  // 再 tools/call whoami 驗身分——只打單一 tools/call 驗不到「客戶端實際連線時會走」的握手路徑。
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const testConnection = async () => {
    if (!fresh) return;
    setTesting(true);
    setTestResult(null);
    const rpc = async (payload: Record<string, unknown>) => {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "x-api-key": fresh.token },
        body: JSON.stringify({ jsonrpc: "2.0", ...payload }),
      });
      if (res.status === 202 || res.status === 204) return null; // notification 無回應本文
      const j = await res.json();
      if (j.error) throw new Error(j.error.message ?? "連線失敗");
      return j.result;
    };
    try {
      const init = await rpc({ id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "ai-director-web", version: "0.1.0" } } });
      if (!init?.serverInfo) throw new Error("initialize 未回 serverInfo——握手失敗");
      await rpc({ method: "notifications/initialized" });
      const toolsRes = await rpc({ id: 2, method: "tools/list" });
      const toolCount = Array.isArray(toolsRes?.tools) ? toolsRes.tools.length : 0;
      const callRes = await rpc({ id: 3, method: "tools/call", params: { name: "whoami", arguments: {} } });
      const who = JSON.parse(callRes.content[0].text);
      const groups = (who.groups ?? []).map((g: { group: string }) => g.group).join("、") || "（尚未分組）";
      setTestResult({ ok: true, text: `握手成功（${toolCount} 個工具）・已連線為「${who.user.name}」・組別：${groups}・${who.readOnly ? "唯讀" : "可讀可寫"}` });
    } catch (e) {
      setTestResult({ ok: false, text: e instanceof Error ? e.message : "連線失敗" });
    } finally {
      setTesting(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const l = label.trim();
    if (!l || create.isPending) return;
    const days = Number(expireDays);
    create.mutate({ label: l, readOnly, expiresInDays: days > 0 ? days : undefined });
  };

  return (
    <div className="page-shell secondary-page secondary-page--reading mcp-page" data-fb="MCP專區">
      <SecondaryPageHeader
        eyebrow="外部 AI 代理"
        title="接上外部 AI"
        icon="Sparkles"
        badge={`${activeCount} 把金鑰使用中`}
        description={<>讓 Claude 等外部 AI 以你的權限查專案、執行計畫與取回成果；每個動作仍受點數、核准和專案隔離保護。</>}
      />

      {/* 安全提醒 */}
      <Card style={{ borderLeft: "3px solid var(--gold-ink)", background: "var(--card2)" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <Icon name="TriangleAlert" size={18} style={{ color: "var(--gold-ink)", flex: "none", marginTop: 2 }} />
          <div style={{ fontSize: "var(--fs-14)", lineHeight: 1.8 }}>
            <b>金鑰請當密碼保管。</b>別人拿到就等同以你的身分操作系統。要交給外部自動化時，建議勾<b>唯讀</b>並設<b>到期日</b>，
            把權限縮到最小；任何一把都能隨時撤銷。
          </div>
        </div>
      </Card>

      {/* 三步驟上手：多數人卡在「金鑰拿到了，然後呢？」——先給全景，細節在下面各區 */}
      <h2 style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 8 }}><Icon name="Compass" size={18} />怎麼開始？三步驟</h2>
      <Card>
        <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
          <Step n={1} title="建立一把金鑰">
            在下方「<b>建立金鑰</b>」取個名字（例如「我的筆電 Claude」）按建立。金鑰原文<b>只顯示一次</b>，先按「複製金鑰」收好。
          </Step>
          <Step n={2} title="貼進你的 AI 客戶端">
            照下方「<a href="#mcp-clients">貼進你的 AI 客戶端</a>」的步驟，把設定貼進 Claude 桌面版或 Claude Code。這一步要在<b>電腦</b>上做——手機的 Claude App 目前沒有地方貼這個設定。
          </Step>
          <Step n={3} title="開口叫它做事">
            回到 Claude 的對話直接說需求，例如「幫我看看我專案現在的狀態」。更多可照抄的說法在下方「<a href="#mcp-examples">接上後可以這樣說</a>」。
          </Step>
        </ol>
      </Card>

      {/* 連線資訊 */}
      <h2 style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 8 }}><Icon name="ArrowRight" size={18} />連線位置</h2>
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: "var(--fs-14)" }}>
          {/* overflowWrap：端點 URL 常 >40 字元，360px 卡內不斷行就被裁掉（金鑰 token 有 break-all、這行先前漏了） */}
          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>端點：<code>POST {endpoint}</code></span>
          <CopyButton text={endpoint} />
        </div>
        <div style={{ marginTop: 6, fontSize: "var(--fs-14)" }}>驗證：HTTP 標頭 <code>x-api-key: 你的金鑰</code></div>
      </Card>

      {/* 建立金鑰 */}
      <h2 style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 8 }}><Icon name="Plus" size={18} />建立金鑰</h2>
      <Card>
        <form onSubmit={submit} className="stack" style={{ gap: 12 }}>
          <div>
            <label htmlFor="mcp-label" style={{ fontSize: "var(--fs-13)", fontWeight: 600 }}>用途名稱</label>
            <input
              id="mcp-label"
              placeholder="例如：我的筆電 Claude、報表自動化"
              value={label}
              maxLength={40}
              onChange={(e) => setLabel(e.target.value)}
              style={{ width: "100%", marginTop: 4 }}
            />
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px" }}>
              <label htmlFor="mcp-scope" style={{ fontSize: "var(--fs-13)", fontWeight: 600 }}>權限</label>
              <select id="mcp-scope" value={readOnly ? "read" : "write"} onChange={(e) => setReadOnly(e.target.value === "read")} style={{ width: "100%", marginTop: 4 }}>
                <option value="write">可讀可寫（能送生成、留言、寫資料）</option>
                <option value="read">唯讀（只能查詢，不能寫入／扣點）</option>
              </select>
            </div>
            <div style={{ flex: "1 1 160px" }}>
              <label htmlFor="mcp-exp" style={{ fontSize: "var(--fs-13)", fontWeight: 600 }}>有效期限</label>
              <select id="mcp-exp" value={expireDays} onChange={(e) => setExpireDays(e.target.value)} style={{ width: "100%", marginTop: 4 }}>
                <option value="0">永久</option>
                <option value="7">7 天</option>
                <option value="30">30 天</option>
                <option value="90">90 天</option>
                <option value="365">1 年</option>
              </select>
            </div>
          </div>
          <div>
            <button className="primary" type="submit" disabled={!label.trim() || create.isPending} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon name="Plus" size={14} />{create.isPending ? "建立中…" : "建立金鑰"}
            </button>
          </div>
        </form>
        {create.error && <p className="error" role="alert">{create.error.message}</p>}

        {/* 剛建立：原文只顯示一次＋設定範例＋測試連線 */}
        {fresh && (
          <div style={{ marginTop: 14, padding: "14px 16px", border: "1px solid var(--primary)", borderRadius: "var(--r-8)" }} role="status">
            <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="Lock" size={15} />「{fresh.label}」已建立{fresh.readOnly ? "（唯讀）" : ""}
            </div>
            <Hint layer="always" style={{ margin: "6px 0 8px", color: "var(--gold-ink)" }}>
              ⚠️ 金鑰只顯示這一次，請立刻複製收好；關掉後就再也拿不回（只能撤銷後重建）。
            </Hint>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <code style={{ flex: "1 1 260px", wordBreak: "break-all", fontSize: "var(--fs-13)" }}>{fresh.token}</code>
              <CopyButton text={fresh.token} label="複製金鑰" />
            </div>

            <Hint layer="always" style={{ margin: "10px 0 0" }}>
              下一步：到下方「<a href="#mcp-clients">貼進你的 AI 客戶端</a>」照步驟貼上設定——趁這一頁還開著，範例已自動帶入這把金鑰。
            </Hint>

            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button type="button" onClick={testConnection} disabled={testing} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon name="Sparkles" size={14} />{testing ? "測試中…" : "測試連線"}
              </button>
              {testResult && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--fs-13)", color: testResult.ok ? "var(--success-ink)" : "var(--danger-ink)" }}>
                  <Icon name={testResult.ok ? "CheckCircle2" : "XCircle"} size={15} />{testResult.text}
                </span>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* 各客戶端接法：常駐顯示（先前只在剛建立金鑰時出現設定範例，關掉頁面就找不回教學了） */}
      <h2 id="mcp-clients" style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 8 }}><Icon name="Monitor" size={18} />貼進你的 AI 客戶端</h2>
      <Hint layer="always" style={{ marginTop: 0 }}>
        {fresh
          ? "範例已自動帶入剛建立的金鑰，直接複製即可。"
          : <>範例裡的「<code>你的金鑰</code>」請換成你建立時收好的那一串；忘了存就撤銷舊的再建一把。</>}
      </Hint>
      <div className="stack" style={{ gap: 8 }}>
        <ClientGuide name="Claude 桌面版（最常見）" defaultOpen>
          <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>
            <li>打開 Claude 桌面版 → 設定（Settings）→「開發者（Developer）」→「編輯設定（Edit Config）」，會開啟 <code>claude_desktop_config.json</code>。</li>
            <li>把下面整段貼進去存檔（檔案裡已有其他 <code>mcpServers</code> 的話，把 <code>ai-director</code> 那段合併進去）。</li>
            <li>完全關閉再重開 Claude。輸入框旁多出工具圖示，就代表接上了。</li>
          </ol>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <span style={{ fontSize: "var(--fs-13)", fontWeight: 600 }}>MCP 設定：</span>
            <CopyButton text={clientConfig} label="複製設定" />
          </div>
          <pre style={{ marginTop: 6, padding: 12, background: "var(--card2)", borderRadius: "var(--r-8)", overflowX: "auto", fontSize: "var(--fs-12)", lineHeight: 1.6 }}>{clientConfig}</pre>
        </ClientGuide>
        <ClientGuide name="Claude Code（終端機）">
          在終端機貼這一行（把金鑰換成你的），之後在 Claude Code 對話裡直接叫它查專案即可：
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <code style={{ flex: "1 1 260px", wordBreak: "break-all", fontSize: "var(--fs-12)", padding: 10, background: "var(--card2)", borderRadius: "var(--r-8)" }}>{claudeCodeCmd}</code>
            <CopyButton text={claudeCodeCmd} label="複製指令" />
          </div>
        </ClientGuide>
        <ClientGuide name="其他支援 MCP 的工具（Cursor、Cline…）">
          傳輸方式選「<b>HTTP</b>（Streamable HTTP）」，端點填上方「連線位置」的網址，再加一個 HTTP 標頭 <code>x-api-key: 你的金鑰</code>。各工具的設定介面不同，但要填的就這兩樣。
        </ClientGuide>
      </div>
      <Hint layer="always" style={{ marginTop: 8 }}>
        <Icon name="Smartphone" size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />
        手機的 Claude App 目前接不了這種帶金鑰的 MCP 伺服器——第 ② 步請在電腦上完成，接上後在電腦端對話使用。
      </Hint>

      {/* 範例句：接上之後「要說什麼」——工具名對新手沒意義，給可照抄的白話需求 */}
      <h2 id="mcp-examples" style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 8 }}><Icon name="MessageSquare" size={18} />接上後可以這樣說</h2>
      <Hint layer="always" style={{ marginTop: 0 }}>對 Claude 照抄或改編下面的話就能開始。不用背工具名——AI 會自己挑對的工具。</Hint>
      <Card>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {EXAMPLE_PROMPTS.map((p) => (
            <li key={p.say} style={{ display: "flex", gap: 10, padding: "10px 0", borderTop: "1px solid var(--border)", alignItems: "baseline", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                <span style={{ fontSize: "var(--fs-14)" }}>「{p.say}」</span>
                <Meta as="div" style={{ fontSize: 12, marginTop: 2 }}>{p.note}</Meta>
              </div>
              <CopyButton text={p.say} />
            </li>
          ))}
        </ul>
      </Card>

      {/* 我的金鑰 */}
      <h2 style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 8 }}><Icon name="Lock" size={18} />我的金鑰（{activeCount} 把使用中）</h2>
      <Card>
        {tokens.isLoading ? (
          <><Skeleton style={{ height: 40 }} /><Skeleton style={{ height: 40, marginTop: 8 }} /></>
        ) : tokens.error ? (
          <Meta as="p" style={{ margin: 0, color: "var(--danger-ink)" }}>載入金鑰失敗：{tokens.error.message}</Meta>
        ) : list.length === 0 ? (
          <Hint layer="always" style={{ margin: 0 }}>還沒有金鑰。在上面建立一把即可開始連線。</Hint>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {list.map((t) => {
              const exp = expiryLabel(t.expiresAt);
              const dead = !!t.revokedAt || exp.expired;
              return (
                <li key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--border)", flexWrap: "wrap", opacity: dead ? 0.55 : 1 }}>
                  <div style={{ flex: "1 1 auto", minWidth: 160 }}>
                    <b style={{ textDecoration: t.revokedAt ? "line-through" : undefined }}>{t.label}</b>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "4px 0" }}>
                      <Pill style={{ background: t.readOnly ? "var(--card2)" : undefined }}>{t.readOnly ? "唯讀" : "可讀可寫"}</Pill>
                      <Pill style={{ color: exp.expired ? "var(--danger-ink)" : undefined }}>{exp.text}</Pill>
                    </div>
                    <Meta style={{ fontSize: 12 }}>
                      建立 {fmtDate(t.createdAt)}
                      {t.lastUsedAt ? `・最近使用 ${relTime(t.lastUsedAt)}` : "・尚未使用"}
                      {t.revokedAt ? `・已撤銷 ${fmtDate(t.revokedAt)}` : ""}
                    </Meta>
                  </div>
                  {t.revokedAt ? (
                    <Meta style={{ flex: "none" }}>已撤銷</Meta>
                  ) : (
                    <button
                      type="button"
                      style={{ padding: "3px 12px", fontSize: "var(--fs-12)", flex: "none" }}
                      disabled={revoke.isPending}
                      onClick={() => { if (window.confirm(`撤銷「${t.label}」？帶這把金鑰連線會立即失效，此動作無法復原。`)) revoke.mutate({ id: t.id }); }}
                    >
                      撤銷
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {revoke.error && <p className="error" role="alert">{revoke.error.message}</p>}
      </Card>

      {/* 工具手冊 */}
      <h2 style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 8 }}><Icon name="Info" size={18} />可用工具</h2>
      <Hint layer="always" style={{ marginTop: 0 }}>
        連進來的 AI 可呼叫以下工具。<b>讀取</b>類唯讀金鑰也能用；<b>寫入</b>類會扣點／留痕，唯讀金鑰一律擋下。
      </Hint>
      <Hint as="ul" style={{ marginTop: 0, paddingLeft: 20, lineHeight: 1.9 }}>
        <li>先讀全貌：<code>get_project_status</code>（分鏡／生成／代理／排程／待辦一次到位）。</li>
        <li>自己生成：<code>find_model → submit_generation → get_generation（輪詢到完成）→ list_assets（取回成品）</code>。</li>
        <li>交給 AI 執行計畫：<code>plan_agent → approve_agent → get_agent_run（追進度）</code>——一句目標讓內建助手背景跑完多步製作。</li>
        <li>排時程：<code>list_schedule／add_schedule_item</code> 把交付死線與會議掛到專案與組行事曆。</li>
      </Hint>
      <Card>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {MCP_TOOLS.map((tool) => (
            <li key={tool.name} style={{ display: "flex", gap: 10, padding: "9px 0", borderTop: "1px solid var(--border)", alignItems: "baseline" }}>
              <Pill style={{ flex: "none", minWidth: 44, textAlign: "center", color: tool.access === "write" ? "var(--gold-ink)" : undefined }}>
                {tool.access === "write" ? "寫入" : "讀取"}
              </Pill>
              <div style={{ flex: "1 1 auto" }}>
                <code style={{ fontSize: "var(--fs-13)" }}>{tool.name}</code>
                <span style={{ marginLeft: 8, color: "var(--fg-secondary)" }}>{tool.title}</span>
                <Meta as="div" style={{ fontSize: 12, marginTop: 2 }}>{tool.blurb}</Meta>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* 近期活動 */}
      <h2 style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 8 }}><Icon name="Clock" size={18} />近期 MCP 活動</h2>
      <Hint layer="always" style={{ marginTop: 0 }}>你透過 MCP 觸發的操作紀錄（依使用者歸屬，非單把金鑰）。看到不認得的呼叫，請撤銷可疑金鑰。</Hint>
      <Card>
        {activity.isLoading ? (
          <Skeleton style={{ height: 36 }} />
        ) : activity.error ? (
          <Meta as="p" style={{ margin: 0, color: "var(--danger-ink)" }}>載入活動失敗：{activity.error.message}</Meta>
        ) : !activity.data || activity.data.length === 0 ? (
          <Hint style={{ margin: 0 }}>還沒有 MCP 活動。連上外部 AI 並呼叫工具後，這裡會列出紀錄。</Hint>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {activity.data.map((r) => {
              const summary = summarizeAuditInput(r.input);
              return (
                <li key={r.id} style={{ display: "flex", gap: 8, padding: "8px 0", borderTop: "1px solid var(--border)", alignItems: "baseline", flexWrap: "wrap" }}>
                  <Icon name={r.ok ? "CheckCircle2" : "XCircle"} size={14} style={{ color: r.ok ? "var(--success-ink)" : "var(--danger-ink)", flex: "none", alignSelf: "center" }} />
                  <span style={{ flex: "1 1 auto", minWidth: 160 }}>
                    <b style={{ fontSize: "var(--fs-14)" }}>{humanizeAuditAction(r.action)}</b>
                    {summary && <Meta style={{ marginLeft: 6, fontSize: 12 }}>{summary}</Meta>}
                    {!r.ok && r.error && <Meta as="div" style={{ fontSize: 12, color: "var(--danger-ink)" }}>{r.error}</Meta>}
                  </span>
                  <Meta style={{ fontSize: 12, flex: "none" }}>{relTime(r.createdAt)}</Meta>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <p style={{ marginTop: 24 }}>
        <Link href="/help">回怎麼用</Link>
        <Meta style={{ margin: "0 10px" }}>·</Meta>
        <Link href="/dashboard">回今日工作台</Link>
      </p>
    </div>
  );
}
