import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { sanitizeReturnTo, withReturnTo } from "@shared/returnTo";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { ConfirmButton } from "../components/interactions";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";
import { AdobeConnectButton } from "../components/settings/AdobeConnectButton";
import { AdobeConnectionStatus } from "../components/settings/AdobeConnectionStatus";
import { useAdobeConnection } from "../hooks/useAdobeConnection";
import { PersonalAiKeyCard } from "../components/settings/PersonalAiKeyCard";

import { Badge, Button, Card, Hint, Meta } from "../components/ui";
/**
 * 連接的資料來源（/integrations）：每個人自己連「自己的」外部服務——
 * Google 雲端硬碟（OAuth，只讀）、Notion（個人 integration token）、外部資料庫/API（自帶金鑰）。
 * 連上後在「資料中心」的匯入入口直接生效：私有 Google 檔、自己的 Notion 頁與資料庫、
 * 自家系統的 API 都抓得到。憑證加密存放、永不回顯；權限只及本人，隨時可移除。
 */
export function IntegrationsPage() {
  const utils = trpc.useUtils();
  const list = trpc.integrations.list.useQuery();
  const remove = trpc.integrations.remove.useMutation({ onSuccess: () => utils.integrations.list.invalidate() });

  /**
   * 使用者可能是從某個「加入資料」流程被帶來這裡的（?return=<站內路徑>）。
   * 連接完成後要送他回去，而不是留在設定頁自己找路。掛載時讀一次即可——
   * 之後的操作交回使用者。
   */
  const returnTo = useMemo(
    () => sanitizeReturnTo(new URLSearchParams(window.location.search).get("return")),
    [],
  );
  const driveStartHref = withReturnTo("/api/integrations/google-drive/start", returnTo);

  // Google OAuth 回跳的一次性訊息（?gdrive=...）：顯示後清掉網址參數，重新整理不再重播
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("gdrive");
    if (!q) return;
    setFlash(
      q === "connected" ? "已連結 Google 雲端硬碟——現在可以到「資料中心」匯入你的私人文件"
      : q === "denied" ? "已取消 Google 授權——隨時可以再連結"
      : q === "state_mismatch" ? "授權連結已過期，請重新點「連結 Google 雲端」"
      : "連結失敗，請稍後再試",
    );
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const d = list.data;

  return (
    <div className="page-shell secondary-page integrations-page">
      {/*
        §24 重新定位：這一頁不只放資料來源（還有 Adobe、個人 AI 金鑰等服務），
        所以名稱與導覽一致改成「連接與服務」。日常加入資料不必來這裡——
        Google／Notion 的連接已經內建在「＋加入資料」的流程裡。
      */}
      <SecondaryPageHeader
        eyebrow="進階設定"
        title="連接與服務"
        icon="ArrowRight"
        badge="連接不等於自動匯入"
        description={<>管理已連接的帳號與服務。日常要加資料不用來這裡——在專案或資料中心按「＋加入資料」就好。</>}
      />
      {flash && <Meta as="p" style={{ color: "var(--success-ink)" }}>{flash}</Meta>}
      {list.error && (
        <p className="error" role="alert">
          載入資料來源設定失敗：{list.error.message}　<Button size="sm" onClick={() => list.refetch()}>重試</Button>
        </p>
      )}
      {remove.error && <p className="error" role="alert">{remove.error.message}</p>}

      <section className="integration-status-grid" aria-label="資料來源連線概況">
        <a href="#integration-google" className={`integration-status-card${d?.googleDrive.connected ? " is-connected" : ""}`}>
          <span className="integration-status-card__icon"><Icon name="CalendarPlus" size={18} /></span>
          <span>
            <strong>Google 雲端</strong>
            <small>
              {!d ? "讀取狀態中" : d.googleDrive.status === "error" ? "授權需重新連接" : d.googleDrive.connected ? "已連接・唯讀" : d.googleDrive.configured ? "可連接" : "站方尚未設定"}
            </small>
          </span>
          <span className="integration-status-card__signal" aria-hidden />
        </a>
        <a href="#integration-notion" className={`integration-status-card${d?.notion.connected ? " is-connected" : ""}`}>
          <span className="integration-status-card__icon notion"><Icon name="FileText" size={18} /></span>
          <span>
            <strong>Notion</strong>
            <small>{!d ? "讀取狀態中" : d.notion.status === "error" ? "Token 需更新" : d.notion.connected ? "已設定工作區" : "尚未連接"}</small>
          </span>
          <span className="integration-status-card__signal" aria-hidden />
        </a>
        <a href="#integration-api" className={`integration-status-card${(d?.apis.length ?? 0) > 0 ? " is-connected" : ""}`}>
          <span className="integration-status-card__icon api"><Icon name="Database" size={18} /></span>
          <span>
            <strong>外部 API</strong>
            <small>{!d ? "讀取狀態中" : d.apis.length > 0 ? `${d.apis.length} 個連接` : "尚未新增"}</small>
          </span>
          <span className="integration-status-card__signal" aria-hidden />
        </a>
      </section>

      {/*
        §64：不要用 UI 教使用者架構。這裡原本是「連接 → 挑選 → 交給 AI」三步驟圖——
        那張圖的存在本身就是在說「這個流程需要解釋」。操作本身就該是教學：
        連接內建在「＋加入資料」裡，所以這裡只留一句話與一個回去的入口。
      */}
      <Hint>
        連接只是讓你可以去自己的帳號挑東西；AI 只讀得到你選中並加入站內的內容。
        {" "}
        <Link href="/databases">回資料中心加入資料 →</Link>
      </Hint>

      {/* ── Google 雲端硬碟 ── */}
      <Card as="section" id="integration-google" style={{ marginTop: 12 }} data-fb="資料來源-Google雲端卡">
        <h2><Icon name="CalendarPlus" size={18} /> Google 雲端硬碟</h2>
        <Hint style={{ marginTop: 4 }}>
          連結後，到「資料中心」用「從 Google 雲端選檔」直接瀏覽並多選匯入（也可照舊貼連結），不必再把檔案設成公開。
        </Hint>
        {/* 權限範圍是「按下連結鍵之前必須看到」的資訊：不知道我們拿到什麼權限就交出雲端帳號，不行。 */}
        <Hint style={{ marginTop: 4 }}>
          AI 與代理只會讀「你選中並匯入」的檔案，不是整顆雲端；授權範圍只有「讀取」，本系統不能修改或刪除你雲端裡的任何東西。
        </Hint>
        {!d ? (
          <Meta as="p">載入中…</Meta>
        ) : !d.googleDrive.configured ? (
          <Hint>站方尚未設定 Google 整合（管理員需設 GOOGLE_CLIENT_ID／SECRET 並註冊 redirect URI）——設定後這裡就能一鍵連結。</Hint>
        ) : !d.googleDrive.connected ? (
          <a className="btn-sm primary" href={driveStartHref} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="Plus" size={14} /> 連結 Google 雲端
          </a>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {d.googleDrive.status === "error" ? (
              <>
                <Meta style={{ margin: 0, color: "var(--danger-ink, #a33)" }} title={d.googleDrive.lastError ?? undefined}>
                  授權已失效{d.googleDrive.email ? `（${d.googleDrive.email}）` : ""}
                </Meta>
                <a className="btn-sm" href={driveStartHref}>重新連結</a>
              </>
            ) : (
              <Meta style={{ margin: 0 }}>
                <Icon name="Check" size={13} /> 已連結{d.googleDrive.email ? `（${d.googleDrive.email}）` : ""}——可在「資料中心」選檔或貼連結匯入私人檔案
              </Meta>
            )}
            <GoogleRemoveButton onRemoved={() => utils.integrations.list.invalidate()} />
          </div>
        )}
      </Card>

      {/* ── Notion ── */}
      <NotionCard data={d?.notion ?? null} returnTo={returnTo} />

      {/* ── 個人 AI 金鑰（BYOK fal.ai）── */}
      <PersonalAiKeyCard />

      {/* ── Adobe 帳號（修圖／剪輯）── */}
      <AdobeCard />

      {/* ── 外部資料來源/API ── */}
      <ApiConnectionsCard apis={d?.apis ?? []} onRemove={(id) => remove.mutate({ id })} removingId={remove.isPending ? remove.variables?.id ?? null : null} />

      <p style={{ marginTop: 24 }}><Link href="/databases">前往資料中心 →</Link>　<Link href="/dashboard">回今日工作台</Link></p>
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

/**
 * Adobe 帳號連結（#224 PR2）：連上之後 AI 可直接在使用者「自己的」Adobe 帳號內修圖與備稿，
 * 少掉「下載 → 上傳 → 再下載」的來回。模擬模式下整條流程照跑，只是不會真的動到 Adobe。
 */
function AdobeCard() {
  const { data, flash, disconnect, startUrl } = useAdobeConnection();
  return (
    <Card as="section" id="integration-adobe" style={{ marginTop: 12 }} data-fb="資料來源-Adobe卡">
      <h2><Icon name="Palette" size={18} /> Adobe 帳號（修圖／剪輯）</h2>
      <Hint style={{ marginTop: 4 }}>
        連結你自己的 Adobe 帳號後，可以請 AI 直接在該帳號內完成去背、調色等修圖，並把剪輯素材備好，
        不必再一路下載上傳。素材與成品都留在你的 Adobe 帳號裡。
      </Hint>
      <Hint style={{ marginTop: 4 }}>
        AI 只會處理「你指定的素材」；授權可隨時中斷，中斷後本系統保存的憑證即刪除。
      </Hint>
      {flash && <Meta as="p" style={{ color: "var(--success-ink)" }}>{flash}</Meta>}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap", marginTop: 6 }}>
        <AdobeConnectionStatus data={data} />
        <AdobeConnectButton
          data={data}
          startUrl={startUrl}
          onDisconnect={() => disconnect.mutate()}
          disconnecting={disconnect.isPending}
        />
      </div>
      {disconnect.error && <p className="error" role="alert">{disconnect.error.message}</p>}
    </Card>
  );
}

function NotionCard({ data, returnTo }: {
  data: { connected: boolean; workspace: string | null; last4: string | null; status: string | null; lastError: string | null; siteTokenAvailable: boolean } | null;
  /** 使用者是從哪個「加入資料」流程來的（?return=）——設定完成後送他回去 */
  returnTo: string | null;
}) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const [token, setToken] = useState("");
  const [editing, setEditing] = useState(false);
  const setNotion = trpc.integrations.setNotion.useMutation({
    onSuccess: () => {
      utils.integrations.list.invalidate();
      setToken("");
      setEditing(false);
      // Notion 是貼 token（沒有 OAuth 重導），所以「回到原本流程」得由前端做。
      // 目的地已過 shared/returnTo 白名單，與 Google callback 同一條規則。
      if (returnTo) navigate(returnTo);
    },
  });
  const removeNotion = trpc.integrations.removeNotion.useMutation({ onSuccess: () => utils.integrations.list.invalidate() });

  return (
    <Card as="section" id="integration-notion" style={{ marginTop: 12 }} data-fb="資料來源-Notion卡">
      <h2><Icon name="FileText" size={18} /> Notion</h2>
      <Hint style={{ marginTop: 4 }}>
        到 <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer">notion.so/my-integrations</a> 建立整合、
        複製 Internal Integration Secret 貼進來，並在 Notion 把要匯入的頁面或資料庫「連結」給該整合（右上 ⋯ → Connections；
        資料庫要在資料庫本身那一頁操作，不是在單一列的頁面）。
        完成後到「資料中心」用「從 Notion 選頁／資料庫」搜尋並多選匯入（也可照舊貼連結）。
        AI 只會讀「你選中並匯入」的內容——連接整合不等於把整個 workspace 交給 AI。
        {data?.siteTokenAvailable && !data.connected ? "（站方已設共用 token，你也可以不設、直接用共用的）" : ""}
      </Hint>
      {!data ? (
        <Meta as="p">載入中…</Meta>
      ) : data.connected && !editing ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {data.status === "error" ? (
            <Meta style={{ margin: 0, color: "var(--danger-ink, #a33)" }} title={data.lastError ?? undefined}>
              token 已失效——請重新設定
            </Meta>
          ) : (
            <Meta style={{ margin: 0 }}>
              <Icon name="Check" size={13} /> 已設定{data.workspace ? `（workspace：${data.workspace}）` : ""}{data.last4 ? `・末四碼 ${data.last4}` : ""}
            </Meta>
          )}
          <Button size="sm" onClick={() => setEditing(true)}>更換 token</Button>
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
          <Button size="sm" variant="primary" disabled={!token.trim() || setNotion.isPending} onClick={() => setNotion.mutate({ token: token.trim() })}>
            {setNotion.isPending ? "驗證中…" : "驗證並儲存"}
          </Button>
          {editing && <Button size="sm" onClick={() => { setEditing(false); setToken(""); }}>取消</Button>}
        </div>
      )}
      {setNotion.error && <p className="error" role="alert">{setNotion.error.message}</p>}
      {removeNotion.error && <p className="error" role="alert">{removeNotion.error.message}</p>}
      <Hint style={{ marginTop: 6 }}><Icon name="Lock" size={12} /> token 送出後即加密存放，不會再顯示——之後只看得到末四碼。</Hint>
    </Card>
  );
}

