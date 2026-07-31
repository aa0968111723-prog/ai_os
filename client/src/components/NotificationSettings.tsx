import { useEffect, useRef, useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { useFocusTrap } from "./interactions";
import { Button, Card, Chip, Hint, Meta } from "./ui";
import { deviceDetailLines } from "@shared/deviceDetails";
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
function summarizeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "未知瀏覽器／裝置";
  const s = ua.slice(0, 120);
  if (/Edg\//i.test(s)) return "Microsoft Edge";
  if (/Chrome\//i.test(s) && !/Edg\//i.test(s)) return "Chrome";
  if (/Firefox\//i.test(s)) return "Firefox";
  if (/Safari\//i.test(s) && !/Chrome\//i.test(s)) return "Safari";
  if (/iPhone|iPad/i.test(s)) return "iOS 裝置";
  if (/Android/i.test(s)) return "Android 裝置";
  return s.length > 48 ? `${s.slice(0, 48)}…` : s;
}

export function NotificationSettingsDialog({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const supported = isPushSupported();
  const thisKind = deviceKind();
  const publicKey = trpc.push.publicKey.useQuery(undefined, { staleTime: Infinity });
  const devices = trpc.push.devices.useQuery();
  const sessions = trpc.auth.listSessions.useQuery();
  const subscribe = trpc.push.subscribe.useMutation();
  const unsubscribe = trpc.push.unsubscribe.useMutation();
  const removeDevice = trpc.push.removeDevice.useMutation();
  const test = trpc.push.test.useMutation();
  const revokeSession = trpc.auth.revokeSession.useMutation({
    onSuccess: async (r) => {
      if (r.self) {
        await utils.auth.me.invalidate();
        return;
      }
      await utils.auth.listSessions.invalidate();
    },
  });
  const logoutAll = trpc.auth.logoutAll.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      await utils.auth.listSessions.invalidate();
    },
  });
  // 信任裝置（免驗證碼直接登入的機器）——與上面 push.devices（推播訂閱）、
  // listSessions（現在還開著的登入）是三件不同的事，命名刻意分開避免混淆。
  const trustedDevices = trpc.auth.listDevices.useQuery();
  const revokeDevice = trpc.auth.revokeDevice.useMutation({
    onSuccess: async (r) => {
      // 移除本裝置＝連 session 一起被刪，要回登入頁而不是刷新清單
      if (r.self) {
        await utils.auth.me.invalidate();
        return;
      }
      await Promise.all([utils.auth.listDevices.invalidate(), utils.auth.listSessions.invalidate()]);
    },
  });

  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; endpoint: string; label: string } | null>(null);
  const [confirmRevokeSession, setConfirmRevokeSession] = useState<{ id: string; label: string; isCurrent: boolean } | null>(null);
  const [confirmRevokeDevice, setConfirmRevokeDevice] = useState<{ id: string; label: string; isCurrent: boolean } | null>(null);
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
      <Card className="modal-card device-link-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="連結手機與電腦">
        <header className="device-link-head">
          <h2>
            <Icon name="Bell" size={18} style={{ verticalAlign: "-3px" }} /> 連結手機與電腦
          </h2>
          <Hint>
            把通知送到你的手機和電腦——關掉網頁、關掉瀏覽器也收得到審批、私訊、@提及與生成完成。
          </Hint>
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
          <Button variant="ghost" className="device-link-copy" type="button" onClick={() => void copyGuide()} disabled={busy}>
            <Icon name="Copy" size={14} /> 複製給另一台裝置的說明
          </Button>
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
                    <Hint layer="always" style={{ margin: 0 }}>
                      iPhone／iPad 必須先<strong>加入主畫面</strong>才能收通知（需 iOS 16.4+）：
                    </Hint>
                    <ol className="device-link-ios">
                      <li>用 <strong>Safari</strong> 開啟本站</li>
                      <li>點底部分享 → <strong>加入主畫面</strong></li>
                      <li>從主畫面圖示開啟 Aios</li>
                      <li>回到這裡按「在本裝置啟用通知」</li>
                    </ol>
                  </>
                ) : (
                  <Hint layer="always" style={{ margin: 0 }}>
                    這個瀏覽器不支援推播——請改用較新的 Chrome、Edge、Firefox 或 Safari。
                  </Hint>
                )}
              </div>
            </div>
          ) : thisEndpoint ? (
            <div className="device-link-actions">
              <Chip style={{ color: "var(--success-ink)" }}>
                <Icon name="CheckCircle2" size={13} style={{ verticalAlign: "-2px" }} /> 已啟用
              </Chip>
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
                <Meta>通知金鑰暫時讀不到——稍後重開此視窗再試</Meta>
              )}
              {perm === "denied" && (
                <Hint as="span" layer="always" role="status">
                  通知權限被封鎖——請到瀏覽器網站設定把「通知」改為允許
                </Hint>
              )}
            </div>
          )}
        </section>

        {/* 已連結清單 */}
        <section aria-label="已連結裝置">
          <h3 style={{ marginTop: "var(--sp-16)" }}>已連結裝置</h3>
          {devices.isLoading ? (
            <Meta as="p">載入中…</Meta>
          ) : deviceRows.length === 0 ? (
            <Hint layer="always">
              還沒有任何裝置——先啟用本裝置，再到手機或另一台電腦用同一帳號重複一次。
            </Hint>
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
                        {isThis && <Chip>本裝置</Chip>}
                      </span>
                      <span className="meta">最近同步 {relSeen(d.lastSeenAt)}</span>
                    </span>
                    <Button variant="ghost"
                      type="button"
                      disabled={busy}
                      title="移除此裝置（不再收到通知）"
                      aria-label={`移除 ${d.label ?? "裝置"}`}
                      onClick={() =>
                        setConfirmRemove({
                          id: d.id,
                          endpoint: d.endpoint,
                          label: d.label ?? "未知裝置",
                        })
                      }>
                      <Icon name="Trash2" size={14} />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {otherDevices.length === 0 && thisEndpoint && (
            <Hint style={{ marginTop: 8 }}>
              目前只有這台——再到手機或另一台電腦啟用一次，兩邊就都能收通知。
            </Hint>
          )}
        </section>

        {/* AUTH-02：登入工作階段（與推播裝置分開——推播是訂閱，這是 cookie session） */}
        <section aria-label="登入裝置">
          <h3 style={{ marginTop: "var(--sp-16)" }}>登入裝置</h3>
          <Hint style={{ marginTop: 0 }}>
            這裡列出目前有效的登入工作階段。遺失的手機／共用電腦可單筆撤銷，或一次登出全部。
          </Hint>
          {sessions.isLoading ? (
            <Meta as="p">載入中…</Meta>
          ) : (sessions.data ?? []).length === 0 ? (
            <Meta as="p">目前沒有有效工作階段。</Meta>
          ) : (
            <ul className="device-link-list">
              {(sessions.data ?? []).map((s) => {
                const label = summarizeUserAgent(s.userAgent);
                const seen = s.lastSeenAt ?? s.createdAt;
                return (
                  <li key={s.id} className={s.isCurrent ? "is-this" : undefined}>
                    <span className="device-link-icon" aria-hidden>
                      <Icon name={s.isCurrent ? kindIcon(thisKind) : "Monitor"} size={18} />
                    </span>
                    <span className="device-link-meta">
                      <span className="device-link-name">
                        {label}
                        {s.isCurrent && <Chip>本裝置</Chip>}
                      </span>
                      <span className="meta">最近活動 {relSeen(seen)}</span>
                    </span>
                    <Button variant="ghost"
                      type="button"
                      disabled={busy || revokeSession.isPending || logoutAll.isPending}
                      title={s.isCurrent ? "撤銷本裝置（會登出）" : "撤銷此登入"}
                      aria-label={s.isCurrent ? "撤銷本裝置登入" : `撤銷 ${label}`}
                      onClick={() =>
                        setConfirmRevokeSession({
                          id: s.id,
                          label,
                          isCurrent: s.isCurrent,
                        })
                      }>
                      <Icon name="Trash2" size={14} />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="device-link-actions" style={{ marginTop: 8 }}>
            <Button
              variant="ghost"
              type="button"
              disabled={busy || logoutAll.isPending || (sessions.data ?? []).length === 0}
              onClick={() => {
                if (
                  window.confirm(
                    "要登出全部裝置嗎？其他手機／電腦需重新登入；本裝置會立刻換發新工作階段繼續使用。",
                  )
                ) {
                  setBusy(true);
                  setError(null);
                  logoutAll.mutate(undefined, {
                    onSuccess: () => {
                      setNotice("已登出全部其他裝置——本裝置繼續保持登入");
                      setBusy(false);
                    },
                    onError: (err) => {
                      setError(err.message || "登出全部失敗");
                      setBusy(false);
                    },
                  });
                }
              }}
            >
              <Icon name="Smartphone" size={14} />
              {logoutAll.isPending ? "處理中…" : "登出全部裝置"}
            </Button>
          </div>
        </section>

        {/*
          信任裝置（與上方「登入裝置」不同層次，容易混淆故標題與說明都寫清楚）：
          上面那個是「現在還開著的登入」，這裡是「免信箱驗證即可直接登入的機器」。
          信任是永久制、沒有到期日，所以這個移除鈕是唯一的解除途徑——mode=off 時整區隱藏，
          免得功能還沒啟用就先讓人看到一個看不懂又按不出效果的區塊。
        */}
        {trustedDevices.data && trustedDevices.data.mode !== "off" && (
          <section aria-label="信任裝置">
            <h3 style={{ marginTop: "var(--sp-16)" }}>信任裝置</h3>
            <Hint style={{ marginTop: 0 }}>
              這些手機／電腦已通過信箱驗證，登入時不用再收驗證碼。
              換手機或電腦不用了就移除它——移除後那台要重新收信驗證，而且會立刻被登出。
            </Hint>
            {trustedDevices.isLoading ? (
              <Meta as="p">載入中…</Meta>
            ) : trustedDevices.data.devices.length === 0 ? (
              <Meta as="p">還沒有信任裝置。</Meta>
            ) : (
              <ul className="device-link-list">
                {trustedDevices.data.devices.map((d) => (
                  <li key={d.id} className={d.isCurrent ? "is-this" : undefined}>
                    <span className="device-link-icon" aria-hidden>
                      <Icon name={d.isCurrent ? kindIcon(thisKind) : "Monitor"} size={18} />
                    </span>
                    <span className="device-link-meta">
                      <span className="device-link-name">
                        {d.label}
                        {d.isCurrent && <Chip>本裝置</Chip>}
                      </span>
                      <span className="meta">
                        最近登入 {relSeen(d.lastSeenAt ?? d.trustedAt)}
                      </span>
                      {/* 細節攤開顯示：辦公室裡每台「Windows · Chrome」看起來都一樣，
                          要靠處理器／記憶體／顯示卡／螢幕才分得出是哪一台 */}
                      {deviceDetailLines(d.details).length > 0 && (
                        <span className="meta" style={{ display: "block", marginTop: 2, lineHeight: 1.6 }}>
                          {deviceDetailLines(d.details).join("｜")}
                        </span>
                      )}
                    </span>
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={busy || revokeDevice.isPending}
                      title={d.isCurrent ? "移除本裝置的信任（會登出）" : "移除此信任裝置"}
                      aria-label={d.isCurrent ? "移除本裝置信任" : `移除信任裝置 ${d.label}`}
                      onClick={() => setConfirmRevokeDevice({ id: d.id, label: d.label, isCurrent: d.isCurrent })}
                    >
                      <Icon name="Trash2" size={14} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {confirmRevokeDevice && (
          <div className="device-link-confirm" role="alertdialog" aria-label="確認移除信任裝置">
            <p>
              {confirmRevokeDevice.isCurrent ? (
                "確定移除本裝置的信任？你會立刻被登出，下次登入要重新收信箱驗證碼。"
              ) : (
                <>
                  確定移除 <strong>{confirmRevokeDevice.label}</strong> 的信任？
                  該裝置會立刻被登出，下次登入要重新收信箱驗證碼。
                </>
              )}
            </p>
            <div className="device-link-actions">
              <button
                type="button"
                className="primary"
                disabled={busy || revokeDevice.isPending}
                onClick={() => {
                  const target = confirmRevokeDevice;
                  setConfirmRevokeDevice(null);
                  setError(null);
                  revokeDevice.mutate(
                    { id: target.id },
                    {
                      onSuccess: (r) => setNotice(r.self ? "已移除本裝置的信任並登出" : "已移除該信任裝置"),
                      onError: (err) => setError(err.message || "移除信任裝置失敗"),
                    },
                  );
                }}
              >
                確定移除
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirmRevokeDevice(null)}>
                取消
              </button>
            </div>
          </div>
        )}

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

        {confirmRevokeSession && (
          <div className="device-link-confirm" role="alertdialog" aria-label="確認撤銷登入">
            <p>
              {confirmRevokeSession.isCurrent
                ? "確定撤銷本裝置登入？你會立刻被登出。"
                : <>確定撤銷 <strong>{confirmRevokeSession.label}</strong> 的登入？該裝置需重新登入。</>}
            </p>
            <div className="device-link-actions">
              <button
                type="button"
                className="primary"
                disabled={busy || revokeSession.isPending}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  revokeSession.mutate(
                    { id: confirmRevokeSession.id },
                    {
                      onSuccess: (r) => {
                        setConfirmRevokeSession(null);
                        setNotice(r.self ? "已登出本裝置" : "已撤銷該登入裝置");
                        setBusy(false);
                      },
                      onError: (err) => {
                        setError(err.message || "撤銷失敗");
                        setBusy(false);
                      },
                    },
                  );
                }}
              >
                確定撤銷
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirmRevokeSession(null)}>
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
          <Meta as="p" style={{ color: "var(--success-ink)" }} role="status">
            {notice}
          </Meta>
        )}

        <div style={{ marginTop: "var(--sp-16)" }}>
          <button type="button" onClick={onClose}>
            關閉
          </button>
        </div>
      </Card>
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
