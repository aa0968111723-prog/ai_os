import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Icon } from "../components/Icon";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";
import { Button, Card, Hint, Meta, Skeleton } from "../components/ui";
import { hasDesktopBridge } from "../platform/desktopBridge";
import { DESKTOP_INSTALL_HINT, DESKTOP_RELEASES_URL } from "../platform/desktopInstall";
/**
 * 資料下載區（需求 #11）：開發筆記／模型資料／UIUX 設計／隱私與法律，集中一頁下載。
 * 另含「電腦版應用程式」安裝包入口（GitHub Releases）。
 * 清單來自 /api/downloads 的白名單（伺服器逐檔確認存在才列出）；
 * 內容尚未備齊的分類（設計稿、法律文件）以「待補」空狀態呈現，先把位置立起來。
 */

interface DlCategory {
  id: string;
  label: string;
  hint: string;
}
interface DlItem {
  file: string;
  title: string;
  category: string;
  sizeBytes: number;
  updatedAt: string;
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function DownloadsPage() {
  const [data, setData] = useState<{ categories: DlCategory[]; items: DlItem[] } | null>(null);
  const [errMsg, setErrMsg] = useState("");
  // 抓取抽成可重呼叫的 load()：清單頁在 tRPC/React Query 之外，失敗後沒有自動重抓，
  // 一定要給「再試一次」出口——非技術者不會想到要整頁重新整理
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      setErrMsg("");
      try {
        const res = await fetch("/api/downloads", { credentials: "include" });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !Array.isArray(j.items)) throw new Error(j.error ?? `HTTP ${res.status}`);
        if (alive) setData({ categories: j.categories ?? [], items: j.items });
      } catch (err) {
        // 手機弱網最常見的是 fetch 直接 throw（TypeError: Failed to fetch）——一律包成人話，
        // 原始技術訊息收進括號供回報用
        const detail = err instanceof Error && !/fetch/i.test(err.message) ? `（${err.message}）` : "";
        if (alive) setErrMsg(`清單暫時讀不到，請檢查網路後再試${detail}`);
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  return (
    <div className="page-shell secondary-page downloads-page">
      <SecondaryPageHeader
        eyebrow="團隊文件"
        title="共用下載"
        icon="Download"
        badge={data ? `${data.items.length} 份可下載文件` : "自動保持最新版"}
        description={<>開發筆記、模型資料、設計與法律文件集中在這裡；想匯出個人資料，請使用帳號選單的專用功能。</>}
      />

      {/* 電腦版安裝包：使用者要「當應用程式用」的入口——不跟文件白名單混在一起 */}
      <Card as="section" id="desktop-app" className="download-desktop-card" data-fb="下載電腦版" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <Icon name="Monitor" size={28} style={{ color: "var(--primary-ink)", flex: "none" }} />
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: "var(--fs-18)" }}>電腦版應用程式</h2>
            <Hint layer="always" style={{ marginTop: 6 }}>
              {hasDesktopBridge()
                ? "你已經在 Aios 電腦版裡——不需再下載。素材庫可用「用外部軟體開啟」。"
                : DESKTOP_INSTALL_HINT}
            </Hint>
            {!hasDesktopBridge() && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14, alignItems: "center" }}>
                <Button
                  as="a"
                  variant="primary"
                  href={DESKTOP_RELEASES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="Download" size={15} /> 下載 Windows／Mac 安裝包
                </Button>
                <Meta style={{ fontSize: 12 }}>
                  開 GitHub Releases → 選最新一版 → 下載 .exe（Windows）或 .dmg（Mac）
                </Meta>
              </div>
            )}
            {!hasDesktopBridge() && (
              <Hint style={{ marginTop: 10, fontSize: 12 }}>
                安裝後從開始選單／應用程式資料夾開啟「Aios」，登入與網站相同帳號即可。
              </Hint>
            )}
          </div>
        </div>
      </Card>

      {errMsg && (
        <p className="error" role="alert">
          {errMsg}——
          <Button variant="ghost" size="sm" style={{ marginLeft: "var(--sp-4)" }} onClick={() => setReloadKey((k) => k + 1)}>再試一次</Button>
        </p>
      )}
      {!data && !errMsg && (
        <div role="status" aria-label="清單載入中">
          <Skeleton style={{ height: 90, marginTop: 12 }} />
          <Skeleton style={{ height: 90, marginTop: 12 }} />
        </div>
      )}

      <div className="download-category-grid">
        {data?.categories.map((cat) => {
          const items = data.items.filter((it) => it.category === cat.id);
          return (
            <Card as="section" className="download-category-card" key={cat.id} data-fb={`下載區・${cat.label}`}>
              <h2 style={{ marginTop: 0 }}>{cat.label}</h2>
              <Hint style={{ marginTop: 4 }}>{cat.hint}</Hint>
              {items.length === 0 ? (
                <Hint layer="always" style={{ margin: "10px 0 2px" }}>（待補——文件備齊後會出現在這裡）</Hint>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
                  {items.map((it) => (
                    <li
                      key={it.file}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}
                    >
                      <Icon name="FileText" size={15} style={{ flex: "none" }} />
                      <span style={{ flex: "1 1 auto", minWidth: 160 }}>{it.title}</span>
                      <Meta className="mono" style={{ flex: "none" }}>
                        {fmtSize(it.sizeBytes)}・{new Date(it.updatedAt).toLocaleDateString("zh-TW")}
                      </Meta>
                      <a href={`/api/downloads/file?name=${encodeURIComponent(it.file)}`} download>
                        <Icon name="Download" size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />下載
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      <p style={{ marginTop: 24 }}>
        <Link href="/dashboard">回今日工作台</Link>
        <Meta style={{ margin: "0 10px" }}>·</Meta>
        <Link href="/models">看模型指南</Link>
      </p>
    </div>
  );
}
