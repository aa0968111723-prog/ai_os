/**
 * 個人設定頁：頭像、顯示名稱、介面密度，以及帳號／連接相關快捷入口。
 * 不重做既有改密碼／通知對話框——從這裡開起既有流程或導到對應頁。
 */
import { useCallback, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";
import { Button, Hint, Meta, Skeleton } from "../components/ui";
import { useDensity } from "../components/ui";
import { writeUiDensity } from "../lib/densityPreference";
import { UI_DENSITY_DESCRIPTION, UI_DENSITY_LABEL, type UiDensity } from "@shared/uiDensity";

const AVATAR_MAX_EDGE = 256;
const AVATAR_JPEG_QUALITY = 0.88;
const AVATAR_MAX_DATA_URL = 150 * 1024;

async function compressToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("請選擇圖片檔");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, AVATAR_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("無法處理圖片");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  let quality = AVATAR_JPEG_QUALITY;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrl.length > AVATAR_MAX_DATA_URL && quality > 0.5) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  if (dataUrl.length > AVATAR_MAX_DATA_URL) {
    throw new Error("圖片壓縮後仍太大，請換一張較小的圖");
  }
  return dataUrl;
}

function AvatarPreview({ name, avatarUrl, bust }: { name: string; avatarUrl: string | null | undefined; bust: number }) {
  const src = avatarUrl ? `${avatarUrl}${avatarUrl.includes("?") ? "&" : "?"}t=${bust}` : null;
  if (src) {
    return (
      <img src={src} alt="" className="settings-avatar__img" width={88} height={88}
        style={{ width: 88, height: 88, borderRadius: "50%", objectFit: "cover", border: "1px solid var(--border-soft)" }} />
    );
  }
  const initial = (name.trim()[0] || "?").toUpperCase();
  return (
    <span className="settings-avatar__fallback" aria-hidden
      style={{ width: 88, height: 88, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: "var(--border-soft)", fontSize: 32, fontWeight: 600, color: "var(--ink-muted)" }}>
      {initial}
    </span>
  );
}

export function SettingsPage() {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const density = useDensity();
  const fileRef = useRef<HTMLInputElement>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [avatarBust, setAvatarBust] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const updateProfile = trpc.auth.updateProfile.useMutation({
    onSuccess: () => { void utils.auth.me.invalidate(); setNameDraft(null); setLocalError(null); },
    onError: (e) => setLocalError(e.message),
  });

  const setAvatar = trpc.auth.setAvatar.useMutation({
    onSuccess: () => { void utils.auth.me.invalidate(); setAvatarBust((n) => n + 1); setLocalError(null); setAvatarBusy(false); },
    onError: (e) => { setLocalError(e.message); setAvatarBusy(false); },
  });

  const clearAvatar = trpc.auth.clearAvatar.useMutation({
    onSuccess: () => { void utils.auth.me.invalidate(); setAvatarBust((n) => n + 1); setLocalError(null); },
    onError: (e) => setLocalError(e.message),
  });

  const setDensity = trpc.auth.setUiDensity.useMutation({
    onSuccess: (_d, vars) => { writeUiDensity(vars.density); void utils.auth.me.invalidate(); },
  });

  const onPickAvatar = useCallback(async (file: File | undefined) => {
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
  }, [setAvatar]);

  if (me.isLoading) {
    return (
      <div className="page settings-page">
        <SecondaryPageHeader title="個人設定" />
        <Skeleton style={{ height: 120, margin: 16 }} />
      </div>
    );
  }

  if (!me.data) {
    return (
      <div className="page settings-page">
        <SecondaryPageHeader title="個人設定" />
        <Hint as="p">請先登入</Hint>
      </div>
    );
  }

  const user = me.data;
  const displayName = nameDraft ?? user.name;
  const nameDirty = nameDraft !== null && nameDraft.trim() !== user.name;

  return (
    <div className="page settings-page" style={{ maxWidth: 560, margin: "0 auto", padding: "0 16px 48px" }}>
      <SecondaryPageHeader title="個人設定" />

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>頭像</h2>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <AvatarPreview name={user.name} avatarUrl={user.avatarUrl} bust={avatarBust} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/*" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void onPickAvatar(f); }} />
            <Button type="button" variant="secondary" size="sm" disabled={avatarBusy || setAvatar.isPending}
              onClick={() => fileRef.current?.click()}>
              {avatarBusy || setAvatar.isPending ? "上傳中…" : "上傳頭像"}
            </Button>
            {user.avatarUrl ? (
              <Button type="button" variant="ghost" size="sm" disabled={clearAvatar.isPending}
                onClick={() => clearAvatar.mutate()}>移除頭像</Button>
            ) : null}
            <Meta style={{ fontSize: 11 }}>自動壓成 256px JPEG，約 150KB 以內</Meta>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>顯示名稱</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="text" value={displayName} maxLength={64} onChange={(e) => setNameDraft(e.target.value)}
            style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border-soft)", background: "var(--surface)", color: "var(--ink)" }} />
          <Button type="button" size="sm" disabled={!nameDirty || updateProfile.isPending || !displayName.trim()}
            onClick={() => updateProfile.mutate({ name: displayName.trim() })}>
            {updateProfile.isPending ? "儲存中…" : "儲存"}
          </Button>
        </div>
        <Meta style={{ marginTop: 6, fontSize: 11 }}>信箱 {user.email}</Meta>
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>介面密度</h2>
        <div style={{ display: "flex", gap: 8 }}>
          {(["guide", "concise"] as UiDensity[]).map((d) => (
            <Button key={d} type="button" variant={density === d ? "primary" : "secondary"} size="sm"
              disabled={setDensity.isPending} onClick={() => setDensity.mutate({ density: d })} title={UI_DENSITY_DESCRIPTION[d]}>
              {UI_DENSITY_LABEL[d]}
            </Button>
          ))}
        </div>
        <Hint as="p" layer="always" style={{ marginTop: 8, fontSize: 12 }}>{UI_DENSITY_DESCRIPTION[density]}</Hint>
      </section>

      {localError ? (
        <p role="alert" style={{ color: "var(--danger)", marginTop: 16, fontSize: 13 }}>{localError}</p>
      ) : null}

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>相關設定</h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <li>
            <Link href="/integrations" className="menu-item" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Icon name="Link" size={15} />整合與個人 AI 金鑰
            </Link>
          </li>
          <li>
            <Link href="/mcp" className="menu-item" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Icon name="Key" size={15} />MCP 連線金鑰
            </Link>
          </li>
          <li>
            <a href="/api/me/export" download className="menu-item" style={{ display: "flex", gap: 8, alignItems: "center" }} title="下載你的可讀資料備份">
              <Icon name="Download" size={15} />匯出我的個人資料
            </a>
          </li>
        </ul>
        <Hint as="div" layer="always" style={{ marginTop: 8, fontSize: 11 }}>
          改密碼、連結手機與電腦、登出裝置——請從右上角帳號選單操作
        </Hint>
      </section>
    </div>
  );
}
