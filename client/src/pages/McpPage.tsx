import { useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";
import { MCP_TOOLS } from "../../../shared/mcpCatalog";
import { humanizeAuditAction, summarizeAuditInput } from "../../../shared/auditWording";

import { Hint, Meta, Pill } from "../components/ui";
/**
 * MCP 專區（接上外部 AI 的控制中心）：連線設定 → 建立金鑰（可設唯讀／到期）→ 我的金鑰（權限一目了然）
 * → 測試連線（whoami）→ 工具手冊 → 近期活動。
 * 核心語意：金鑰＝你本人的身分。外部 AI 客戶端帶你的金鑰連進來，只能做你本來就能做的事——
 * 你的組、你的專案權限、你的點數額度、你的核准門檻都照算；唯讀金鑰再進一步只准讀取。
 */

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
      <div className="card" style={{ borderLeft: "3px solid var(--gold-ink)", background: "var(--card2)" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <Icon name="TriangleAlert" size={18} style={{ color: "var(--gold-ink)", flex: "none", marginTop: 2 }} />
          <div style={{ fontSize: "var(--fs-14)", lineHeight: 1.8 }}>
            <b>金鑰請當密碼保管。</b>別人拿到就等同以你的身分操作系統。要交給外部自動化時，建議勾<b>唯讀</b>並設<b>到期日</b>，
            把權限縮到最小；任何一把都能隨時撤銷。
          </div>
        </div>
      </div>

      {/* 連線資訊 */}
      <h2 style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 8 }}><Icon name="ArrowRight" size={18} />連線位置</h2>
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: "var(--fs-14)" }}>
          <span>端點：<code>POST {endpoint}</code></span>
          <CopyButton text={endpoint} />
        </div>
        <div style={{ marginTop: 6, fontSize: "var(--fs-14)" }}>驗證：HTTP 標頭 <code>x-api-key: 你的金鑰</code></div>
      </div>

      {/* 建立金鑰 */}
      <h2 style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 8 }}><Icon name="Plus" size={18} />建立金鑰</h2>
      <div className="card">
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

            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: "var(--fs-13)", fontWeight: 600 }}>貼進 Claude 桌面版（或相容客戶端）的 MCP 設定：</span>
                <CopyButton text={clientConfig} label="複製設定" />
              </div>
              <pre style={{ marginTop: 6, padding: 12, background: "var(--card2)", borderRadius: "var(--r-8)", overflowX: "auto", fontSize: "var(--fs-12)", lineHeight: 1.6 }}>{clientConfig}</pre>
            </div>

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
      </div>

      {/* 我的金鑰 */}
      <h2 style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 8 }}><Icon name="Lock" size={18} />我的金鑰（{activeCount} 把使用中）</h2>
      <div className="card">
        {tokens.isLoading ? (
          <><div className="skeleton" style={{ height: 40 }} /><div className="skeleton" style={{ height: 40, marginTop: 8 }} /></>
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
      </div>

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
      <div className="card">
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
      </div>

      {/* 近期活動 */}
      <h2 style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 8 }}><Icon name="Clock" size={18} />近期 MCP 活動</h2>
      <Hint layer="always" style={{ marginTop: 0 }}>你透過 MCP 觸發的操作紀錄（依使用者歸屬，非單把金鑰）。看到不認得的呼叫，請撤銷可疑金鑰。</Hint>
      <div className="card">
        {activity.isLoading ? (
          <div className="skeleton" style={{ height: 36 }} />
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
      </div>

      <p style={{ marginTop: 24 }}>
        <Link href="/help">回怎麼用</Link>
        <Meta style={{ margin: "0 10px" }}>·</Meta>
        <Link href="/dashboard">回今日工作台</Link>
      </p>
    </div>
  );
}
