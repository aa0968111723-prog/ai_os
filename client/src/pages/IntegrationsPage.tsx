import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { ConfirmButton } from "../components/interactions";

/**
 * 整合連接（/integrations）：每個人自己連「自己的」外部服務——
 * Google 雲端硬碟（OAuth，只讀）、Notion（個人 integration token）、外部資料庫/API（自帶金鑰）。
 * 連上後在資料庫的「從網址匯入」「匯入資料」直接生效：私有 Google 檔、自己的 Notion 頁、
 * 自家系統的 API 都抓得到。憑證加密存放、永不回顯；權限只及本人，隨時可移除。
 */
export function IntegrationsPage() {
  const utils = trpc.useUtils();
  const list = trpc.integrations.list.useQuery();
  const remove = trpc.integrations.remove.useMutation({ onSuccess: () => utils.integrations.list.invalidate() });

  // Google OAuth 回跳的一次性訊息（?gdrive=...）：顯示後清掉網址參數，重新整理不再重播
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("gdrive");
    if (!q) return;
    setFlash(
      q === "connected" ? "已連結 Google 雲端硬碟——現在可以直接匯入你雲端裡的私有文件了"
      : q === "denied" ? "已取消 Google 授權——隨時可以再連結"
      : q === "state_mismatch" ? "授權連結已過期，請重新點「連結 Google 雲端」"
      : "連結失敗，請稍後再試",
    );
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const d = list.data;

  return (
    <div>
      <h1>整合連接</h1>
      <p className="hint">
        把「你自己的」Google 雲端、Notion、外部資料庫接進來——連上後在資料庫頁匯入私有內容就像貼公開連結一樣簡單。
        憑證以 AES-256 加密存放、永遠不會回顯；只有你本人用得到，隨時可以移除。
      </p>
      {flash && <p className="hint" style={{ color: "var(--success-ink)" }}>{flash}</p>}
      {remove.error && <p className="error" role="alert">{remove.error.message}</p>}

      {/* ── Google 雲端硬碟 ── */}
      <section className="card" style={{ marginTop: 12 }} data-fb="整合-Google雲端卡">
        <h2><Icon name="CalendarPlus" size={18} /> Google 雲端硬碟</h2>
        <p className="hint" style={{ marginTop: 4 }}>
          連結後，資料庫「從網址匯入」貼你自己雲端裡的文件／試算表／簡報／檔案連結即可匯入——不必再把檔案設成公開。
          授權範圍只有「讀取」，本系統不能修改或刪除你雲端裡的任何東西。
        </p>
        {!d ? (
          <p className="hint">載入中…</p>
        ) : !d.googleDrive.configured ? (
          <p className="hint">站方尚未設定 Google 整合（管理員需設 GOOGLE_CLIENT_ID／SECRET 並註冊 redirect URI）——設定後這裡就能一鍵連結。</p>
        ) : !d.googleDrive.connected ? (
          <a className="btn-sm primary" href="/api/integrations/google-drive/start" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="Plus" size={14} /> 連結 Google 雲端
          </a>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {d.googleDrive.status === "error" ? (
              <>
                <span className="hint" style={{ margin: 0, color: "var(--danger-ink, #a33)" }} title={d.googleDrive.lastError ?? undefined}>
                  授權已失效{d.googleDrive.email ? `（${d.googleDrive.email}）` : ""}
                </span>
                <a className="btn-sm" href="/api/integrations/google-drive/start">重新連結</a>
              </>
            ) : (
              <span className="hint" style={{ margin: 0 }}>
                <Icon name="Check" size={13} /> 已連結{d.googleDrive.email ? `（${d.googleDrive.email}）` : ""}——匯入私有檔已生效
              </span>
            )}
            <GoogleRemoveButton onRemoved={() => utils.integrations.list.invalidate()} />
          </div>
        )}
      </section>

      {/* ── Notion ── */}
      <NotionCard data={d?.notion ?? null} />

      {/* ── 外部資料庫/API ── */}
      <ApiConnectionsCard apis={d?.apis ?? []} onRemove={(id) => remove.mutate({ id })} removing={remove.isPending} />

      <p style={{ marginTop: 24 }}><Link href="/databases">去資料庫用用看 →</Link>　<Link href="/">回作業台</Link></p>
    </div>
  );
}

/** Google 中斷連結（撤銷授權＋刪本地紀錄）；一人一條連線，走 kind 專屬端點免傳 id */
function GoogleRemoveButton({ onRemoved }: { onRemoved: () => void }) {
  const removeByKind = trpc.integrations.removeGoogleDrive.useMutation({ onSuccess: onRemoved });
  return (
    <ConfirmButton
      onConfirm={() => removeByKind.mutate()}
      message="中斷 Google 雲端連結？會撤銷授權（你雲端裡的檔案不受任何影響）。"
      triggerClassName="btn-sm"
      disabled={removeByKind.isPending}
    >
      中斷連結
    </ConfirmButton>
  );
}

