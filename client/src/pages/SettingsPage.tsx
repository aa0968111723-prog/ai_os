import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";
import { Button, Card, Hint, Meta, Skeleton } from "../components/ui";
import { Icon } from "../components/Icon";
import { ChangePasswordDialog } from "../app/session/ChangePasswordDialog";
import { NotificationSettingsDialog } from "../components/NotificationSettings";
import { hasDesktopBridge } from "../platform/desktopBridge";
import { canOfferInstall, isIosDevice, isStandaloneApp, promptInstall, subscribeInstallUi } from "../pwa";
import { unsubscribeThisDevice } from "../push";
import posthog from "../posthog";

const AVATAR_MAX_DATA_URL = 190 * 1024; // ~140KB binary payload

/**
 * 前端壓縮頭像：轉成正方形裁切（置中）、縮放至最大 256px、壓成 JPEG（<=150KB）。
 */
async function compressToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("請選擇圖片檔案（JPEG、PNG 或 WebP）");
  }
  const img = new Image();
  const url = URL.createObjectURL(file);
  try {
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("圖片載入失敗，可能檔案已損毀"));
    });
  } finally {
    URL.revokeObjectURL(url);
  }

  const canvas = document.createElement("canvas");
  const size = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
  if (size <= 0) throw new Error("無效的圖片尺寸");

  const sx = ((img.naturalWidth || img.width) - size) / 2;
  const sy = ((img.naturalHeight || img.height) - size) / 2;
  const target = Math.min(256, size);

  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("無法建立畫布處理圖片");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, size, size, 0, 0, target, target);

  let quality = 0.88;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrl.length > AVATAR_MAX_DATA_URL && quality > 0.35) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  if (dataUrl.length > AVATAR_MAX_DATA_URL) {
    throw new Error("圖片壓縮後仍超出限制，請更換一張較小的圖片");
  }
  return dataUrl;
}

function AvatarPreview({
  name,
  avatarUrl,
  bust,
}: {
  name: string;
  avatarUrl: string | null | undefined;
  bust: number;
}) {
  const src = avatarUrl
    ? `${avatarUrl}${avatarUrl.includes("?") ? "&" : "?"}t=${bust}`
    : null;

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="settings-avatar__img"
        width={88}
        height={88}
        style={{
          width: 88,
          height: 88,
          borderRadius: "50%",
          objectFit: "cover",
          border: "1px solid var(--border-soft)",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
          flexShrink: 0,
        }}
      />
    );
  }
  const initial = (name.trim()[0] || "?").toUpperCase();
  return (
    <span
      className="settings-avatar__fallback"
      aria-hidden
      style={{
        width: 88,
        height: 88,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--border-soft)",
        fontSize: 32,
        fontWeight: 600,
        color: "var(--ink-muted)",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
        flexShrink: 0,
      }}
    >
      {initial}
    </span>
  );
}

function InstallAppButton() {
  const [, bump] = useState(0);
  useEffect(() => subscribeInstallUi(() => bump((n) => n + 1)), []);
  if (isStandaloneApp() || !canOfferInstall()) return null;
  return (
    <Button
      type="button"
      variant="tonal"
      size="sm"
      onClick={() => {
        if (isIosDevice()) {
          window.location.assign("/help#help-install");
          return;
        }
        void promptInstall();
      }}
    >
      <Icon name="Download" size={15} />安裝成 App
    </Button>
  );
}

