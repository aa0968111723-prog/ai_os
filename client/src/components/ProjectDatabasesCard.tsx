import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import type { DataField, DataRowData, DataRowValue } from "@shared/databaseFields";

/**
 * 專案資料入口＋關聯資料彙整：
 * - 不論目前有沒有關聯資料，都提供「從這個專案開始加入資料」的統一入口。
 * - 結構化資料仍透過 project 型別欄位連回專案；本卡只負責引導與唯讀彙整，不改既有資料模型。
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

export function ProjectDatabasesCard({ projectId }: { projectId: string }) {
  const linked = trpc.databases.linkedToProject.useQuery({ projectId });
  const groups = linked.data ?? [];
  const linkedRows = groups.reduce((n, group) => n + group.rows.length, 0);

  return (
    <details className="card card--quiet" data-fb="專案資料入口" id="sec-databases" open>
      <summary>
        <Icon name="FileText" size={14} /> 加入資料與專案資料表
        <span className="meta" style={{ marginLeft: 8 }}>
          {linkedRows > 0 ? `${linkedRows} 筆資料已連到本專案` : "從這裡選擇資料來源"}
        </span>
        <Icon name="ChevronDown" size={14} style={{ marginLeft: "auto" }} />
      </summary>

      <div style={{ marginTop: 10 }}>
        <p className="hint" style={{ margin: "0 0 10px" }}>
          先選擇資料從哪裡來。貼上的文字會直接成為本專案知識；Google、Notion、API 與資料表則需先匯入或連回本專案，AI 創作助手才會使用。
        </p>

        <div style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>
          <button type="button" className="btn-sm" onClick={() => scrollTo("sec-knowledge")}>
            <Icon name="FileText" size={13} /> 貼上文字／上傳 txt、md
          </button>
          <button type="button" className="btn-sm" onClick={() => scrollTo("sec-assets")}>
            <Icon name="Plus" size={13} /> 上傳圖片、影片、音訊
          </button>
          <Link href="/integrations" className="btn-sm" style={{ textDecoration: "none" }}>
            <Icon name="Package" size={13} /> Google／Notion／API
          </Link>
          <Link href={`/databases?projectId=${encodeURIComponent(projectId)}&from=project`} className="btn-sm" style={{ textDecoration: "none" }}>
            <Icon name="FileText" size={13} /> CSV、JSON 與資料表
          </Link>
        </div>

        <p className="hint" style={{ margin: "10px 0 0" }}>
          判斷方式：看到內容出現在「專案知識庫」或下方「已連到本專案的資料」後，AI 才能在本專案引用；只有完成帳號連接還不代表已匯入。
        </p>
      </div>

      {linked.isLoading && <p className="hint" style={{ marginTop: 12 }}>正在讀取本專案的關聯資料…</p>}
      {linked.error && <p className="error" style={{ marginTop: 12 }}>關聯資料載入失敗：{linked.error.message}</p>}

      {!linked.isLoading && !linked.error && groups.length === 0 && (
        <div className="empty-state" style={{ marginTop: 12 }}>
          <h3>目前沒有資料表連到這個專案</h3>
          <p>建立或匯入資料表後，加入「專案連結」欄位並選擇本專案，資料就會集中顯示在這裡。</p>
          <Link href={`/databases?projectId=${encodeURIComponent(projectId)}&from=project`}>前往知識與資料 →</Link>
        </div>
      )}

      {groups.length > 0 && (
        <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
          <h3 style={{ margin: 0 }}>已連到本專案的資料</h3>
          {groups.map((group) => {
            const cols = (group.fields as DataField[]).filter((field) => field.type !== "project").slice(0, 5);
            return (
              <div key={group.tableId}>
                <p className="meta" style={{ margin: "0 0 4px", fontWeight: 600 }}>
                  <Link href={`/databases?open=${encodeURIComponent(group.tableId)}&projectId=${encodeURIComponent(projectId)}&from=project`}>
                    {group.tableName}
                  </Link>
                  （{group.rows.length} 列）
                </p>
                <div style={{ overflowX: "auto" }}>
                  <table className="data-grid" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr>
                        {cols.map((field) => (
                          <th key={field.key} style={{ textAlign: "left", padding: "4px 8px", borderBottom: "1px solid var(--border, #ddd)", whiteSpace: "nowrap" }}>{field.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row) => (
                        <tr key={row.id}>
                          {cols.map((field) => (
                            <td key={field.key} style={{ padding: "4px 8px", borderBottom: "1px solid var(--border-soft, #eee)", whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
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
            要新增或修改資料，請到<Link href={`/databases?projectId=${encodeURIComponent(projectId)}&from=project`}>知識與資料</Link>。資料表需有「專案連結」欄位並指向本專案，才會出現在這裡。
          </p>
        </div>
      )}
    </details>
  );
}
