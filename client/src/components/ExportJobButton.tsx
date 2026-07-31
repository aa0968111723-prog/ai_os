import { useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { Button, Meta } from "./ui";

function fmtMb(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  // 多支影片的交付包輕易破 1GB——顯示 2.0GB 而非 2048.0MB（與資料庫頁 formatBytes 同口徑）
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)}GB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * 交付包匯出（QA-005 非同步 job 版）：點擊建 job → 背景打包 → 就地顯示進度（N/M 檔・大小）→
 * 完成出現下載鈕。取代舊的同步下載連結——大包不再像卡死，重複點擊也只會共用同一個 job。
 * assetIds＝素材庫多選打包；不帶＝全量交付包。
 */
export function ExportJobButton({
  projectId,
  assetIds,
  idleLabel = "打包下載交付包（.zip）",
  triggerClassName = "primary",
}: {
  projectId: string;
  assetIds?: string[];
  idleLabel?: string;
  triggerClassName?: string;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const create = trpc.exportJobs.create.useMutation({ onSuccess: (d) => setJobId(d.job.id) });
  const job = trpc.exportJobs.get.useQuery(
    { id: jobId ?? "" },
    {
      enabled: !!jobId,
      // 進行中每 2 秒輪詢；到終局（done/failed/cancelled）即停
      refetchInterval: (q) => {
        const s = q.state.data?.status;
        return s === "queued" || s === "running" ? 2000 : false;
      },
    },
  );
  const cancel = trpc.exportJobs.cancel.useMutation({ onSuccess: () => void job.refetch() });

  const status = jobId ? job.data?.status : null;

  if (!jobId || (!job.data && !job.isLoading)) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className={triggerClassName} disabled={create.isPending} onClick={() => create.mutate({ projectId, assetIds })}>
          {create.isPending ? "排入打包佇列中…" : idleLabel}
        </button>
        {create.error && <span className="error">{create.error.message}</span>}
      </span>
    );
  }

  if (status === "done") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <a href={`/api/export/jobs/${jobId}/download`} download className="primary" style={{ textDecoration: "none" }}>
          <Icon name="Check" size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />
          下載交付包（{fmtMb(job.data?.bytesWritten ?? 0)}）
        </a>
        <Button variant="ghost" size="sm" onClick={() => setJobId(null)} title="內容有更新時重新打包一份新的">
          重新打包
        </Button>
      </span>
    );
  }

  if (status === "failed" || status === "cancelled") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className={triggerClassName} disabled={create.isPending} onClick={() => create.mutate({ projectId, assetIds })}>
          重新打包
        </button>
        {status === "failed" ? (
          <span className="error">打包失敗：{job.data?.error ?? "未知原因"}</span>
        ) : (
          <Meta>已取消打包</Meta>
        )}
      </span>
    );
  }

  // queued / running（或首次載入中）：進度＋取消——不再是看似卡死的無回饋等待（QA-005）
  const done = job.data?.doneEntries ?? 0;
  const total = job.data?.totalEntries ?? 0;
  const bytes = job.data?.bytesWritten ?? 0;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <Meta role="status" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="Loader" className="spin" size={14} />
        {status === "queued" ? "排隊中…" : `打包中… ${total > 0 ? `${done}/${total} 檔・` : ""}${fmtMb(bytes)}`}
        （大包可能需要數分鐘，可離開此頁稍後回來）
      </Meta>
      <Button variant="ghost" size="sm" disabled={cancel.isPending} onClick={() => jobId && cancel.mutate({ id: jobId })}>
        取消
      </Button>
    </span>
  );
}