function QuotaDetail({ groupId }: { groupId?: string }) {
  const my = trpc.quota.my.useQuery(
    { groupId: groupId || undefined },
    { enabled: !!groupId, staleTime: 30_000 },
  );
  if (!groupId) return <Hint as="p">選好作用組別後可看個人點數用量</Hint>;
  if (my.isLoading) return <Skeleton style={{ height: 72 }} />;
  if (my.error || !my.data) return <Meta>點數暫時讀不到</Meta>;
  const d = my.data;
  const caps = [d.memberBudgetRemaining, d.groupBudgetRemaining, d.totalRemaining].filter(
    (v): v is number => v != null,
  );
  const tight = caps.length > 0 ? Math.min(...caps) : null;
  return (
    <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <strong>目前剩餘</strong>
        <span className="mono">{tight == null ? "不限" : `${tight.toLocaleString()} 點`}</span>
      </div>
      <Meta as="div">
        今日已用 {d.dailyUsed.toLocaleString()}{d.dailyQuota != null ? `／日額 ${d.dailyQuota.toLocaleString()}` : ""}
        ｜本週已用 {d.weeklyUsed.toLocaleString()}{d.weeklyQuota != null ? `／週額 ${d.weeklyQuota.toLocaleString()}` : ""}
      </Meta>
      {(d.memberBudgetRemaining != null || d.groupBudgetRemaining != null) && (
        <Meta as="div">
          {d.memberBudgetRemaining != null && <div>個人預算剩 {d.memberBudgetRemaining.toLocaleString()} 點</div>}
          {d.groupBudgetRemaining != null && <div>本組預算剩 {d.groupBudgetRemaining.toLocaleString()} 點</div>}
        </Meta>
      )}
      <Hint as="div" style={{ fontSize: 11 }}>單位為站內點數。頂欄鑽石只顯示摘要，明細以這裡為準。</Hint>
    </div>
  );
}

