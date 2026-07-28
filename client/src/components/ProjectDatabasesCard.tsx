import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import type { DataField, DataRowData, DataRowValue } from "@shared/databaseFields";
import {
  PROJECT_DATA_TEMPLATES,
  projectDataAiHint,
  type ProjectDataTemplateId,
} from "@shared/projectDataTemplates";

/**
 * 本片資料卡（創作者視角）：
 * - 一眼看出 AI 能不能引用本片依據（知識／素材／已綁表）。
 * - 一鍵建立「已綁本專案」的組資料表（場次名單、金句、待辦…）。
 * - 深鏈到知識、素材、AI 創作工作台；不碰 #133 plan／notesCore／Runner。
 */
function cellText(field: DataField, value: DataRowValue): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "checkbox") return value ? "✓" : "—";
  if (field.type === "file") return "📎 附件";
  return String(value);
}

function scrollTo(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function agentAccessLabel(access: "none" | "read" | "write" | undefined): string {
  if (access === "none") return "AI 不可見";
  if (access === "read") return "AI 可讀";
  return "AI 可讀寫";
}

const TONE_STYLE: Record<"ok" | "partial" | "empty", { border: string; bg: string }> = {
  ok: { border: "var(--success, #2d8a4e)", bg: "color-mix(in srgb, var(--success, #2d8a4e) 12%, transparent)" },
  partial: { border: "var(--warning, #b8860b)", bg: "color-mix(in srgb, var(--warning, #b8860b) 12%, transparent)" },
  empty: { border: "var(--border, #ddd)", bg: "var(--surface-2, #f6f6f6)" },
};

export function ProjectDatabasesCard({
  projectId,
  canEdit = true,
}: {
  projectId: string;
  /** 唯讀成員不顯示一鍵建表 */
  canEdit?: boolean;
}) {
  const utils = trpc.useUtils();
  const linked = trpc.databases.linkedToProject.useQuery({ projectId });
  // 與 ProjectPage 同 key，共用快取，不另打網路
  const knowledge = trpc.knowledge.list.useQuery({ projectId });
  const assets = trpc.projects.assets.useQuery({ projectId });

  const [createError, setCreateError] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<{ tableId: string; tableName: string } | null>(null);

  const createBound = trpc.databases.createBoundToProject.useMutation({
    onSuccess: (res) => {
      setCreateError(null);
      setLastCreated({ tableId: res.tableId, tableName: res.tableName });
      void utils.databases.linkedToProject.invalidate({ projectId });
      void utils.databases.list.invalidate();
    },
    onError: (err) => {
      setCreateError(err.message || "建立失敗");
    },
  });

  const groups = linked.data ?? [];
  const linkedRows = groups.reduce((n, group) => n + group.rows.length, 0);
  const knowledgeCount = knowledge.data?.length ?? 0;
  const assetCount = assets.data?.length ?? 0;
  const countsReady = !knowledge.isLoading && !assets.isLoading && !linked.isLoading;
  const aiHint = projectDataAiHint({
    knowledgeCount: countsReady ? knowledgeCount : 0,
    assetCount: countsReady ? assetCount : 0,
    linkedRowCount: countsReady ? linkedRows : 0,
  });
  // 載入中先不誤導成「empty」
  const showStatus = countsReady;
  const toneStyle = TONE_STYLE[aiHint.tone];

  const onCreateTemplate = (template: ProjectDataTemplateId) => {
    if (!canEdit || createBound.isPending) return;
    setCreateError(null);
    createBound.mutate({ projectId, template });
  };

  return (
    <details className="card card--quiet" data-fb="本片資料" id="sec-databases" open>
      <summary>
        <Icon name="Database" size={14} /> 本片資料
        <span className="meta" style={{ marginLeft: 8 }}>
          {linkedRows > 0
            ? `${groups.length} 張表 · ${linkedRows} 列已綁本片`
            : "給 AI 與團隊共用的依據"}
        </span>
        <Icon name="ChevronDown" size={14} style={{ marginLeft: "auto" }} />
      </summary>

      <div style={{ marginTop: 10, display: "grid", gap: 14 }}>
        {/* —— AI 可引用狀態 —— */}
        {showStatus && (
          <div
            role="status"
            data-testid="project-data-ai-status"
            data-tone={aiHint.tone}
            style={{
              borderLeft: `3px solid ${toneStyle.border}`,
              background: toneStyle.bg,
              borderRadius: 6,
              padding: "10px 12px",
            }}
          >
            <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>
              {aiHint.tone === "ok" && <Icon name="CheckCircle2" size={14} style={{ marginRight: 6, verticalAlign: -2 }} />}
              {aiHint.tone === "partial" && <Icon name="TriangleAlert" size={14} style={{ marginRight: 6, verticalAlign: -2 }} />}
              {aiHint.tone === "empty" && <Icon name="Info" size={14} style={{ marginRight: 6, verticalAlign: -2 }} />}
              {aiHint.label}
            </p>
            <p className="hint" style={{ margin: "4px 0 0" }}>{aiHint.detail}</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <span className="meta">文字知識 {knowledgeCount}</span>
              <span className="meta">素材 {assetCount}</span>
              <span className="meta">本片表列 {linkedRows}</span>
            </div>
          </div>
        )}
        {!showStatus && (
          <p className="hint" style={{ margin: 0 }}>正在判斷本片資料狀態…</p>
        )}

        {/* —— 快速入口 —— */}
        <div>
          <p className="hint" style={{ margin: "0 0 8px" }}>
            先讓本片「有東西可讀」。貼文字、上傳檔案，或一鍵建表；連到 Google／Notion 後還要匯入或綁專案，AI 才會用。
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>
            <button type="button" className="btn-sm" onClick={() => scrollTo("sec-knowledge")}>
              <Icon name="FileText" size={13} /> 貼上文字／腳本
            </button>
            <button type="button" className="btn-sm" onClick={() => scrollTo("sec-assets")}>
              <Icon name="Image" size={13} /> 上傳圖片、影片
            </button>
            <button type="button" className="btn-sm" onClick={() => scrollTo("sec-ai-hub")}>
              <Icon name="Sparkles" size={13} /> 問 AI 創作助手
            </button>
            <Link href="/integrations" className="btn-sm" style={{ textDecoration: "none" }}>
              <Icon name="Package" size={13} /> Google／Notion／API
            </Link>
            <Link
              href={`/databases?projectId=${encodeURIComponent(projectId)}&from=project`}
              className="btn-sm"
              style={{ textDecoration: "none" }}
            >
              <Icon name="Database" size={13} /> 管理全部資料表
            </Link>
          </div>
        </div>

        {/* —— 一鍵本片表 —— */}
        {canEdit && (
          <div data-testid="project-data-templates">
            <h3 style={{ margin: "0 0 6px", fontSize: 14 }}>一鍵建立本片表</h3>
            <p className="hint" style={{ margin: "0 0 8px" }}>
              自動含「屬於哪支片」欄、已綁本專案，並預設 AI 可讀寫。建立後立刻出現在下方。
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {PROJECT_DATA_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="btn-sm primary"
                  disabled={createBound.isPending}
                  title={t.hint}
                  onClick={() => onCreateTemplate(t.id)}
                >
                  <Icon name="Plus" size={13} /> {t.label}
                </button>
              ))}
            </div>
            {createBound.isPending && (
              <p className="hint" style={{ margin: "8px 0 0" }}>正在建立本片表…</p>
            )}
            {createError && (
              <p className="error" style={{ margin: "8px 0 0" }}>{createError}</p>
            )}
            {lastCreated && !createBound.isPending && (
              <p className="hint" style={{ margin: "8px 0 0" }}>
                已建立「{lastCreated.tableName}」。
                <Link
                  href={`/databases?open=${encodeURIComponent(lastCreated.tableId)}&projectId=${encodeURIComponent(projectId)}&from=project`}
                  style={{ marginLeft: 6 }}
                >
                  開啟編輯 →
                </Link>
              </p>
            )}
          </div>
        )}

        {/* —— 已綁本片 —— */}
        {linked.isLoading && <p className="hint" style={{ margin: 0 }}>正在讀取已綁本片的資料…</p>}
        {linked.error && (
          <p className="error" style={{ margin: 0 }}>關聯資料載入失敗：{linked.error.message}</p>
        )}

        {!linked.isLoading && !linked.error && groups.length === 0 && (
          <div className="empty-state" style={{ marginTop: 0 }}>
            <h3>還沒有資料表綁到這支片</h3>
            <p>
              {canEdit
                ? "用上方一鍵範本最快；或到知識與資料匯入 CSV／自己設計欄位後，用「屬於哪支片」指到本專案。"
                : "請有編輯權限的成員建立或綁定資料表。"}
            </p>
          </div>
        )}

        {groups.length > 0 && (
          <div style={{ display: "grid", gap: 14 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>已綁本片的資料</h3>
            {groups.map((group) => {
              const cols = (group.fields as DataField[])
                .filter((field) => field.type !== "project")
                .slice(0, 5);
              const access = group.agentAccess as "none" | "read" | "write" | undefined;
              return (
                <div key={group.tableId}>
                  <p className="meta" style={{ margin: "0 0 4px", fontWeight: 600, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <Link
                      href={`/databases?open=${encodeURIComponent(group.tableId)}&projectId=${encodeURIComponent(projectId)}&from=project`}
                    >
                      {group.tableName}
                    </Link>
                    <span>（{group.rows.length} 列）</span>
                    <span
                      className="pill"
                      title="此表對 AI 的存取設定"
                      style={{ fontWeight: 500, fontSize: 12 }}
                    >
                      {agentAccessLabel(access)}
                    </span>
                  </p>
                  <div style={{ overflowX: "auto" }}>
                    <table className="data-grid" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr>
                          {cols.map((field) => (
                            <th
                              key={field.key}
                              style={{
                                textAlign: "left",
                                padding: "4px 8px",
                                borderBottom: "1px solid var(--border, #ddd)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {field.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => (
                          <tr key={row.id}>
                            {cols.map((field) => (
                              <td
                                key={field.key}
                                style={{
                                  padding: "4px 8px",
                                  borderBottom: "1px solid var(--border-soft, #eee)",
                                  whiteSpace: "nowrap",
                                  maxWidth: 200,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {cellText(field, (row.data as DataRowData)[field.key] ?? null)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
            <p className="hint" style={{ margin: 0 }}>
              要改欄位或加列，請到
              <Link href={`/databases?projectId=${encodeURIComponent(projectId)}&from=project`}>知識與資料</Link>
              。資料表需有「屬於哪支片／專案連結」欄並指向本專案，才會列在這裡。
            </p>
          </div>
        )}
      </div>
    </details>
  );
}