function NotionCard({ data }: { data: { connected: boolean; workspace: string | null; last4: string | null; status: string | null; lastError: string | null; siteTokenAvailable: boolean } | null }) {
  const utils = trpc.useUtils();
  const [token, setToken] = useState("");
  const [editing, setEditing] = useState(false);
  const setNotion = trpc.integrations.setNotion.useMutation({
    onSuccess: () => { utils.integrations.list.invalidate(); setToken(""); setEditing(false); },
  });
  const removeNotion = trpc.integrations.removeNotion.useMutation({ onSuccess: () => utils.integrations.list.invalidate() });

  return (
    <section className="card" style={{ marginTop: 12 }} data-fb="整合-Notion卡">
      <h2><Icon name="FileText" size={18} /> Notion</h2>
      <p className="hint" style={{ marginTop: 4 }}>
        到 <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer">notion.so/my-integrations</a> 建立整合、
        複製 Internal Integration Secret 貼進來，並在 Notion 把要匯入的頁面「連結」給該整合（頁面右上 ⋯ → Connections）。
        之後資料庫「從網址匯入」貼你的 Notion 頁面連結即可。
        {data?.siteTokenAvailable && !data.connected ? "（站方已設共用 token，你也可以不設、直接用共用的）" : ""}
      </p>
      {!data ? (
        <p className="hint">載入中…</p>
      ) : data.connected && !editing ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {data.status === "error" ? (
            <span className="hint" style={{ margin: 0, color: "var(--danger-ink, #a33)" }} title={data.lastError ?? undefined}>
              token 已失效——請重新設定
            </span>
          ) : (
            <span className="hint" style={{ margin: 0 }}>
              <Icon name="Check" size={13} /> 已設定{data.workspace ? `（workspace：${data.workspace}）` : ""}{data.last4 ? `・末四碼 ${data.last4}` : ""}
            </span>
          )}
          <button className="btn-sm" onClick={() => setEditing(true)}>更換 token</button>
          <ConfirmButton
            onConfirm={() => removeNotion.mutate()}
            message="移除你的 Notion token？（之後 Notion 匯入會退回站方共用設定——若站方沒設則無法匯入）"
            triggerClassName="btn-sm"
            disabled={removeNotion.isPending}
          >
            移除
          </ConfirmButton>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="password"
            aria-label="Notion integration token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ntn_… 或 secret_…"
            style={{ flex: "1 1 260px", maxWidth: 420 }}
            autoComplete="off"
          />
          <button className="btn-sm primary" disabled={!token.trim() || setNotion.isPending} onClick={() => setNotion.mutate({ token: token.trim() })}>
            {setNotion.isPending ? "驗證中…" : "驗證並儲存"}
          </button>
          {editing && <button className="btn-sm" onClick={() => { setEditing(false); setToken(""); }}>取消</button>}
        </div>
      )}
      {setNotion.error && <p className="error" role="alert">{setNotion.error.message}</p>}
      {removeNotion.error && <p className="error" role="alert">{removeNotion.error.message}</p>}
      <p className="hint" style={{ marginTop: 6 }}><Icon name="Lock" size={12} /> token 送出後即加密存放，不會再顯示——之後只看得到末四碼。</p>
    </section>
  );
}

