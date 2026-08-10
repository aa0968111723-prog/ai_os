import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../api";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { Button, Card, Hint, Meta, Pill } from "../../components/ui";
import { ExternalAssetIntake } from "../external-intake/ExternalAssetIntake";
import { hasDesktopBridge, materializeEditingPackage } from "../../platform/desktopBridge";

type EditingSession = inferRouterOutputs<AppRouter>["externalEditing"]["list"][number];

const STATUS: Record<string, { label: string; pill: "done" | "running" | "queued" | "failed" }> = {
  preparing: { label: "準備中", pill: "running" },
  ready: { label: "可交接", pill: "queued" },
  handed_off: { label: "已交接", pill: "running" },
  returning: { label: "正在回傳", pill: "running" },
  returned: { label: "已回傳", pill: "done" },
  needs_review: { label: "成果待審核", pill: "queued" },
  completed: { label: "已完成", pill: "done" },
  cancelled: { label: "已取消", pill: "failed" },
  failed: { label: "失敗", pill: "failed" },
};

export function EditingSessionCard({ session, onChanged, onResultReturned, onReview }: {
  session: EditingSession;
  onChanged?: () => void;
  onResultReturned?: (assetIds: string[]) => void;
  onReview?: (assetId: string) => void;
}) {
  const [message, setMessage] = useState("");
  const mark = trpc.externalEditing.markHandedOff.useMutation({ onSuccess: onChanged });
  const cancel = trpc.externalEditing.cancel.useMutation({ onSuccess: onChanged });
  const complete = trpc.externalEditing.complete.useMutation({ onSuccess: onChanged });
  const reprepare = trpc.externalEditing.reprepare.useMutation({ onSuccess: onChanged });
  const status = STATUS[session.status] ?? { label: session.status, pill: "queued" as const };
  const downloadUrl = session.package ? `/api/editing-packages/${session.package.id}/download` : null;
  const active = !["cancelled", "completed", "failed"].includes(session.status);
  const packageUnavailable = !!session.package && (session.package.revokedAt != null || new Date(session.package.expiresAt).getTime() <= Date.now());

  const handoff = async () => {
    if (!session.package || !downloadUrl) return;
    setMessage("");
    try {
      const totalBytes = session.package.manifest.assets.reduce((sum, asset) => sum + (asset.sizeBytes ?? 0), 0);
      if (navigator.share && totalBytes <= 100 * 1024 * 1024) {
        const response = await fetch(downloadUrl, { credentials: "same-origin" });
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "交接包下載失敗");
        const file = new File([await response.blob()], session.package.fileName, { type: "application/zip" });
        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          await navigator.share({ title: "Aios · LumaFusion 剪輯交接", files: [file] });
          await mark.mutateAsync({ sessionId: session.id });
          setMessage("已開啟系統分享；請儲存到 Files 或選擇可接收 ZIP 的目的地。");
          return;
        }
      }
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = session.package.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      await mark.mutateAsync({ sessionId: session.id });
      setMessage("下載已開始。請解壓縮後，從 LumaFusion 加入需要的媒體。");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        setMessage("分享已取消；工作階段仍保留，可稍後重試。");
      } else setMessage(caught instanceof Error ? caught.message : "交接失敗");
    }
  };

  const saveToDesktop = async () => {
    if (!session.package) return;
    setMessage("正在將交接包儲存到 Aios 桌面資料夾…");
    const result = await materializeEditingPackage({
      packageId: session.package.id,
      editingSessionId: session.id,
      fileName: session.package.fileName,
    });
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    await mark.mutateAsync({ sessionId: session.id });
    setMessage(`已儲存 ${result.localName ?? session.package.fileName}，並在檔案管理器顯示。`);
  };

  return (
    <Card as="article" className="editing-session-card" variant="std">
      <div className="editing-session-card__head">
        <div>
          <strong>LumaFusion 剪輯交接</strong>
          <Meta as="div">{new Date(session.createdAt).toLocaleString()} · {session.shotIds.length} 個 Shot</Meta>
        </div>
        <Pill status={status.pill}>{status.label}</Pill>
      </div>
      <Meta as="p">工作階段 {session.id.slice(0, 8)} · 素材 {session.assetIds.length} 份</Meta>
      {session.package ? <Meta as="p">交接包有效至 {new Date(session.package.expiresAt).toLocaleString()}</Meta> : null}
      <div className="editing-session-card__actions">
        {active && downloadUrl && !packageUnavailable ? <Button size="sm" variant="primary" disabled={mark.isPending} onClick={() => void handoff()}>
          <Icon name="Share2" size={13} /> 分享／下載交接包
        </Button> : null}
        {active && session.package && !packageUnavailable && hasDesktopBridge() ? <Button size="sm" variant="tonal" disabled={mark.isPending}
          onClick={() => void saveToDesktop()}><Icon name="HardDrive" size={13} /> 儲存到本機並顯示</Button> : null}
        {active && packageUnavailable ? <Button size="sm" variant="primary" disabled={reprepare.isPending}
          onClick={() => reprepare.mutate({ sessionId: session.id })}>重新準備交接包</Button> : null}
        {active ? <ExternalAssetIntake projectId={session.projectId} editingSessionId={session.id}
          triggerLabel="回傳剪輯成果" triggerVariant="tonal" onImported={(notice) => {
            onChanged?.();
            if (notice?.assetIds.length) onResultReturned?.(notice.assetIds);
          }} /> : null}
        {session.returnedAssetId ? <Button as="a" size="sm" variant="ghost" href={`/api/assets/${session.returnedAssetId}/file`}>
          <Icon name="Play" size={13} /> 查看回傳成果
        </Button> : null}
        {session.returnedAssetId && onReview ? <Button size="sm" variant="tonal"
          onClick={() => onReview(session.returnedAssetId!)}>AI 幫我審片</Button> : null}
        {session.status === "needs_review" ? <Button size="sm" variant="primary" disabled={complete.isPending}
          onClick={() => complete.mutate({ sessionId: session.id })}>確認完成</Button> : null}
        {active && !session.returnedAssetId ? <Button size="sm" variant="ghost" disabled={cancel.isPending}
          onClick={() => cancel.mutate({ sessionId: session.id })}>取消工作階段</Button> : null}
      </div>
      {message ? <Hint role="status">{message}</Hint> : null}
      {(mark.error || cancel.error || complete.error || reprepare.error) ? <p className="error" role="alert">{mark.error?.message ?? cancel.error?.message ?? complete.error?.message ?? reprepare.error?.message}</p> : null}
    </Card>
  );
}

export function EditingResultCard({ assetId, sessionId, onReview }: {
  assetId: string;
  sessionId: string;
  onReview?: (assetId: string) => void;
}) {
  return (
    <Card variant="std" className="editing-result-card">
      <Pill status="done">LumaFusion 回傳成果</Pill>
      <strong>已安全保存並連回原剪輯工作階段</strong>
      <Meta>Session {sessionId.slice(0, 8)} · 版本血緣與來源已記錄</Meta>
      <div className="editing-session-card__actions">
        {onReview ? <Button size="sm" variant="primary" onClick={() => onReview(assetId)}>AI 幫我審片</Button> : null}
        <Button as="a" size="sm" variant="tonal" href={`/api/assets/${assetId}/file`}>查看成果</Button>
      </div>
    </Card>
  );
}
