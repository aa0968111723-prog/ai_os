import { useEffect, useRef, useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { useFocusTrap } from "./interactions";
import {
  deviceLabel,
  getExistingSubscription,
  isIOS,
  isPushSupported,
  isStandalone,
  subscribeThisDevice,
  unsubscribeThisDevice,
} from "../push";

/**
 * 通知設定對話框（UserMenu →「通知設定」）：把手機/電腦連結進跨裝置通知。
 * - 本裝置：一鍵啟用（授權＋訂閱＋上報）/停用；iPhone 未加入主畫面時給前置引導。
 * - 已連結裝置：列出所有裝置（含本裝置標記）、可逐一移除（如遺失的手機）。
 * - 測試通知：立刻推一則到所有已連結裝置，現場驗證通不通。
 * 啟用後審批、私訊、@提及、生成與 AI 助手完成都會推到這些裝置——關頁也收得到。
 */
export function NotificationSettingsDialog({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const supported = isPushSupported();
  // 公鑰等打開對話框才查（登入後未必會用推播，不白打）；裝置清單同理
  const publicKey = trpc.push.publicKey.useQuery(undefined, { staleTime: Infinity });
  const devices = trpc.push.devices.useQuery();
  const subscribe = trpc.push.subscribe.useMutation();
  const unsubscribe = trpc.push.unsubscribe.useMutation();
  const removeDevice = trpc.push.removeDevice.useMutation();
  const test = trpc.push.test.useMutation();

  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // 與 ChangePasswordDialog 同一套對話框互動：焦點鎖在框內、鎖背景捲動、Esc 關閉
  useFocusTrap(dialogRef, true, onClose);

  // 打開時偵測本瀏覽器既有訂閱——「本裝置」區塊據此顯示啟用/停用
  useEffect(() => {
    let alive = true;
    if (supported) {
      getExistingSubscription().then((sub) => { if (alive) setThisEndpoint(sub?.endpoint ?? null); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [supported]);

  const enable = async () => {
    if (!publicKey.data) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const sub = await subscribeThisDevice(publicKey.data.publicKey);
      await subscribe.mutateAsync({ endpoint: sub.endpoint, keys: sub.keys, label: deviceLabel() });
      setThisEndpoint(sub.endpoint);
      setNotice("本裝置已連結——之後審批、私訊、@提及、生成完成都會推到這裡（關頁也收得到）");
      await utils.push.devices.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "啟用失敗，請再試一次");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const endpoint = await unsubscribeThisDevice();
      if (endpoint) await unsubscribe.mutateAsync({ endpoint });
      setThisEndpoint(null);
      setNotice("本裝置已停用通知");
      await utils.push.devices.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "停用失敗，請再試一次");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, endpoint: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      // 移除的是本裝置時，瀏覽器端一併退訂——否則下次事件仍會推到（endpoint 還活著）
      if (endpoint === thisEndpoint) {
        await unsubscribeThisDevice();
        setThisEndpoint(null);
      }
      await removeDevice.mutateAsync({ id });
      await utils.push.devices.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "移除失敗，請再試一次");
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await test.mutateAsync();
      setNotice(r.attempted === 0
        ? "沒有已連結的裝置——先在上方啟用本裝置"
        : `已發送到 ${r.delivered}/${r.attempted} 個裝置——幾秒內會跳出「測試通知」`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "測試發送失敗");
    } finally {
      setBusy(false);
    }
  };

  const deviceRows = devices.data ?? [];
  const fmtTime = (d: Date) => d.toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "var(--scrim)", display: "grid", placeItems: "center", zIndex: 50 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={dialogRef} className="card" style={{ width: 460, maxWidth: "92vw", maxHeight: "86vh", overflowY: "auto" }} role="dialog" aria-modal="true" aria-label="通知設定">
        <h2 style={{ marginTop: 0 }}><Icon name="Bell" size={18} style={{ verticalAlign: "-3px" }} /> 通知設定</h2>
        <p className="hint">
          把手機和電腦連結進來後，分鏡審批、私訊、@提及、生成與 AI 執行計畫完成都會直接推到裝置上——
          關掉網頁、關掉瀏覽器也收得到。
        </p>

        <h3 style={{ marginBottom: "var(--sp-8)" }}>本裝置</h3>
        {!supported ? (
          <p className="hint" role="status">
            <Icon name="TriangleAlert" size={14} style={{ verticalAlign: "-2px" }} />{" "}
            {isIOS() && !isStandalone()
              ? "iPhone/iPad：請先用 Safari 開啟本站 →「分享」→「加入主畫面」，再從主畫面圖示開啟後回到這裡啟用（需 iOS 16.4 以上）"
              : "這個瀏覽器不支援推播通知——請改用較新的 Chrome/Edge/Firefox/Safari"}
          </p>
        ) : thisEndpoint ? (
          <div style={{ display: "flex", gap: "var(--sp-8)", alignItems: "center", flexWrap: "wrap" }}>
            <span className="chip" style={{ color: "var(--success-ink)" }}>
              <Icon name="CheckCircle2" size={13} style={{ verticalAlign: "-2px" }} /> 已啟用（{deviceLabel()}）
            </span>
            <button onClick={disable} disabled={busy}>停用本裝置</button>
            <button onClick={sendTest} disabled={busy}>發送測試通知</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: "var(--sp-8)", alignItems: "center", flexWrap: "wrap" }}>
            <button className="primary" onClick={enable} disabled={busy || !publicKey.data}>
              {busy ? "連結中…" : "在本裝置啟用通知"}
            </button>
            {publicKey.error && (
              <span className="hint">通知金鑰暫時讀不到（{publicKey.error.message}）——稍後重開這個視窗再試</span>
            )}
            {Notification.permission === "denied" && (
              <span className="hint">通知權限目前被封鎖——請先到瀏覽器網站設定把「通知」改為允許</span>
            )}
          </div>
        )}

        <h3 style={{ marginTop: "var(--sp-16)", marginBottom: "var(--sp-8)" }}>已連結裝置</h3>
        {devices.isLoading ? (
          <p className="hint">載入中…</p>
        ) : deviceRows.length === 0 ? (
          <p className="hint">還沒有任何裝置——在手機和電腦各開一次本頁、按「啟用」，兩邊就都收得到通知</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--sp-8)" }}>
            {deviceRows.map((d) => (
              <li key={d.id} style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)" }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {d.label ?? "未知裝置"}
                  {d.endpoint === thisEndpoint && <span className="chip" style={{ marginLeft: 6 }}>本裝置</span>}
                  <span className="meta" style={{ display: "block" }}>最近同步 {fmtTime(d.lastSeenAt)}</span>
                </span>
                <button onClick={() => remove(d.id, d.endpoint)} disabled={busy} title="移除這個裝置（它將不再收到通知）">
                  <Icon name="Trash2" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="hint" style={{ color: "var(--success-ink)" }} role="status">{notice}</p>}

        <div style={{ marginTop: "var(--sp-16)" }}>
          <button onClick={onClose}>關閉</button>
        </div>
      </div>
    </div>
  );
}

/**
 * 例行訂閱同步（App 頂層掛載、零 UI）：已授權且已訂閱的裝置，每次開 App 上報一次——
 * 刷新 lastSeenAt（設定頁「最近同步」＋超額淘汰依據）、修復換帳號歸屬，並自癒金鑰輪替：
 * 先比對本機訂閱綁的伺服器公鑰，不一致就就地換訂新金鑰（subscribeThisDevice 內建此邏輯），
 * 再帶 oldEndpoint 讓伺服器把舊列改寫成新訂閱。走 push.sync（只更新不新增）——
 * 在設定頁移除過的裝置不會被開 App 偷偷復活，重新連結必須回設定頁明確按「啟用」。
 */
export function PushSubscriptionSync() {
  // 公鑰查詢也只在「已授權」的裝置發（enabled）——沒用推播的人不多打一條 query
  const enabled = isPushSupported() && Notification.permission === "granted";
  const publicKey = trpc.push.publicKey.useQuery(undefined, { staleTime: Infinity, enabled });
  const sync = trpc.push.sync.useMutation();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !publicKey.data) return;
    done.current = true;
    (async () => {
      const existing = await getExistingSubscription();
      if (!existing) return; // 這台裝置沒啟用過（或已停用）——不替使用者自作主張訂閱
      const fresh = await subscribeThisDevice(publicKey.data.publicKey); // 金鑰相同＝原樣返回；不同＝換訂
      sync.mutate({
        endpoint: fresh.endpoint,
        keys: fresh.keys,
        label: deviceLabel(),
        oldEndpoint: fresh.endpoint !== existing.endpoint ? existing.endpoint : undefined,
      });
    })().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey.data]);
  return null;
}
