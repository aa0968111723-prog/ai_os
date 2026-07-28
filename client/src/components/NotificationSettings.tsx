import { useEffect, useRef, useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { useFocusTrap } from "./interactions";
import {
  copyLinkDeviceGuide,
  deviceKind,
  deviceLabel,
  getExistingSubscription,
  isIOS,
  isPushSupported,
  isStandalone,
  kindFromLabel,
  notificationPermission,
  relSeen,
  subscribeThisDevice,
  unsubscribeThisDevice,
  type DeviceKind,
} from "../push";

function kindIcon(kind: DeviceKind): "Smartphone" | "Tablet" | "Monitor" | "Bell" {
  if (kind === "phone") return "Smartphone";
  if (kind === "tablet") return "Tablet";
  if (kind === "desktop") return "Monitor";
  return "Bell";
}

function kindLabel(kind: DeviceKind): string {
  if (kind === "phone") return "手機";
  if (kind === "tablet") return "平板";
  if (kind === "desktop") return "電腦";
  return "裝置";
}

/**
 * 跨裝置通知設定（UserMenu →「連結手機與電腦」）：
 * - 本裝置：一鍵啟用／停用；iPhone 未加入主畫面時給步驟引導
 * - 已連結裝置：手機／電腦分類圖示、最近同步、可移除
 * - 測試通知：驗證通不通
 * - 複製引導：方便在另一台裝置完成連結
 */
export function NotificationSettingsDialog({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const supported = isPushSupported();
  const thisKind = deviceKind();
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
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; endpoint: string; label: string } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true, onClose);

  useEffect(() => {
    let alive = true;
    if (supported) {
      getExistingSubscription()
        .then((sub) => {
          if (alive) setThisEndpoint(sub?.endpoint ?? null);
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [supported]);

  const enable = async () => {
    if (!publicKey.data) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const sub = await subscribeThisDevice(publicKey.data.publicKey);
      await subscribe.mutateAsync({ endpoint: sub.endpoint, keys: sub.keys, label: deviceLabel() });
      setThisEndpoint(sub.endpoint);
      setNotice("本裝置已連結——審批、私訊、@提及、生成完成都會推到這裡（關頁也收得到）");
      await utils.push.devices.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "啟用失敗，請再試一次");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
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
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (endpoint === thisEndpoint) {
        await unsubscribeThisDevice();
        setThisEndpoint(null);
      }
      await removeDevice.mutateAsync({ id });
      setConfirmRemove(null);
      setNotice("已移除該裝置——它不會再收到通知");
      await utils.push.devices.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "移除失敗，請再試一次");
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await test.mutateAsync();
      setNotice(
        r.attempted === 0
          ? "還沒有已連結的裝置——請先在上方啟用本裝置，再到手機／另一台電腦重複一次"
          : `已發送到 ${r.delivered}/${r.attempted} 台裝置——幾秒內應跳出「測試通知」`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "測試發送失敗");
    } finally {
      setBusy(false);
    }
  };

  const copyGuide = async () => {
    setError(null);
    try {
      await copyLinkDeviceGuide();
      setNotice("已複製「如何在另一台裝置連結」說明——可貼到 LINE 或備忘錄");
    } catch {
      setError("無法複製到剪貼簿——請手動告訴對方：登入後到「連結手機與電腦」啟用");
    }
  };

  const deviceRows = devices.data ?? [];
  const otherDevices = deviceRows.filter((d) => d.endpoint !== thisEndpoint);
  const phones = deviceRows.filter((d) => kindFromLabel(d.label) === "phone" || kindFromLabel(d.label) === "tablet");
  const desktops = deviceRows.filter((d) => kindFromLabel(d.label) === "desktop");
  const linkedBothSides = phones.length > 0 && desktops.length > 0;
  const perm = notificationPermission();

  return (
    <div className="modal-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        className="card modal-card device-link-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="連結手機與電腦"
      >
        <header className="device-link-head">
          <h2>
            <Icon name="Bell" size={18} style={{ verticalAlign: "-3px" }} /> 連結手機與電腦
          </h2>
          <p className="hint">
            把通知送到你的手機和電腦——關掉網頁、關掉瀏覽器也收得到審批、私訊、@提及與生成完成。
          </p>
        </header>

        {/* 狀態總覽 */}
        <div className="device-link-status" role="status">
          <div className={`device-link-pill ${thisEndpoint ? "on" : ""}`}>
            <Icon name={kindIcon(thisKind)} size={14} />
            本{kindLabel(thisKind)}
            {thisEndpoint ? "・已連結" : "・尚未連結"}
          </div>
          <div className={`device-link-pill ${deviceRows.length > 0 ? "on" : ""}`}>
            <Icon name="Smartphone" size={14} />
            共 {deviceRows.length} 台已連結
          </div>
          {linkedBothSides ? (
            <div className="device-link-pill on">
              <Icon name="CheckCircle2" size={14} />
              手機與電腦都已就緒
            </div>
          ) : deviceRows.length > 0 ? (
            <div className="device-link-pill warn">
              <Icon name="TriangleAlert" size={14} />
              {phones.length === 0 ? "還缺手機" : "還缺電腦"}
            </div>
          ) : null}
        </div>

        {/* 兩步教學 */}
        <section className="device-link-steps" aria-label="連結步驟">
          <h3>怎麼連</h3>
          <ol>
            <li>
              <strong>這台{kindLabel(thisKind)}</strong>
              ——下方按「在本裝置啟用通知」，允許瀏覽器權限
            </li>
            <li>
              <strong>另一台裝置</strong>
              ——用同一個帳號登入 → 頭像選單 →「連結手機與電腦」→ 再啟用一次
            </li>
          </ol>
          <button type="button" className="btn-ghost device-link-copy" onClick={() => void copyGuide()} disabled={busy}>
            <Icon name="Copy" size={14} /> 複製給另一台裝置的說明
          </button>
        </section>

        {/* 本裝置 */}
        <section aria-label="本裝置">
          <h3>本裝置（{deviceLabel()}）</h3>
          {!supported ? (
            <div className="device-link-guide" role="status">
              <Icon name="TriangleAlert" size={16} />
              <div>
                {isIOS() && !isStandalone() ? (
                  <>
                    <p className="hint" style={{ margin: 0 }}>
                      iPhone／iPad 必須先<strong>加入主畫面</strong>才能收通知（需 iOS 16.4+）：
                    </p>
                    <ol className="device-link-ios">
                      <li>用 <strong>Safari</strong> 開啟本站</li>
                      <li>點底部分享 → <strong>加入主畫面</strong></li>
                      <li>從主畫面圖示開啟 Aios</li>
                      <li>回到這裡按「在本裝置啟用通知」</li>
                    </ol>
                  </>
                ) : (
                  <p className="hint" style={{ margin: 0 }}>
                    這個瀏覽器不支援推播——請改用較新的 Chrome、Edge、Firefox 或 Safari。
                  </p>
                )}
              </div>
            </div>
          ) : thisEndpoint ? (
            <div className="device-link-actions">
              <span className="chip" style={{ color: "var(--success-ink)" }}>
                <Icon name="CheckCircle2" size={13} style={{ verticalAlign: "-2px" }} /> 已啟用
              </span>
              <button type="button" className="primary" onClick={() => void sendTest()} disabled={busy}>
                {busy ? "處理中…" : "發送測試通知"}
              </button>
              <button type="button" onClick={() => void disable()} disabled={busy}>
                停用本裝置
              </button>
            </div>
          ) : (
            <div className="device-link-actions">
              <button
                type="button"
                className="primary"
                onClick={() => void enable()}
                disabled={busy || !publicKey.data || perm === "denied"}
              >
                {busy ? "連結中…" : "在本裝置啟用通知"}
              </button>
              {publicKey.error && (
                <span className="hint">通知金鑰暫時讀不到——稍後重開此視窗再試</span>
              )}
              {perm === "denied" && (
                <span className="hint" role="status">
                  通知權限被封鎖——請到瀏覽器網站設定把「通知」改為允許
                </span>
              )}
            </div>
          )}
        </section>

        {/* 已連結清單 */}
        <section aria-label="已連結裝置">
          <h3 style={{ marginTop: "var(--sp-16)" }}>已連結裝置</h3>
          {devices.isLoading ? (
            <p className="hint">載入中…</p>
          ) : deviceRows.length === 0 ? (
            <p className="hint">
              還沒有任何裝置——先啟用本裝置，再到手機或另一台電腦用同一帳號重複一次。
            </p>
          ) : (
            <ul className="device-link-list">
              {deviceRows.map((d) => {
                const kind = kindFromLabel(d.label);
                const isThis = d.endpoint === thisEndpoint;
                return (
                  <li key={d.id} className={isThis ? "is-this" : undefined}>
                    <span className="device-link-icon" aria-hidden>
                      <Icon name={kindIcon(kind)} size={18} />
                    </span>
                    <span className="device-link-meta">
                      <span className="device-link-name">
                        {d.label ?? "未知裝置"}
                        {isThis && <span className="chip">本裝置</span>}
                      </span>
                      <span className="meta">最近同步 {relSeen(d.lastSeenAt)}</span>
                    </span>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={busy}
                      title="移除此裝置（不再收到通知）"
                      aria-label={`移除 ${d.label ?? "裝置"}`}
                      onClick={() =>
                        setConfirmRemove({
                          id: d.id,
                          endpoint: d.endpoint,
                          label: d.label ?? "未知裝置",
                        })
                      }
                    >
                      <Icon name="Trash2" size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {otherDevices.length === 0 && thisEndpoint && (
            <p className="hint" style={{ marginTop: 8 }}>
              目前只有這台——再到手機或另一台電腦啟用一次，兩邊就都能收通知。
            </p>
          )}
        </section>

        {confirmRemove && (
          <div className="device-link-confirm" role="alertdialog" aria-label="確認移除裝置">
            <p>
              確定移除 <strong>{confirmRemove.label}</strong>？它不會再收到推播。
            </p>
            <div className="device-link-actions">
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void remove(confirmRemove.id, confirmRemove.endpoint)}
              >
                確定移除
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirmRemove(null)}>
                取消
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="hint" style={{ color: "var(--success-ink)" }} role="status">
            {notice}
          </p>
        )}

        <div style={{ marginTop: "var(--sp-16)" }}>
          <button type="button" onClick={onClose}>
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 例行訂閱同步（App 頂層掛載、零 UI）：已授權且已訂閱的裝置，每次開 App 上報一次——
 * 刷新 lastSeenAt、修復換帳號歸屬，並自癒金鑰輪替。
 */
export function PushSubscriptionSync() {
  const enabled = isPushSupported() && notificationPermission() === "granted";
  const publicKey = trpc.push.publicKey.useQuery(undefined, { staleTime: Infinity, enabled });
  const sync = trpc.push.sync.useMutation();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !publicKey.data) return;
    done.current = true;
    (async () => {
      const existing = await getExistingSubscription();
      if (!existing) return;
      const fresh = await subscribeThisDevice(publicKey.data.publicKey);
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
