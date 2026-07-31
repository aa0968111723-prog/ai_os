import { useMemo, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import type { DataField, DataRowData, DataRowValue } from "@shared/databaseFields";
import {
  PROJECT_DATA_TEMPLATES,
  projectDataAiHint,
  type ProjectDataTemplateId,
} from "@shared/projectDataTemplates";
import { Button, Card, EmptyState, Hint, Meta, Pill } from "./ui";
/**
 * 專案資料卡：
 * - 一眼看出 AI 能否引用本專案依據（知識／素材／已關聯表；尊重 agentAccess）。
 * - 一鍵建立「已關聯本專案」的組資料表；可就地加一列（不跳頁）。
 * - 深鏈到知識、素材、AI 工作台；不碰 #133 plan／notesCore／Runner。
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

/** 從欄位定義組出「加一列」預設 data：關聯專案必填 + 可選主文字 */
function buildQuickRowData(
  fields: DataField[],
  projectId: string,
  primaryText: string,
): { data: DataRowData; primaryKey: string | null } | { error: string } {
  const projectFields = fields.filter((f) => f.type === "project");
  if (projectFields.length === 0) return { error: "此表沒有關聯專案欄" };
  const data: DataRowData = {};
  for (const pf of projectFields) data[pf.key] = projectId;
  const primary = fields.find((f) => f.type === "text" && f.required) ?? fields.find((f) => f.type === "text");
  if (primary) {
    if (!primaryText.trim()) return { error: `請填「${primary.label}」` };
    data[primary.key] = primaryText.trim();
  }
  for (const f of fields) {
    if (f.type === "checkbox" && data[f.key] === undefined) data[f.key] = false;
  }
  // 其他 required 欄若未填，後端會擋——回人話
  return { data, primaryKey: primary?.key ?? null };
}

export function ProjectDatabasesCard({
  projectId,
  canEdit = true,
  open: openProp,
  onOpenChange,
}: {
  projectId: string;
  /** 唯讀成員不顯示一鍵建表／就地加列 */
  canEdit?: boolean;
  /** 受控展開（手機專案頁預設收合）；未傳則桌機維持預設展開 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const linked = trpc.databases.linkedToProject.useQuery({ projectId });
  const knowledge = trpc.knowledge.list.useQuery({ projectId });
  const assets = trpc.projects.assets.useQuery({ projectId });

  const [createError, setCreateError] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<{ tableId: string; tableName: string } | null>(null);
  const [quickDraft, setQuickDraft] = useState<Record<string, string>>({});
  const [quickError, setQuickError] = useState<Record<string, string>>({});
  const [quickOk, setQuickOk] = useState<Record<string, string>>({});

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

  const addRow = trpc.databases.addRow.useMutation({
    onSuccess: (_row, vars) => {
      setQuickDraft((d) => ({ ...d, [vars.tableId]: "" }));
      setQuickError((e) => ({ ...e, [vars.tableId]: "" }));
      setQuickOk((o) => ({ ...o, [vars.tableId]: "已新增" }));
      void utils.databases.linkedToProject.invalidate({ projectId });
    },
    onError: (err, vars) => {
      setQuickOk((o) => ({ ...o, [vars.tableId]: "" }));
      setQuickError((e) => ({ ...e, [vars.tableId]: err.message || "新增失敗" }));
    },
  });

  const groups = linked.data ?? [];
  const linkedRows = groups.reduce((n, group) => n + group.rows.length, 0);
  const linkedAiReadableRows = useMemo(
    () =>
      groups.reduce((n, group) => {
        if (group.agentAccess === "none") return n;
        return n + group.rows.length;
      }, 0),
    [groups],
  );
  const knowledgeCount = knowledge.data?.length ?? 0;
  const assetCount = assets.data?.length ?? 0;
  const countsReady = !knowledge.isLoading && !assets.isLoading && !linked.isLoading;
  const aiHint = projectDataAiHint({
    knowledgeCount: countsReady ? knowledgeCount : 0,
    assetCount: countsReady ? assetCount : 0,
    linkedRowCount: countsReady ? linkedRows : 0,
    linkedAiReadableRowCount: countsReady ? linkedAiReadableRows : 0,
  });
  const showStatus = countsReady;
  const toneStyle = TONE_STYLE[aiHint.tone];

  const onCreateTemplate = (template: ProjectDataTemplateId) => {
    if (!canEdit || createBound.isPending) return;
    setCreateError(null);
    createBound.mutate({ projectId, template });
  };

  const onQuickAdd = (tableId: string, fields: DataField[]) => {
    if (!canEdit || addRow.isPending) return;
    const built = buildQuickRowData(fields, projectId, quickDraft[tableId] ?? "");
    if ("error" in built) {
      setQuickError((e) => ({ ...e, [tableId]: built.error }));
      return;
    }
    setQuickError((e) => ({ ...e, [tableId]: "" }));
    setQuickOk((o) => ({ ...o, [tableId]: "" }));
    addRow.mutate({ tableId, data: built.data });
  };

  const controlled = openProp !== undefined;
  // 未受控時預設展開（桌機現況）；受控時完全交給父層（手機預設收合）
  const [uncontrolledOpen, setUncontrolledOpen] = useState(true);
  const open = controlled ? openProp : uncontrolledOpen;

  return (
    <Card as="details" variant="quiet"
      data-fb="專案資料"
      id="sec-databases"
      open={open}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open;
        if (controlled) onOpenChange?.(next);
        else setUncontrolledOpen(next);
      }}>
      <summary>
        <Icon name="Database" size={14} /> 專案資料
        <span className="meta" style={{ marginLeft: 8 }}>
          {linkedRows > 0
            ? `${groups.length} 張表 · ${linkedRows} 列已關聯`
            : "給 AI 與團隊共用的依據"}
        </span>
        <Icon name="ChevronDown" size={14} style={{ marginLeft: "auto" }} />
      </summary>

      <div style={{ marginTop: 10, display: "grid", gap: 14 }}>
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
            <Meta as="p" style={{ margin: "4px 0 0" }}>{aiHint.detail}</Meta>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <span className="meta">文字知識 {knowledgeCount}</span>
              <span className="meta">素材 {assetCount}</span>
              <span className="meta">關聯表列 {linkedRows}</span>
              <span className="meta">AI 可讀 {linkedAiReadableRows}</span>
            </div>
          </div>
        )}
        {!showStatus && (
          <Meta as="p" style={{ margin: 0 }}>正在判斷專案資料狀態…</Meta>
        )}

        <div>
          <Hint style={{ margin: "0 0 8px" }}>
            剪輯、社群、動畫、外出採集都能把依據放這裡。貼文字、上傳檔案，或一鍵建表；外部帳號連上後還要匯入或關聯專案，AI 才會使用。
          </Hint>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>
            <Button size="sm" onClick={() => scrollTo("sec-knowledge")}>
              <Icon name="FileText" size={13} /> 貼上文字
            </Button>
            <Button size="sm" onClick={() => scrollTo("sec-assets")}>
              <Icon name="Image" size={13} /> 上傳圖片、影片
            </Button>
            <Button size="sm" onClick={() => scrollTo("sec-ai-hub")}>
              <Icon name="Sparkles" size={13} /> 問 AI 助手
            </Button>
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

        {canEdit && (
          <div data-testid="project-data-templates">
            <h3 style={{ margin: "0 0 6px", fontSize: 14 }}>一鍵建立資料表</h3>
            <Hint layer="always" style={{ margin: "0 0 8px" }}>
              範本只是起點，之後可自由改欄位與名稱。自動含「關聯專案」、已連本專案，預設 AI 可讀寫。
            </Hint>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {PROJECT_DATA_TEMPLATES.map((t) => (
                <Button size="sm" variant="primary"
                  key={t.id}
                  type="button"
                  disabled={createBound.isPending}
                  title={t.hint}
                  onClick={() => onCreateTemplate(t.id)}>
                  <Icon name="Plus" size={13} /> {t.label}
                </Button>
              ))}
            </div>
            {createBound.isPending && (
              <Meta as="p" style={{ margin: "8px 0 0" }}>正在建立資料表…</Meta>
            )}
            {createError && (
              <p className="error" style={{ margin: "8px 0 0" }}>{createError}</p>
            )}
            {lastCreated && !createBound.isPending && (
              <Meta as="p" style={{ margin: "8px 0 0" }}>
                已建立「{lastCreated.tableName}」。
                <Link
                  href={`/databases?open=${encodeURIComponent(lastCreated.tableId)}&projectId=${encodeURIComponent(projectId)}&from=project`}
                  style={{ marginLeft: 6 }}
                >
                  開啟編輯 →
                </Link>
              </Meta>
            )}
          </div>
        )}

        {linked.isLoading && <Meta as="p" style={{ margin: 0 }}>正在讀取已關聯的資料…</Meta>}
        {linked.error && (
          <p className="error" style={{ margin: 0 }}>關聯資料載入失敗：{linked.error.message}</p>
        )}

        {!linked.isLoading && !linked.error && groups.length === 0 && (
          <EmptyState title={<>還沒有資料表關聯到這個專案</>} description={<>{canEdit
                ? "用上方一鍵範本最快；或到知識與資料匯入 CSV／自己設計欄位後，勾選「關聯此專案」。"
                : "請有編輯權限的成員建立或關聯資料表。"}</>} style={{ marginTop: 0 }} />
        )}

        {groups.length > 0 && (
          <div style={{ display: "grid", gap: 14 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>已關聯本專案的資料</h3>
            {groups.map((group) => {
              const fields = group.fields as DataField[];
              const cols = fields.filter((field) => field.type !== "project").slice(0, 5);
              const access = group.agentAccess as "none" | "read" | "write" | undefined;
              const primary = fields.find((f) => f.type === "text" && f.required) ?? fields.find((f) => f.type === "text");
              return (
                <div key={group.tableId}>
                  <p className="meta" style={{ margin: "0 0 4px", fontWeight: 600, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <Link
                      href={`/databases?open=${encodeURIComponent(group.tableId)}&projectId=${encodeURIComponent(projectId)}&from=project`}
                    >
                      {group.tableName}
                    </Link>
                    <span>（{group.rows.length} 列）</span>
                    <Pill title="此表對 AI 的存取設定" style={{ fontWeight: 500, fontSize: 12 }}>
                      {agentAccessLabel(access)}
                    </Pill>
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
                  {canEdit && primary && (
                    <div
                      data-testid={`quick-add-${group.tableId}`}
                      style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}
                    >
                      <input
                        aria-label={`${group.tableName} 新增 ${primary.label}`}
                        value={quickDraft[group.tableId] ?? ""}
                        maxLength={200}
                        placeholder={`${primary.label}…`}
                        onChange={(e) => setQuickDraft((d) => ({ ...d, [group.tableId]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            onQuickAdd(group.tableId, fields);
                          }
                        }}
                        style={{ flex: "1 1 160px", minWidth: 120, maxWidth: 320 }}
                      />
                      <Button size="sm" variant="primary"
                        type="button"
                        disabled={addRow.isPending}
                        onClick={() => onQuickAdd(group.tableId, fields)}>
                        <Icon name="Plus" size={13} /> 加一列
                      </Button>
                      {quickError[group.tableId] && (
                        <span className="error" style={{ fontSize: 12 }}>{quickError[group.tableId]}</span>
                      )}
                      {quickOk[group.tableId] && !quickError[group.tableId] && (
                        <Meta style={{ fontSize: 12 }}>{quickOk[group.tableId]}</Meta>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <Hint style={{ margin: 0 }}>
              要改欄位或大量編輯，請到
              <Link href={`/databases?projectId=${encodeURIComponent(projectId)}&from=project`}>知識與資料</Link>
              。資料表需有「關聯專案」欄並指向本專案，才會列在這裡。
            </Hint>
          </div>
        )}
      </div>
    </Card>
  );
}