export function SettingsPage() {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const fileRef = useRef<HTMLInputElement>(null);
  const [showChangePw, setShowChangePw] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [avatarBust, setAvatarBust] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const updateProfile = trpc.auth.updateProfile.useMutation({
    onSuccess: () => {
      void utils.auth.me.invalidate();
      setNameDraft(null);
      setLocalError(null);
    },
    onError: (e) => setLocalError(e.message),
  });

  const setAvatar = trpc.auth.setAvatar.useMutation({
    onSuccess: () => {
      void utils.auth.me.invalidate();
      setAvatarBust((n) => n + 1);
      setLocalError(null);
      setAvatarBusy(false);
    },
    onError: (e) => {
      setLocalError(e.message);
      setAvatarBusy(false);
    },
  });

  const clearAvatar = trpc.auth.clearAvatar.useMutation({
    onSuccess: () => {
      void utils.auth.me.invalidate();
      setAvatarBust((n) => n + 1);
      setLocalError(null);
    },
    onError: (e) => setLocalError(e.message),
  });

  const onPickAvatar = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setAvatarBusy(true);
      setLocalError(null);
      try {
        const dataUrl = await compressToAvatarDataUrl(file);
        setAvatar.mutate({ dataUrl });
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : "上傳失敗");
        setAvatarBusy(false);
      }
    },
    [setAvatar],
  );

  const logoutAll = trpc.auth.logoutAll.useMutation({
    onSuccess: () => {
      posthog.reset();
      void utils.sessionBoot.bootstrap.invalidate();
      void utils.auth.me.invalidate();
    },
  });
  const pushUnsubscribe = trpc.push.unsubscribe.useMutation();
  const logoutAllDevices = async () => {
    try {
      const endpoint = await unsubscribeThisDevice();
      if (endpoint) await pushUnsubscribe.mutateAsync({ endpoint });
    } catch { /* 推播清理失敗照樣登出全部 */ }
    logoutAll.mutate();
  };

  useEffect(() => {
    const hash = typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, "");
    if (hash === "password") setShowChangePw(true);
    if (hash === "devices" || hash === "notifications") setShowNotif(true);
    if (hash === "quota" || hash === "security") {
      document.getElementById(`settings-${hash}`)?.scrollIntoView({ block: "start" });
    }
  }, []);

  if (me.isLoading) {
    return (
      <div className="page-shell secondary-page settings-page" style={{ maxWidth: 640, margin: "0 auto", padding: "0 16px 48px" }}>
        <SecondaryPageHeader eyebrow="帳號與偏好" title="個人設定" icon="User" description="管理個人頭像、顯示名稱與介面風格偏好。" />
        <Skeleton style={{ height: 160, marginTop: 24, borderRadius: 12 }} />
      </div>
    );
  }

  if (!me.data) {
    return (
      <div className="page-shell secondary-page settings-page" style={{ maxWidth: 640, margin: "0 auto", padding: "0 16px 48px" }}>
        <SecondaryPageHeader eyebrow="帳號與偏好" title="個人設定" icon="User" description="管理個人頭像、顯示名稱與介面風格偏好。" />
        <Hint as="p">請先登入後再進行個人設定</Hint>
      </div>
    );
  }

  const user = me.data.user;
  const userGroups = me.data.groups ?? [];
  const displayName = nameDraft ?? user.name;
  const nameDirty = nameDraft !== null && nameDraft.trim() !== user.name;

  return (
    <div className="page-shell secondary-page settings-page" style={{ maxWidth: 640, margin: "0 auto", padding: "0 16px 48px" }}>
      <SecondaryPageHeader
        eyebrow="帳號與偏好"
        title="個人設定"
        icon="User"
        description="管理你的頭像、顯示名稱與介面偏好設定；變更將即時套用於站內協作、通訊錄與私訊中。"
      />

      <Card as="section" style={{ marginTop: 24, padding: "20px 24px" }}>
        <h2 style={{ fontSize: "var(--fs-15)", fontWeight: 600, margin: "0 0 16px" }}>個人頭像</h2>
        <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
          <AvatarPreview name={user.name} avatarUrl={user.avatarUrl} bust={avatarBust} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 200 }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/*"
              style={{ display: "none" }}
              aria-label="選擇頭像圖片"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                void onPickAvatar(f);
              }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Button
                type="button"
                variant="tonal"
                size="sm"
                disabled={avatarBusy || setAvatar.isPending}
                onClick={() => fileRef.current?.click()}
              >
                {avatarBusy || setAvatar.isPending ? "處理中…" : "上傳頭像"}
              </Button>
              {user.avatarUrl ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={clearAvatar.isPending}
                  onClick={() => clearAvatar.mutate()}
                >
                  {clearAvatar.isPending ? "移除中…" : "移除頭像"}
                </Button>
              ) : null}
            </div>
            <Meta style={{ fontSize: 11 }}>
              支援 JPG、PNG、WebP，系統會自動置中裁切並壓縮為 256px 正方形（150KB 以內）。
            </Meta>
          </div>
        </div>
      </Card>

      <Card as="section" style={{ marginTop: 20, padding: "20px 24px" }}>
        <h2 style={{ fontSize: "var(--fs-15)", fontWeight: 600, margin: "0 0 16px" }}>顯示名稱</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            value={displayName}
            maxLength={64}
            placeholder="請輸入你的顯示名稱"
            aria-label="顯示名稱"
            onChange={(e) => setNameDraft(e.target.value)}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--border-soft)",
              background: "var(--surface)",
              color: "var(--ink)",
              fontSize: "var(--fs-14)",
            }}
          />
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!nameDirty || updateProfile.isPending || !displayName.trim()}
            onClick={() => updateProfile.mutate({ name: displayName.trim() })}
          >
            {updateProfile.isPending ? "儲存中…" : "儲存"}
          </Button>
        </div>
        <Meta style={{ marginTop: 8, fontSize: 12 }}>
          登入信箱：{user.email}（帳號綁定信箱，如需調整請洽團隊管理員）
        </Meta>
      </Card>

      {localError ? (
        <p role="alert" className="error" style={{ marginTop: 16, fontSize: 13 }}>
          {localError}
        </p>
      ) : null}

      <Card as="section" id="settings-quota" style={{ marginTop: 20, padding: "20px 24px" }}>
        <h2 style={{ fontSize: "var(--fs-15)", fontWeight: 600, margin: "0 0 12px" }}>點數明細</h2>
        <QuotaDetail
          groupId={(() => {
            const stored = typeof localStorage !== "undefined" ? localStorage.getItem("aidos_group") : null;
            if (stored && userGroups.some((g) => g.groupId === stored)) return stored;
            return userGroups[0]?.groupId;
          })()}
        />
      </Card>

      <Card as="section" id="settings-security" style={{ marginTop: 20, padding: "20px 24px" }}>
        <h2 style={{ fontSize: "var(--fs-15)", fontWeight: 600, margin: "0 0 8px" }}>安全與裝置</h2>
        <Hint as="p" style={{ margin: "0 0 16px", fontSize: 12 }}>
          改密碼、通知、裝置連結與匯出都在這裡，不再藏在頭像選單底層。
        </Hint>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Button type="button" variant="tonal" size="sm" onClick={() => setShowChangePw(true)}>
            <Icon name="Lock" size={15} />改密碼
          </Button>
          <Button type="button" variant="tonal" size="sm" onClick={() => setShowNotif(true)}>
            <Icon name="Bell" size={15} />通知設定與裝置連結
          </Button>
          <a href="/api/me/export" download className="menu-item" style={{ display: "flex", gap: 8, alignItems: "center", textDecoration: "none", padding: "8px 12px", borderRadius: 8, minHeight: 44 }} title="下載你的可讀資料備份：帳號、組別、相關專案、生成、留言、筆記、排程；不含密碼與媒體二進位檔">
            <Icon name="Download" size={15} />匯出我的個人資料
          </a>
          <InstallAppButton />
          {hasDesktopBridge() ? (
            <Link href="/desktop" className="menu-item" style={{ display: "flex", gap: 8, alignItems: "center", textDecoration: "none", padding: "8px 12px", borderRadius: 8, minHeight: 44 }}>
              <Icon name="Monitor" size={15} />桌面剪輯連接
            </Link>
          ) : (
            <Link href="/downloads#desktop-app" className="menu-item" style={{ display: "flex", gap: 8, alignItems: "center", textDecoration: "none", padding: "8px 12px", borderRadius: 8, minHeight: 44 }}>
              <Icon name="Download" size={15} />下載電腦版應用程式
            </Link>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={logoutAll.isPending}
            onClick={() => {
              if (window.confirm("要登出全部裝置嗎？其他手機／電腦需重新登入；本裝置會繼續保持登入。")) {
                void logoutAllDevices();
              }
            }}
          >
            <Icon name="Smartphone" size={15} />{logoutAll.isPending ? "處理中…" : "登出全部裝置"}
          </Button>
        </div>
      </Card>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: "var(--fs-14)", fontWeight: 600, marginBottom: 12 }}>相關功能</h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <li>
            <Link href="/my-reports" className="menu-item" style={{ display: "flex", gap: 8, alignItems: "center", textDecoration: "none", padding: "8px 12px", borderRadius: 8, minHeight: 44 }}>
              <Icon name="MessageCircle" size={15} />我的回報
            </Link>
          </li>
          <li>
            <Link href="/databases" className="menu-item" style={{ display: "flex", gap: 8, alignItems: "center", textDecoration: "none", padding: "8px 12px", borderRadius: 8, minHeight: 44 }}>
              <Icon name="Database" size={15} />資料中心
            </Link>
          </li>
          <li>
            <Link href="/integrations" className="menu-item" style={{ display: "flex", gap: 8, alignItems: "center", textDecoration: "none", padding: "8px 12px", borderRadius: 8, minHeight: 44 }}>
              <Icon name="Waypoints" size={15} />連接與服務
            </Link>
          </li>
          <li>
            <Link href="/mcp" className="menu-item" style={{ display: "flex", gap: 8, alignItems: "center", textDecoration: "none", padding: "8px 12px", borderRadius: 8, minHeight: 44 }}>
              <Icon name="Bot" size={15} />接上外部 AI
            </Link>
          </li>
        </ul>
      </section>

      {showChangePw && <ChangePasswordDialog onClose={() => setShowChangePw(false)} />}
      {showNotif && <NotificationSettingsDialog onClose={() => setShowNotif(false)} />}
    </div>
  );
}
