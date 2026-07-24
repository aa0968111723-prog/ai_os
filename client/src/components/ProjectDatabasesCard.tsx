import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import type { DataField, DataRowData, DataRowValue } from "@shared/databaseFields";

/**
 * 專案 × 資料庫細部連結：列出「哪些自訂資料庫的哪些列指到這個專案」
 * （透過 project 型別欄位）。例：器材借用表裡指派給本片的器材、任務表裡本片的待辦。
 * 唯讀彙整；要編輯到「資料庫」頁。無連結列時整卡不顯示（不佔版面）。
 */
function cellText(field: DataField, value: DataRowValue): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "checkbox") return value ? "✓" : "—";
  if (field.type === "file") return "📎 附件"; // 值是文件 uuid——唯讀彙整卡不解析檔名，到資料庫頁看
  return String(value);
}

export function ProjectDatabasesCard({ projectId }: { projectId: string }) {
  const linked = trpc.databases.linkedToProject.useQuery({ projectId });
  const groups = linked.data ?? [];
  if (!linked.data || groups.length === 0) return null;

  return (
    <details className="card card--quiet" data-fb="專案關聯資料庫卡" id="sec-databases" open>
      <summary>
        <Icon name="FileText" size={14} /> 關聯資料庫
        <span className="meta" style={{ marginLeft: 8 }}>
          {groups.reduce((n, g) => n + g.rows.length, 0)} 筆資料指到這個專案
        </span>
        <Icon name="ChevronDown" size={14} style={{ marginLeft: "auto" }} />
      </summary>
      <div style={{ marginTop: 10, display: "grid", gap: 14 }}>
        {groups.map((g) => {
          // 只顯示前幾個欄位，避免寬表爆版；project 欄本身不重複顯示
          const cols = (g.fields as DataField[]).filter((f) => f.type !== "project").slice(0, 5);
          return (
            <div key={g.tableId}>
              <p className="meta" style={{ margin: "0 0 4px", fontWeight: 600 }}>
                <Link href="/databases">{g.tableName}</Link>（{g.rows.length} 列）
              </p>
              <div style={{ overflowX: "auto" }}>
                <table className="data-grid" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      {cols.map((f) => (
                        <th key={f.key} style={{ textAlign: "left", padding: "4px 8px", borderBottom: "1px solid var(--border, #ddd)", whiteSpace: "nowrap" }}>{f.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.id}>
                        {cols.map((f) => (
                          <td key={f.key} style={{ padding: "4px 8px", borderBottom: "1px solid var(--border-soft, #eee)", whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {cellText(f, (r.data as DataRowData)[f.key] ?? null)}
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
          在「資料庫」的欄位加一個「專案連結」型別、指到本專案，就會出現在這裡。<Link href="/databases">管理資料庫 →</Link>
        </p>
      </div>
    </details>
  );
}
