import { useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { Button, Meta } from "./ui";

/** 打包 job 的 localStorage key 前綴（逐專案）——重整／關頁回來要接回同一個 job。 */
const EXPORT_JOB_LS_PREFIX = "aios.exportJob.";

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
  /**
   * jobId 存 localStorage（QA 2026-08-01 實測）：打包是分鐘級長任務，使用者一定會重整或關頁再回來。
   * 只放 useState 時，重整後畫面退回「打包下載交付包」，伺服器早就打好的包完全找不到，只能重打一次。
   */
  const [jobId, setJobIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(EXPORT_JOB_LS_PREFIX + projectId);
    } catch {
      return null;
    }
  });
  const setJobId = (next: string | null) => {
    setJobIdState(next);
    try {
      if (next) localStorage.setItem(EXPORT_JOB_LS_PREFIX + projectId, next);
      else localStorage.removeItem(EXPORT_JOB_LS_PREFIX + projectId);
    } catch {
      /* 存不了只影響「重整後能不能接回進度」，不影響本次打包 */
    }
  };
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
      /**
       * 背景分頁也要繼續輪詢：實測切到別的分頁等打包，回來時進度條還停在「排隊中…」，
       * 但伺服器其實兩秒就打完了——React Query 預設在分頁失焦時停掉 interval。
       */
      refetchIntervalInBackground: true,
      // 舊 job 可能已被清掉（404）——別無限重試，讓 UI 直接回到可重新打包的狀態
      retry: false,
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
        <button type="button" className={triggerClassName} disabled={create.isPending} onClick={() => { setJobId(null); create.mutate({ projectId, assetIds }); }}>
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
