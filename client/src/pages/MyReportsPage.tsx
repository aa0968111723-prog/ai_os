import { Link } from "wouter";
import { trpc } from "../api";
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUS_LABEL } from "@shared/options";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";
import { Chip, Hint, Meta } from "../components/ui";

/** 分類 value→中文標籤（追蹤列的分類 chip） */
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  FEEDBACK_CATEGORIES.map((c) => [c.value, c.label]),
);

/** 分診嚴重度標籤（與 AdminPage 一致；追蹤頁只給回報者看，配色從簡） */
const SEVERITY_LABEL: Record<string, string> = { high: "高", medium: "中", low: "低" };

/**
 * 「我的回報」追蹤頁：使用者用右下角「回饋」浮標送出的元件回饋,送完在這裡看得到
 * 被處理到哪、回饋代理回了什麼——不必靠 email（常未設定或漏收）。
 */
export function MyReportsPage() {
  const mine = trpc.feedbackReports.mine.useQuery();

  return (
    <div className="page-shell secondary-page secondary-page--reading reports-page">
      <SecondaryPageHeader
        eyebrow="回饋追蹤"
        title="我的回報"
        icon="MessageCircle"
        badge={mine.isLoading ? "正在同步狀態" : `${mine.data?.length ?? 0} 筆回報`}
        description={<>你從右下角回饋入口送出的意見都留在這裡；處理進度與回覆會集中更新。</>}
      />

      {mine.isLoading ? (
        <div role="status" aria-label="載入中" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 84, marginBottom: 12, borderRadius: 12 }} />
          ))}
        </div>
      ) : mine.isError ? (
        <p className="error" role="alert">
          載入不了——請稍候再{" "}
          <button onClick={() => mine.refetch()}>重試</button>
        </p>
      ) : !mine.data?.length ? (
        <div className="card" style={{ textAlign: "center", padding: 32 }}>
          <h3>你還沒有送過回報</h3>
          <Hint layer="always">
            在任何頁面用右下角「回饋」浮標標定某個元件、或只針對這一頁說幾句就會出現在這裡。
          </Hint>
          <Link href="/dashboard">回今日工作台</Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {mine.data.map((r) => (
            <ReportCard key={r.id} report={r} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 追蹤列所需欄位（對齊 feedbackReports.mine 的 select 投影） */
type MineReport = {
  id: string;
  category: string;
  pages: unknown;
  targetLabel: string | null;
  note: string;
  status: string;
  agentReviewedAt: string | Date | null;
  agentSeverity: string | null;
  agentReply: string | null;
  emailStatus: string | null;
  createdAt: string | Date;
};

function ReportCard({ report }: { report: MineReport }) {
  const pages = Array.isArray(report.pages) ? (report.pages as string[]) : [];
  const statusLabel = FEEDBACK_STATUS_LABEL[report.status] ?? report.status;
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Chip style={{ margin: 0 }}>{CATEGORY_LABEL[report.category] ?? report.category}</Chip>
        <Chip style={{ margin: 0 }}>{statusLabel}</Chip>
        {report.targetLabel && <Meta style={{ fontSize: 12 }}>標定：{report.targetLabel}</Meta>}
        <Meta style={{ fontSize: 12, marginLeft: "auto" }}>
          {new Date(report.createdAt).toLocaleString("zh-TW")}
        </Meta>
      </div>

      {pages.length > 0 && (
        <Meta as="p" style={{ margin: "8px 0 0", fontSize: 12 }}>頁面：{pages.join("、")}</Meta>
      )}

      <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", fontSize: 13 }}>{report.note}</p>

      {report.agentReviewedAt ? (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 8,
            background: "var(--card2)",
            border: "1px solid var(--border-soft)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Chip style={{ margin: 0, fontSize: 11 }}>🤖 回饋代理回覆</Chip>
            {report.agentSeverity && (
              <Meta style={{ fontSize: 12 }}>嚴重度：{SEVERITY_LABEL[report.agentSeverity] ?? report.agentSeverity}</Meta>
            )}
          </div>
          {report.agentReply ? (
            <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 13 }}>{report.agentReply}</p>
          ) : (
            <Meta as="p" style={{ margin: 0 }}>已收到並記錄,稍後處理。</Meta>
          )}
        </div>
      ) : (
        <Hint style={{ marginTop: 12, fontSize: 12 }}>
          已收到,等候查看與回覆——通常很快,最長每 3 天會巡一輪。
        </Hint>
      )}
    </div>
  );
}