function ApiConnectionsCard({ apis, onRemove, removing }: {
  apis: Array<{ id: string; name: string; baseUrl: string; authHeader: string; last4: string | null; status: string; lastError: string | null; lastUsedAt: string | Date | null }>;
  onRemove: (id: string) => void;
  removing: boolean;
}) {
  const utils = trpc.useUtils();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [headerName, setHeaderName] = useState("Authorization");
  const [secret, setSecret] = useState("");
  const [testResult, setTestResult] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const testPath = useRef<Record<string, string>>({});
  const addApi = trpc.integrations.addApi.useMutation({
    onSuccess: () => {
      utils.integrations.list.invalidate();
      setAdding(false);
      setName(""); setBaseUrl(""); setHeaderName("Authorization"); setSecret("");
    },
  });
  const fetchApi = trpc.integrations.fetchApi.useMutation();

  const test = (id: string) => {
    setTestResult(null);
    fetchApi.mutate(
      { id, path: (testPath.current[id] ?? "").trim() || undefined },
      {
        onSuccess: (r) => setTestResult({ id, ok: true, text: `HTTP ${r.status}・${r.mime}・${r.content.length.toLocaleString()} 字${r.truncated ? "（已截斷）" : ""}：${r.content.slice(0, 160)}` }),
        onError: (e) => setTestResult({ id, ok: false, text: e.message }),
      },
    );
  };

  return (
    <section className="card" style={{ marginTop: 12 }} data-fb="整合-外部API卡">
      <h2><Icon name="Package" size={18} /> 外部資料庫／API</h2>
      <p className="hint" style={{ marginTop: 4 }}>
        把你自己系統的 API 接進來（Airtable、Supabase、自建服務、任何回 JSON/CSV 的端點）：
        存一條「基底網址＋認證標頭」，之後在資料庫的「匯入資料」面板一鍵抓取、直接進表。
        金鑰加密存放；抓取固定走你登記的主機（憑證絕不會被送去別的網址）、僅限 https。
      </p>

      {apis.length === 0 && !adding && <p className="hint">還沒有連接——按下面「新增連接」開始。</p>}
      {apis.map((c) => (
        <div key={c.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border-soft, #eee)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>{c.name}</span>
            <span className="meta mono" style={{ wordBreak: "break-all" }}>{c.baseUrl}</span>
            <span className="badge" title={`認證標頭：${c.authHeader}`}>{c.authHeader}{c.last4 ? `・末四碼 ${c.last4}` : ""}</span>
            {c.lastError && <span className="meta" style={{ color: "var(--danger-ink, #a33)" }} title={c.lastError}>上次錯誤</span>}
            <span className="spacer" />
            <input
              aria-label={`測試路徑（${c.name}）`}
              placeholder="路徑（選填）如 /rows?limit=5"
              style={{ width: 180 }}
              onChange={(e) => { testPath.current[c.id] = e.target.value; }}
            />
            <button className="btn-sm" disabled={fetchApi.isPending} onClick={() => test(c.id)}>
              {fetchApi.isPending ? "抓取中…" : "測試抓取"}
            </button>
            <ConfirmButton
              onConfirm={() => onRemove(c.id)}
              message={`刪除連接「${c.name}」？（已加密的金鑰會一併刪除）`}
              triggerClassName="btn-sm"
              disabled={removing}
              triggerAriaLabel={`刪除連接 ${c.name}`}
            >
              <Icon name="X" size={13} />
            </ConfirmButton>
          </div>
          {testResult?.id === c.id && (
            <p className="meta" style={{ margin: "6px 0 0", color: testResult.ok ? "var(--success-ink)" : "var(--danger-ink, #a33)", wordBreak: "break-all" }}>
              {testResult.text}
            </p>
          )}
        </div>
      ))}

      {adding ? (
        <div style={{ marginTop: 10, display: "grid", gap: 6, maxWidth: 560 }}>
          <input aria-label="連接名稱" value={name} maxLength={60} placeholder="名稱（例：總會 Airtable）" onChange={(e) => setName(e.target.value)} />
          <input aria-label="基底網址" value={baseUrl} maxLength={500} placeholder="基底網址（https://api.airtable.com/v0/appXXX/表名）" onChange={(e) => setBaseUrl(e.target.value)} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input aria-label="認證標頭名" value={headerName} maxLength={64} placeholder="認證標頭名" style={{ flex: "0 1 180px" }} onChange={(e) => setHeaderName(e.target.value)} />
            <input
              type="password"
              aria-label="API 金鑰"
              value={secret}
              maxLength={2000}
              placeholder="標頭值（例：Bearer patXXXX…）"
              style={{ flex: "1 1 240px" }}
              autoComplete="off"
              onChange={(e) => setSecret(e.target.value)}
            />
          </div>
          <p className="hint" style={{ margin: 0 }}>標頭值原樣送出——需要 Bearer 前綴就一起貼（如「Bearer pat123」）。</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn-sm primary"
              disabled={!name.trim() || !baseUrl.trim() || !secret || addApi.isPending}
              onClick={() => addApi.mutate({ name: name.trim(), baseUrl: baseUrl.trim(), headerName: headerName.trim() || undefined, secret })}
            >
              {addApi.isPending ? "建立中…" : "建立連接"}
            </button>
            <button className="btn-sm" onClick={() => setAdding(false)}>取消</button>
          </div>
          {addApi.error && <p className="error" role="alert">{addApi.error.message}</p>}
        </div>
      ) : (
        <button className="btn-sm" style={{ marginTop: 10 }} onClick={() => setAdding(true)}>
          <Icon name="Plus" size={13} /> 新增連接
        </button>
      )}
    </section>
  );
}