function ApiConnectionsCard({ apis, onRemove, removingId }: {
  apis: Array<{ id: string; name: string; baseUrl: string; authHeader: string; last4: string | null; status: string; lastError: string | null; lastUsedAt: string | Date | null }>;
  onRemove: (id: string) => void;
  removingId: string | null;
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
    <Card as="section" id="integration-api" style={{ marginTop: 12 }} data-fb="資料來源-外部API卡">
      <h2><Icon name="Package" size={18} /> 外部資料來源／API</h2>
      <Hint style={{ marginTop: 4 }}>
        把 Airtable、Supabase、自建服務或任何回傳 JSON／CSV 的端點接進來。這裡只保存「基底網址＋認證標頭」；
        真正要使用哪些內容，仍到「資料中心」選擇匯入。金鑰加密存放，抓取固定走你登記的主機，且僅允許 https。
      </Hint>

      {apis.length === 0 && !adding && <Hint>還沒有外部資料來源——按下面「新增連接」開始。</Hint>}
      {apis.map((c) => (
        <div key={c.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border-soft, #eee)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>{c.name}</span>
            <span className="meta mono" style={{ wordBreak: "break-all" }}>{c.baseUrl}</span>
            <Badge title={`認證標頭：${c.authHeader}`}>{c.authHeader}{c.last4 ? `・末四碼 ${c.last4}` : ""}</Badge>
            {c.lastError && <span className="meta" style={{ color: "var(--danger-ink, #a33)" }} title={c.lastError}>上次錯誤</span>}
            <span className="spacer" />
            <input
              aria-label={`測試路徑（${c.name}）`}
              placeholder="路徑（選填）如 /rows?limit=5"
              style={{ width: 180 }}
              onChange={(e) => { testPath.current[c.id] = e.target.value; }}
            />
            <Button size="sm" disabled={fetchApi.isPending && fetchApi.variables?.id === c.id} onClick={() => test(c.id)}>
              {fetchApi.isPending && fetchApi.variables?.id === c.id ? "抓取中…" : "測試抓取"}
            </Button>
            <ConfirmButton
              onConfirm={() => onRemove(c.id)}
              message={`刪除連接「${c.name}」？（已加密的金鑰會一併刪除）`}
              triggerClassName="btn-sm"
              disabled={removingId === c.id}
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
          <Hint style={{ margin: 0 }}>標頭值原樣送出——需要 Bearer 前綴就一起貼（如「Bearer pat123」）。</Hint>
          <div style={{ display: "flex", gap: 8 }}>
            <Button size="sm" variant="primary"
              disabled={!name.trim() || !baseUrl.trim() || !secret || addApi.isPending}
              onClick={() => addApi.mutate({ name: name.trim(), baseUrl: baseUrl.trim(), headerName: headerName.trim() || undefined, secret })}>
              {addApi.isPending ? "建立中…" : "建立連接"}
            </Button>
            <Button size="sm" onClick={() => setAdding(false)}>取消</Button>
          </div>
          {addApi.error && <p className="error" role="alert">{addApi.error.message}</p>}
        </div>
      ) : (
        <Button size="sm" style={{ marginTop: 10 }} onClick={() => setAdding(true)}>
          <Icon name="Plus" size={13} /> 新增連接
        </Button>
      )}
    </Card>
  );
}
