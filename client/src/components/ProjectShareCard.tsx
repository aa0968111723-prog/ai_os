/**
 * 分享連結卡（交付區）：產生一條唯讀連結，讓還沒有帳號的夥伴也能看這個專案。
 *
 * 三件事在 UI 上必須講清楚，因為它們是這個功能的全部風險：
 * 1. 連結＝憑證。拿到的人不必登入就看得到，所以「傳給誰」等於「開放給誰」。
 * 2. 原文只出現一次。建立當下沒複製走，就只能撤銷後重開一條（後端只存雜湊）。
 * 3. 撤銷是即時的，但已載入的圖片最多還能開一小時（簽名網址效期）。
 */
import { useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { Button, Card, Chip, Hint, Meta } from "./ui";

/** 有效期選項：預設 30 天——「永久」要是自己選的，不能是預設值 */
const EXPIRY_CHOICES: { label: string; days?: number }[] = [
  { label: "7 天", days: 7 },
  { label: "30 天", days: 30 },
  { label: "90 天", days: 90 },
  { label: "不設期限" },
];

function fullUrl(path: string): string {
  return typeof window === "undefined" ? path : new URL(path, window.location.origin).toString();
}

function formatDate(value: Date | string | null): string {
  return value ? new Date(value).toLocaleDateString("zh-TW") : "";
}

export function ProjectShareCard({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const links = trpc.share.list.useQuery({ projectId });
  const [label, setLabel] = useState("");
  const [expiryIndex, setExpiryIndex] = useState(1);
  /** 剛建立的連結原文：只存在這個 state 裡，重新整理就沒了（後端只有雜湊） */
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = trpc.share.create.useMutation({
    onSuccess: (result) => {
      setFresh(fullUrl(result.url));
      setCopied(false);
      setLabel("");
      void utils.share.list.invalidate({ projectId });
    },
  });
  const revoke = trpc.share.revoke.useMutation({
    onSuccess: () => { void utils.share.list.invalidate({ projectId }); },
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false); // 沒有剪貼簿權限（http 或舊瀏覽器）時，連結本身仍看得到可手動選取
    }
  };

  const active = (links.data ?? []).filter((l) => !l.revokedAt);

  return (
    <Card data-fb="分享連結卡" id="project-share">
      <h2>分享給夥伴檢視</h2>
      <Hint layer="always" style={{ marginTop: 4 }}>
        產生一條唯讀連結：拿到的人不必登入就能看這個專案的設定、依據、分鏡與素材，但不能修改任何東西。
        連結本身就是憑證——傳給誰就等於開放給誰，不要貼在公開場合。
      </Hint>

      {canEdit && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
          <input
            aria-label="這條連結給誰（備註）"
            placeholder="給誰看的（選填，只有你們看得到）"
            value={label}
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
            style={{ flex: "1 1 200px", minWidth: 0 }}
          />
          <select
            aria-label="連結有效期"
            style={{ width: "auto" }}
            value={expiryIndex}
            onChange={(e) => setExpiryIndex(Number(e.target.value))}
          >
            {EXPIRY_CHOICES.map((choice, index) => (
              <option key={choice.label} value={index}>{choice.label}</option>
            ))}
          </select>
          <Button
            size="sm"
            variant="primary"
            disabled={create.isPending}
            onClick={() => create.mutate({
              projectId,
              label: label.trim() || undefined,
              expiresInDays: EXPIRY_CHOICES[expiryIndex]?.days,
            })}
          >
            {create.isPending ? "建立中…" : "建立分享連結"}
          </Button>
        </div>
      )}
      {!canEdit && <Meta as="p" style={{ marginTop: 8 }}>檢視者不能對外開連結——需要分享請找專案的編輯者。</Meta>}
      {create.error && <p className="error" role="alert">{create.error.message}</p>}

      {fresh && (
        <Card variant="std" style={{ marginTop: 10 }}>
          <Meta as="p" style={{ margin: 0 }}>連結已建立——現在複製起來，離開這頁就看不到了</Meta>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
            <input readOnly aria-label="分享連結" value={fresh} onFocus={(e) => e.target.select()} style={{ flex: "1 1 240px", minWidth: 0 }} />
            <Button size="sm" onClick={() => { void copy(fresh); }}>
              <Icon name="Copy" size={14} />{copied ? "已複製" : "複製"}
            </Button>
          </div>
        </Card>
      )}

      {active.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
          {active.map((link) => (
            <li
              key={link.id}
              style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid var(--border)" }}
            >
              <span style={{ flex: "1 1 160px", minWidth: 0 }}>
                {link.label || "未命名的連結"}
                <Meta as="span" style={{ marginLeft: 8 }}>
                  {link.expiresAt ? `${formatDate(link.expiresAt)} 到期` : "不設期限"}
                </Meta>
              </span>
              <Chip>{link.viewCount > 0 ? `已開啟 ${link.viewCount} 次` : "尚未被開啟"}</Chip>
              {canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate({ id: link.id })}
                >
                  收回
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {links.data && active.length === 0 && !fresh && (
        <Meta as="p" style={{ marginTop: 10 }}>目前沒有有效的分享連結。</Meta>
      )}
      {revoke.error && <p className="error" role="alert">{revoke.error.message}</p>}
    </Card>
  );
}
