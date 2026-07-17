import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { ConfirmButton } from "../components/interactions";
import { FIELD_TYPES, newFieldKey, type DataField, type DataRowData, type DataRowValue } from "@shared/databaseFields";

/**
 * 資料庫（工作台入口）：個人→組→團隊→全站 四層範圍的自訂結構化資料。
 * 欄位自訂、格線編輯；權限由後端 databaseAcl 決定（前端只按 access 旗標收斂 UI）。
 * AI 也看得到：組/團隊/全站庫會進團隊助手的上下文，外部代理走 MCP 三工具。
 */

const SCOPE_LABEL: Record<string, string> = { personal: "個人", group: "組", team: "團隊", global: "全站" };
const SCOPE_HINT: Record<string, string> = {
  personal: "只有你自己看得到",
  group: "組成員共用（組長管理）",
  team: "整個團隊共用（團隊管理員管理）",
  global: "全站都看得到（開發者管理）",
};

type TableSummary = {
  id: string;
  scope: "personal" | "group" | "team" | "global";
  groupId: string | null;
  teamId: string | null;
  name: string;
  description: string | null;
  fields: DataField[];
  memberWritable: boolean;
  agentAccess: "none" | "read" | "write";
  rowCount: number;
  access: { canRead: boolean; canWriteRows: boolean; canManage: boolean };
};

/** AI／MCP 存取等級的顯示文案（管理者在建立與詳頁都能調） */
const AGENT_ACCESS_OPTIONS: Array<{ value: TableSummary["agentAccess"]; label: string; hint: string }> = [
  { value: "write", label: "AI 可查可寫", hint: "團隊助手看得到；MCP 代理可查詢、可新增列（仍受本人權限限制）" },
  { value: "read", label: "AI 唯讀", hint: "團隊助手看得到；MCP 代理只能查詢、不能寫" },
  { value: "none", label: "不開放 AI", hint: "團隊助手與 MCP 代理完全看不到這個庫" },
];

export function DatabasesPage({ groupId }: { groupId: string }) {
  const list = trpc.databases.list.useQuery();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const tables = (list.data ?? []) as TableSummary[];
  const selected = tables.find((t) => t.id === selectedId) ?? null;
  const byScope = useMemo(() => {
    const out: Record<string, TableSummary[]> = { personal: [], group: [], team: [], global: [] };
    for (const t of tables) out[t.scope]?.push(t);
    return out;
  }, [tables]);

  return (
    <div>
      <h1>資料庫</h1>
      <p className="hint">
        自訂欄位的輕量資料表：個人清單、組名單、團隊器材、全站公告都放得下。組以上範圍的資料庫，
        團隊 AI 助手答題時看得到；外部 AI 代理（MCP）也能查詢與寫入——權限跟你在網頁上一樣。
      </p>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap", marginTop: 12 }}>
        {/* 左欄：清單＋建立 */}
        <div style={{ flex: "0 1 280px", minWidth: 240 }}>
          <button className="primary" onClick={() => { setCreating(true); setSelectedId(null); }}>
            <Icon name="Plus" size={14} /> 建立資料庫
          </button>
          {(["personal", "group", "team", "global"] as const).map((scope) =>
            byScope[scope].length === 0 ? null : (
              <div key={scope} style={{ marginTop: 16 }}>
                <p className="hint" style={{ margin: "0 0 4px" }}>{SCOPE_LABEL[scope]}</p>
                {byScope[scope].map((t) => (
                  <button
                    key={t.id}
                    className="menu-item"
                    style={{ width: "100%", textAlign: "left", ...(t.id === selectedId ? { background: "var(--bg-sunken, rgba(0,0,0,.05))", borderRadius: 8 } : {}) }}
                    onClick={() => { setSelectedId(t.id); setCreating(false); }}
                  >
                    <Icon name="FileText" size={15} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                    <span className="meta mono" style={{ marginLeft: "auto" }}>{t.rowCount}</span>
                  </button>
                ))}
              </div>
            ),
          )}
          {list.data && tables.length === 0 && !creating && (
            <div className="empty-state" style={{ marginTop: 16 }}>
              <h3>還沒有資料庫</h3>
              <p>先建一個試試：比如「拍攝器材借用表」或你自己的待辦清單。</p>
            </div>
          )}
        </div>

        {/* 右欄：建立表單 or 選中庫的格線 */}
        <div style={{ flex: "1 1 560px", minWidth: 320 }}>
          {creating ? (
            <CreateTableCard
              groupId={groupId}
              onDone={(id) => { setCreating(false); setSelectedId(id); }}
              onCancel={() => setCreating(false)}
            />
          ) : selected ? (
            <TableDetail key={selected.id} table={selected} groupId={groupId} onDeleted={() => setSelectedId(null)} />
          ) : (
            <div className="empty-state">
              <h3>選一個資料庫</h3>
              <p>從左邊清單選一個開始編輯，或建立新的。</p>
            </div>
          )}
        </div>
      </div>
      <p style={{ marginTop: 24 }}><Link href="/">回作業台</Link></p>
    </div>
  );
}

/* ────────────────────────── 建立 ────────────────────────── */

function CreateTableCard({ groupId, onDone, onCancel }: { groupId: string; onDone: (id: string) => void; onCancel: () => void }) {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"personal" | "group" | "team" | "global">("personal");
  const [memberWritable, setMemberWritable] = useState(true);
  const [agentAccess, setAgentAccess] = useState<TableSummary["agentAccess"]>("write");
  const [fields, setFields] = useState<DataField[]>([{ key: newFieldKey(), label: "名稱", type: "text", required: true }]);

  const myGroups = me.data?.groups ?? [];
  const activeGroup = myGroups.find((g) => g.groupId === groupId) ?? myGroups[0];
  // 團隊清單去重（同團隊多組只列一次）
  const myTeams = [...new Map(myGroups.map((g) => [g.teamId, { teamId: g.teamId, teamName: g.teamName }])).values()];
  const [pickGroupId, setPickGroupId] = useState(activeGroup?.groupId ?? "");
  const [pickTeamId, setPickTeamId] = useState(myTeams[0]?.teamId ?? "");
  const isSuperAdmin = !!me.data?.user.isSuperAdmin;

  const create = trpc.databases.create.useMutation({
    onSuccess: (row) => { utils.databases.list.invalidate(); onDone(row.id); },
  });
  const canSubmit = name.trim().length > 0 && fields.length > 0 && fields.every((f) => f.label.trim()) && !create.isPending;

  return (
    <section className="card" data-fb="建立資料庫卡">
      <h2>建立資料庫</h2>
      <label htmlFor="db-name">名字</label>
      <input id="db-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="例：拍攝器材借用表" autoFocus />
      <label htmlFor="db-desc">說明（選填）</label>
      <input id="db-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="這張表放什麼、給誰看" />

      <label htmlFor="db-scope">範圍</label>
      <select id="db-scope" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
        <option value="personal">個人——{SCOPE_HINT.personal}</option>
        {myGroups.length > 0 && <option value="group">組——{SCOPE_HINT.group}</option>}
        {myTeams.length > 0 && <option value="team">團隊——{SCOPE_HINT.team}</option>}
        {isSuperAdmin && <option value="global">全站——{SCOPE_HINT.global}</option>}
      </select>
      {scope === "group" && (
        <select aria-label="選擇組別" value={pickGroupId} onChange={(e) => setPickGroupId(e.target.value)}>
          {myGroups.map((g) => <option key={g.groupId} value={g.groupId}>{g.teamName}・{g.groupName}</option>)}
        </select>
      )}
      {scope === "team" && (
        <select aria-label="選擇團隊" value={pickTeamId} onChange={(e) => setPickTeamId(e.target.value)}>
          {myTeams.map((t) => <option key={t.teamId} value={t.teamId}>{t.teamName}</option>)}
        </select>
      )}
      {scope !== "personal" && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <input type="checkbox" checked={memberWritable} onChange={(e) => setMemberWritable(e.target.checked)} style={{ width: "auto" }} />
          成員可新增／編輯資料（關掉＝只有管理者能寫，適合公告類）
        </label>
      )}

      <label htmlFor="db-agent">AI 存取（MCP 代理與團隊助手）</label>
      <select id="db-agent" value={agentAccess} onChange={(e) => setAgentAccess(e.target.value as TableSummary["agentAccess"])}>
        {AGENT_ACCESS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}——{o.hint}</option>)}
      </select>

      <h3 style={{ marginBottom: 4 }}>欄位</h3>
      <FieldsEditor fields={fields} onChange={setFields} />

      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button
          className="primary"
          disabled={!canSubmit}
          onClick={() =>
            create.mutate({
              scope,
              groupId: scope === "group" ? pickGroupId : undefined,
              teamId: scope === "team" ? pickTeamId : undefined,
              name: name.trim(),
              description: description.trim() || undefined,
              fields: fields.map((f) => ({ ...f, label: f.label.trim() })),
              memberWritable,
              agentAccess,
            })
          }
        >
          {create.isPending ? "建立中…" : "建立"}
        </button>
        <button onClick={onCancel}>取消</button>
      </div>
      {create.error && <p className="error" role="alert">{create.error.message}</p>}
    </section>
  );
}

/** 欄位編輯器（建立與結構調整共用）：label/type/必填/單選選項 */
function FieldsEditor({ fields, onChange }: { fields: DataField[]; onChange: (f: DataField[]) => void }) {
  const set = (i: number, patch: Partial<DataField>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div>
      {fields.map((f, i) => (
        <div key={f.key} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
          <input aria-label={`欄位 ${i + 1} 名稱`} value={f.label} maxLength={40} placeholder="欄位名稱" style={{ flex: "1 1 120px" }} onChange={(e) => set(i, { label: e.target.value })} />
          <select aria-label={`欄位 ${i + 1} 型別`} value={f.type} style={{ width: "auto" }} onChange={(e) => set(i, { type: e.target.value as DataField["type"], options: e.target.value === "select" ? f.options ?? ["選項一"] : undefined })}>
            {FIELD_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          {f.type === "select" && (
            <input
              aria-label={`欄位 ${i + 1} 選項`}
              value={(f.options ?? []).join("、")}
              placeholder="選項用、分隔"
              style={{ flex: "1 1 140px" }}
              onChange={(e) => set(i, { options: e.target.value.split(/[、,]/).map((s) => s.trim()).filter(Boolean) })}
            />
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={!!f.required} onChange={(e) => set(i, { required: e.target.checked })} style={{ width: "auto" }} />必填
          </label>
          <button className="btn-sm" aria-label={`刪除欄位 ${f.label || i + 1}`} disabled={fields.length <= 1} onClick={() => onChange(fields.filter((_, j) => j !== i))}>
            <Icon name="X" size={13} />
          </button>
        </div>
      ))}
      <button className="btn-sm" style={{ marginTop: 8 }} disabled={fields.length >= 30} onClick={() => onChange([...fields, { key: newFieldKey(), label: "", type: "text" }])}>
        <Icon name="Plus" size={13} /> 加欄位
      </button>
    </div>
  );
}

/* ────────────────────────── 詳頁：格線＋結構 ────────────────────────── */

function TableDetail({ table, groupId, onDeleted }: { table: TableSummary; groupId: string; onDeleted: () => void }) {
  const utils = trpc.useUtils();
  const [q, setQ] = useState("");
  const [editStructure, setEditStructure] = useState(false);
  const rows = trpc.databases.listRows.useQuery({ tableId: table.id, q: q.trim() || undefined });
  const invalidate = () => { utils.databases.listRows.invalidate({ tableId: table.id, q: q.trim() || undefined }); utils.databases.list.invalidate(); };
  const addRow = trpc.databases.addRow.useMutation({ onSuccess: invalidate });
  const updateRow = trpc.databases.updateRow.useMutation({ onSuccess: invalidate });
  const removeRow = trpc.databases.removeRow.useMutation({ onSuccess: invalidate });
  const removeTable = trpc.databases.remove.useMutation({ onSuccess: () => { utils.databases.list.invalidate(); onDeleted(); } });
  const updateTable = trpc.databases.update.useMutation({ onSuccess: () => { utils.databases.list.invalidate(); setEditStructure(false); } });
  const [draftFields, setDraftFields] = useState<DataField[]>(table.fields);
  const [showImport, setShowImport] = useState(false);
  const canWrite = table.access.canWriteRows;

  // 新列草稿
  const emptyDraft = (): DataRowData => Object.fromEntries(table.fields.map((f) => [f.key, f.type === "checkbox" ? false : ""])) as DataRowData;
  const [draft, setDraft] = useState<DataRowData>(emptyDraft);

  const mutationError = addRow.error?.message ?? updateRow.error?.message ?? removeRow.error?.message ?? updateTable.error?.message;

  return (
    <section className="card" data-fb="資料庫詳頁卡">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>{table.name}</h2>
        <span className="badge">{SCOPE_LABEL[table.scope]}</span>
        {!table.memberWritable && <span className="badge" title="只有管理者能寫入"><Icon name="Lock" size={12} /> 唯讀共享</span>}
        {table.agentAccess !== "write" && (
          <span className="badge" title={AGENT_ACCESS_OPTIONS.find((o) => o.value === table.agentAccess)?.hint}>
            <Icon name="Lock" size={12} /> {table.agentAccess === "none" ? "不開放 AI" : "AI 唯讀"}
          </span>
        )}
        <span className="spacer" />
        {table.access.canManage && (
          <>
            <button className="btn-sm" onClick={() => { setDraftFields(table.fields); setEditStructure((v) => !v); }}>
              <Icon name="Ellipsis" size={13} /> {editStructure ? "收起結構" : "調整欄位"}
            </button>
            <ConfirmButton
              onConfirm={() => removeTable.mutate({ id: table.id })}
              message={`確定要刪除資料庫「${table.name}」？（列資料會一併看不到；有需要可請工程師從資料庫還原）`}
              triggerClassName="btn-sm"
            >
              <Icon name="X" size={13} /> 刪除
            </ConfirmButton>
          </>
        )}
      </div>
      {table.description && <p className="hint" style={{ marginTop: 4 }}>{table.description}</p>}

      {editStructure && table.access.canManage && (
        <div style={{ margin: "12px 0", padding: 12, border: "1px dashed var(--border, #ccc)", borderRadius: 8 }}>
          <FieldsEditor fields={draftFields} onChange={setDraftFields} />
          <p className="hint" style={{ marginTop: 8 }}>移除欄位不會刪掉既有列裡的值，只是不再顯示；新增欄位對舊列顯示為空。</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="primary btn-sm" disabled={updateTable.isPending} onClick={() => updateTable.mutate({ id: table.id, fields: draftFields.map((f) => ({ ...f, label: f.label.trim() })) })}>
              {updateTable.isPending ? "儲存中…" : "儲存欄位"}
            </button>
            {table.scope !== "personal" && (
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={table.memberWritable} onChange={(e) => updateTable.mutate({ id: table.id, memberWritable: e.target.checked })} style={{ width: "auto" }} />
                成員可寫入
              </label>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              AI 存取
              <select
                aria-label="AI 存取等級"
                style={{ width: "auto" }}
                value={table.agentAccess}
                onChange={(e) => updateTable.mutate({ id: table.id, agentAccess: e.target.value as TableSummary["agentAccess"] })}
              >
                {AGENT_ACCESS_OPTIONS.map((o) => <option key={o.value} value={o.value} title={o.hint}>{o.label}</option>)}
              </select>
            </label>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <input aria-label="搜尋資料" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋…" style={{ maxWidth: 220 }} />
        <span className="meta">{rows.data ? `${rows.data.total.toLocaleString()} 列` : "…"}</span>
        <span className="spacer" />
        {/* 匯出 CSV（接 Excel／其他資料庫）；同源 a 標籤帶 cookie 認證 */}
        <a className="btn-sm" href={`/api/databases/${table.id}/rows.csv`} download title="匯出成 CSV（可用 Excel/其他資料庫開啟）">
          <Icon name="Download" size={13} /> 匯出 CSV
        </a>
        {canWrite && (
          <button className="btn-sm" onClick={() => setShowImport((v) => !v)} title="從 CSV 匯入資料列（Excel/Google 試算表/其他資料庫的匯出檔）">
            <Icon name="Plus" size={13} /> 匯入 CSV
          </button>
        )}
      </div>
      {showImport && canWrite && <CsvImportPanel table={table} onImported={invalidate} />}

      <div style={{ overflowX: "auto", marginTop: 8 }}>
        <table className="data-grid" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {table.fields.map((f) => (
                <th key={f.key} style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border, #ddd)", whiteSpace: "nowrap" }}>
                  {f.label}{f.required && <span title="必填" style={{ color: "var(--danger-ink, #a33)" }}> *</span>}
                </th>
              ))}
              <th style={{ width: 40, borderBottom: "1px solid var(--border, #ddd)" }} />
            </tr>
          </thead>
          <tbody>
            {table.access.canWriteRows && (
              <tr>
                {table.fields.map((f) => (
                  <td key={f.key} style={{ padding: "4px 4px" }}>
                    <CellInput field={f} groupId={groupId} value={draft[f.key] ?? null} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
                  </td>
                ))}
                <td style={{ padding: "4px 4px" }}>
                  <button
                    className="btn-sm primary"
                    title="新增這一列"
                    disabled={addRow.isPending}
                    onClick={() => addRow.mutate({ tableId: table.id, data: draft }, { onSuccess: () => setDraft(emptyDraft()) })}
                  >
                    <Icon name="Plus" size={13} />
                  </button>
                </td>
              </tr>
            )}
            {(rows.data?.rows ?? []).map((r) => (
              <GridRow
                key={r.id}
                fields={table.fields}
                groupId={groupId}
                row={{ id: r.id, data: r.data as DataRowData }}
                canWrite={table.access.canWriteRows}
                canDelete={table.access.canManage || table.access.canWriteRows}
                onSave={(data) => updateRow.mutate({ id: r.id, data })}
                onDelete={() => removeRow.mutate({ id: r.id })}
              />
            ))}
          </tbody>
        </table>
        {rows.data && rows.data.rows.length === 0 && <p className="hint" style={{ marginTop: 8 }}>{q ? "沒有符合的資料" : "還沒有資料——從上面那一列開始加"}</p>}
      </div>
      {mutationError && <p className="error" role="alert">{mutationError}</p>}

      <FilesSection table={table} />
      <ConnectPanel table={table} />
    </section>
  );
}

/* ────────────────────────── CSV 匯入 ────────────────────────── */

function CsvImportPanel({ table, onImported }: { table: TableSummary; onImported: () => void }) {
  const [csv, setCsv] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({}); // 欄位 key → CSV 表頭
  const [result, setResult] = useState<{ imported: number; failed: number; skipped: number; truncated: boolean; errors: Array<{ line: number; error: string }> } | null>(null);
  const importCsv = trpc.databases.importCsv.useMutation({
    // 匯入後刷新格線，但「不自動關閉面板」——讓使用者看到「成功幾列、失敗哪幾行」的結果再自行收合
    onSuccess: (r) => { setResult(r); if (r.imported > 0) onImported(); },
  });
  // 解析第一行當表頭候選（純前端粗解析，正式解析在後端）
  const firstLine = csv.split(/\r?\n/)[0] ?? "";
  const headers = firstLine ? firstLine.split(",").map((h) => h.replace(/^"|"$/g, "").trim()).filter(Boolean) : [];
  const autoMap = () => {
    const m: Record<string, string> = {};
    for (const f of table.fields) {
      const hit = headers.find((h) => h === f.label || h === f.key);
      if (hit) m[f.key] = hit;
    }
    setMapping(m);
  };
  const headerMap = Object.fromEntries(Object.entries(mapping).filter(([, h]) => h).map(([key, h]) => [h, key]));

  return (
    <div style={{ margin: "8px 0", padding: 12, border: "1px dashed var(--border, #ccc)", borderRadius: 8 }}>
      <p className="hint" style={{ marginTop: 0 }}>
        貼上 CSV（第一行為表頭）——Excel／Google 試算表／其他資料庫都能匯出 CSV。貼好後按「自動對應」，確認欄位對照再匯入。
      </p>
      <textarea
        aria-label="CSV 內容"
        value={csv}
        onChange={(e) => { setCsv(e.target.value); setResult(null); }}
        placeholder={"姓名,年齡\n小美,28\n阿哲,30"}
        rows={5}
        style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <button className="btn-sm" disabled={headers.length === 0} onClick={autoMap}>自動對應欄位</button>
        <span className="meta">{headers.length > 0 ? `偵測到表頭：${headers.join("、")}` : "貼上 CSV 後可自動對應"}</span>
      </div>
      {headers.length > 0 && (
        <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
          {table.fields.map((f) => (
            <label key={f.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span style={{ minWidth: 100 }}>{f.label}{f.required && " *"}</span>
              <span className="meta">←</span>
              <select value={mapping[f.key] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))} style={{ width: "auto" }}>
                <option value="">（不匯入此欄）</option>
                {headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button
          className="primary btn-sm"
          disabled={!csv.trim() || Object.keys(headerMap).length === 0 || importCsv.isPending}
          onClick={() => importCsv.mutate({ tableId: table.id, csv, headerMap })}
        >
          {importCsv.isPending ? "匯入中…" : "開始匯入"}
        </button>
      </div>
      {importCsv.error && <p className="error" role="alert">{importCsv.error.message}</p>}
      {result && (
        <div style={{ marginTop: 8 }}>
          <p className="hint" style={{ color: result.imported > 0 ? "var(--success-ink)" : undefined }}>
            匯入完成：成功 {result.imported} 列{result.failed > 0 ? `、失敗 ${result.failed} 列` : ""}
            {result.truncated ? `（超過 5000 列上限，另有 ${result.skipped} 列未處理——請分批匯入）` : ""}
          </p>
          {result.errors.length > 0 && (
            <ul style={{ margin: "4px 0", paddingLeft: 18, fontSize: 12, color: "var(--danger-ink, #a33)" }}>
              {result.errors.slice(0, 10).map((e) => <li key={e.line}>第 {e.line} 行：{e.error}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────── 外部連接（本機/手機/其他系統） ────────────────────────── */

/**
 * 連接面板：把這個資料庫接到本機腳本、手機 App、行事曆、其他資料庫。
 * REST/行事曆需要「個人連線金鑰」（在「怎麼用」頁建立），面板只給網址範本＋去建立金鑰的入口。
 */
function ConnectPanel({ table }: { table: TableSummary }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const hasDate = (table.fields as DataField[]).some((f) => f.type === "date");
  const restUrl = `${origin}/api/v1/databases/${table.id}/rows`;
  const csvUrl = `${origin}/api/databases/${table.id}/rows.csv`;
  const icsUrl = `${origin}/api/databases/${table.id}/calendar.ics?key=你的金鑰`;

  return (
    <details className="card card--quiet" style={{ marginTop: 16 }} data-fb="資料庫連接面板">
      <summary>
        <Icon name="Info" size={14} /> 連接本機／手機／其他系統
        <Icon name="ChevronDown" size={14} style={{ marginLeft: "auto" }} />
      </summary>
      <div style={{ marginTop: 10, display: "grid", gap: 12, fontSize: 13 }}>
        <p className="hint" style={{ margin: 0 }}>
          用你的<Link href="/help">個人連線金鑰</Link>（在「怎麼用」頁建立，可隨時撤銷）就能從外部連這個資料庫，權限跟你在網頁上一樣。
        </p>
        <div>
          <p style={{ margin: "0 0 4px", fontWeight: 600 }}>REST API（本機腳本／手機 App／其他資料庫 ETL）</p>
          <pre style={{ background: "var(--bg-sunken, rgba(0,0,0,.05))", padding: 8, borderRadius: 6, overflow: "auto", margin: 0, fontSize: 12 }}>
{`# 查詢資料列
curl -H "x-api-key: 你的金鑰" \\
  ${restUrl}

# 新增一列
curl -X POST -H "x-api-key: 你的金鑰" \\
  -H "Content-Type: application/json" \\
  -d '{"data":{"欄位key":"值"}}' \\
  ${restUrl}`}
          </pre>
        </div>
        <div>
          <p style={{ margin: "0 0 4px", fontWeight: 600 }}>CSV（Excel／Google 試算表／其他資料庫）</p>
          <p className="meta" style={{ margin: 0 }}>匯出：<code style={{ wordBreak: "break-all" }}>{csvUrl}</code>（上方「匯出 CSV」鈕直接下載）；匯入用上方「匯入 CSV」。</p>
        </div>
        <div>
          <p style={{ margin: "0 0 4px", fontWeight: 600 }}>行事曆訂閱（手機／桌面日曆）</p>
          {hasDate ? (
            <p className="meta" style={{ margin: 0 }}>把這個網址加進手機日曆的「訂閱行事曆」：<code style={{ wordBreak: "break-all" }}>{icsUrl}</code>（每個有日期欄位的列變成一個事件）</p>
          ) : (
            <p className="meta" style={{ margin: 0 }}>這個資料庫還沒有「日期」型別欄位——加一個就能訂閱成行事曆。</p>
          )}
        </div>
      </div>
    </details>
  );
}

/* ────────────────────────── 文件（AI 可讀檔案） ────────────────────────── */

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/**
 * 文件區：檔案上傳（txt/md/csv/json/html/字幕/PDF/DOCX…）＋網址匯入（Google 公開連結、Notion）。
 * 伺服器抽純文字後 AI 才讀得到——可讀字數顯示在每份文件旁；配額每人預設 5GB（管理員可調）。
 */
function FilesSection({ table }: { table: TableSummary }) {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const list = trpc.databases.listFiles.useQuery({ tableId: table.id });
  const importUrl = trpc.databases.importUrl.useMutation({ onSuccess: () => { utils.databases.listFiles.invalidate({ tableId: table.id }); setUrl(""); setUrlName(""); } });
  const refresh = trpc.databases.refreshFile.useMutation({
    onSuccess: (_r, vars) => {
      utils.databases.listFiles.invalidate({ tableId: table.id });
      // 開著的全文預覽也要跟上重抓後的內容，否則顯示過期文字
      utils.databases.getFileText.invalidate({ id: vars.id });
    },
  });
  const removeFile = trpc.databases.removeFile.useMutation({ onSuccess: () => utils.databases.listFiles.invalidate({ tableId: table.id }) });

  const [url, setUrl] = useState("");
  const [urlName, setUrlName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = trpc.databases.getFileText.useQuery({ id: previewId ?? "" }, { enabled: !!previewId });

  const doUpload = async (f: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", f);
      form.append("tableId", table.id);
      const res = await fetch("/api/databases/upload", { method: "POST", body: form, credentials: "same-origin" });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) setUploadError(body.error ?? "上傳失敗，請稍後再試");
      else utils.databases.listFiles.invalidate({ tableId: table.id });
    } catch {
      setUploadError("上傳失敗（網路問題），請稍後再試");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const quota = list.data?.quota;
  const files = list.data?.files ?? [];
  const canWrite = table.access.canWriteRows;
  const myId = me.data?.user.id;

  return (
    <div style={{ marginTop: 20, paddingTop: 12, borderTop: "1px solid var(--border-soft, #eee)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>文件（AI 可讀）</h3>
        {quota && (
          <span className="meta" title="所有資料庫合計、按上傳者計；管理員可在「團隊管理→點數與額度」調整">
            我的空間：{formatBytes(quota.usedBytes)}{quota.quotaBytes != null ? ` / ${formatBytes(quota.quotaBytes)}` : "（不限）"}
          </span>
        )}
      </div>
      <p className="hint" style={{ marginTop: 4 }}>
        文字/Markdown/CSV/JSON/HTML/字幕/PDF/Word 上傳後自動抽成純文字——團隊 AI 助手與 MCP 代理都讀得到
        （受上方「AI 存取」等級管控）。Google 文件請用「任何人知道連結都能檢視」的連結；Notion 需管理員設 NOTION_TOKEN，或用 Notion 匯出檔上傳。
      </p>

      {canWrite && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          <input
            ref={fileInput}
            type="file"
            aria-label="上傳文件"
            accept=".txt,.md,.csv,.json,.html,.htm,.srt,.vtt,.pdf,.docx,.zip,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mov,.mp3,.wav,.m4a,.ogg"
            style={{ width: "auto" }}
            disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void doUpload(f); }}
          />
          {uploading && <span className="meta">上傳並抽取文字中…</span>}
        </div>
      )}
      {canWrite && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          <input
            aria-label="匯入網址"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="貼 Google 文件/試算表/雲端硬碟公開連結、Notion 頁面或網頁網址"
            style={{ flex: "1 1 320px" }}
          />
          <input aria-label="匯入文件名稱" value={urlName} onChange={(e) => setUrlName(e.target.value)} placeholder="名稱（選填）" style={{ flex: "0 1 140px" }} maxLength={120} />
          <button
            className="btn-sm primary"
            disabled={!url.trim() || importUrl.isPending}
            onClick={() => importUrl.mutate({ tableId: table.id, url: url.trim(), name: urlName.trim() || undefined })}
          >
            {importUrl.isPending ? "匯入中…" : "從網址匯入"}
          </button>
        </div>
      )}
      {(uploadError || importUrl.error || refresh.error || removeFile.error) && (
        <p className="error" role="alert">{uploadError ?? importUrl.error?.message ?? refresh.error?.message ?? removeFile.error?.message}</p>
      )}

      {files.length === 0 && list.data && <p className="hint" style={{ marginTop: 8 }}>還沒有文件——上傳逐字稿、腳本、名單，AI 就能引用它們回答。</p>}
      {files.map((f) => (
        <div key={f.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "6px 0", borderBottom: "1px solid var(--border-soft, #eee)" }}>
          <Icon name="FileText" size={15} />
          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }} title={f.name}>{f.name}</span>
          <span className="meta">{formatBytes(f.sizeBytes)}・{f.uploaderName}</span>
          {f.readableChars > 0 ? (
            <button className="badge" style={{ cursor: "pointer" }} title="點開預覽 AI 讀到的純文字" onClick={() => setPreviewId(previewId === f.id ? null : f.id)}>
              AI 可讀 {f.readableChars.toLocaleString()} 字
            </button>
          ) : (
            <span className="badge" title="此格式暫不支援文字抽取（僅存檔）">僅存檔</span>
          )}
          <span className="spacer" />
          {f.hasFile && <a className="btn-sm" href={`/api/databases/files/${f.id}/file`} download title="下載原檔"><Icon name="Download" size={13} /></a>}
          {canWrite && f.sourceUrl && (
            <button className="btn-sm" title="重抓來源網址、更新內容" disabled={refresh.isPending} onClick={() => refresh.mutate({ id: f.id })}>
              <Icon name="Undo2" size={13} />
            </button>
          )}
          {(table.access.canManage || f.uploadedBy === myId) && (
            <ConfirmButton onConfirm={() => removeFile.mutate({ id: f.id })} message={`刪除文件「${f.name}」？（原檔與 AI 可讀文字都會刪除、空間即時釋放）`} triggerClassName="btn-sm" triggerAriaLabel={`刪除文件 ${f.name}`}>
              <Icon name="X" size={13} />
            </ConfirmButton>
          )}
          {previewId === f.id && (
            <div style={{ flexBasis: "100%", background: "var(--bg-sunken, rgba(0,0,0,.04))", borderRadius: 8, padding: 10, maxHeight: 240, overflowY: "auto" }}>
              {preview.data ? (
                <>
                  <p className="meta" style={{ margin: "0 0 6px" }}>AI 讀到的純文字（前 20,000 字／共 {preview.data.totalChars.toLocaleString()} 字）：</p>
                  <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontSize: 13 }}>{preview.data.text}</pre>
                </>
              ) : preview.error ? (
                <p className="error" role="alert" style={{ margin: 0 }}>預覽載入失敗：{preview.error.message}</p>
              ) : (
                <p className="meta" style={{ margin: 0 }}>載入中…</p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** 一列（點值進入行內編輯；blur/Enter 儲存整列） */
function GridRow({
  fields, groupId, row, canWrite, canDelete, onSave, onDelete,
}: {
  fields: DataField[];
  groupId: string;
  row: { id: string; data: DataRowData };
  canWrite: boolean;
  canDelete: boolean;
  onSave: (data: DataRowData) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DataRowData>(row.data);
  if (editing && canWrite) {
    return (
      <tr>
        {fields.map((f) => (
          <td key={f.key} style={{ padding: "4px 4px" }}>
            <CellInput field={f} groupId={groupId} value={draft[f.key] ?? null} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
          </td>
        ))}
        <td style={{ padding: "4px 4px", whiteSpace: "nowrap" }}>
          <button className="btn-sm primary" title="儲存" onClick={() => { onSave(draft); setEditing(false); }}><Icon name="Check" size={13} /></button>
          <button className="btn-sm" title="取消" onClick={() => { setDraft(row.data); setEditing(false); }}><Icon name="X" size={13} /></button>
        </td>
      </tr>
    );
  }
  return (
    <tr
      onDoubleClick={() => canWrite && setEditing(true)}
      title={canWrite ? "雙擊編輯" : undefined}
      style={{ cursor: canWrite ? "pointer" : "default" }}
    >
      {fields.map((f) => (
        <td key={f.key} style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-soft, #eee)" }}>
          <CellDisplay field={f} groupId={groupId} value={row.data[f.key] ?? null} />
        </td>
      ))}
      <td style={{ padding: "4px 4px", whiteSpace: "nowrap" }}>
        {canWrite && <button className="btn-sm" title="編輯" onClick={() => setEditing(true)}><Icon name="Ellipsis" size={13} /></button>}
        {canDelete && (
          <ConfirmButton onConfirm={onDelete} message="刪除這一列？" triggerClassName="btn-sm" triggerAriaLabel="刪除這一列">
            <Icon name="X" size={13} />
          </ConfirmButton>
        )}
      </td>
    </tr>
  );
}

function CellDisplay({ field, groupId, value }: { field: DataField; groupId: string; value: DataRowValue }) {
  if (value === null || value === "") return <span className="meta">—</span>;
  if (field.type === "checkbox") return value ? <Icon name="Check" size={14} /> : <span className="meta">—</span>;
  if (field.type === "url") {
    const raw = String(value);
    // 只把 http(s):／mailto: 當成可點連結——資料庫可為組/團隊/全站範圍，別人能在某格塞
    // javascript:／data: 供其他成員點擊觸發（連結注入）。非白名單協定一律純文字顯示。
    const safe = /^(https?:|mailto:)/i.test(raw.trim());
    return safe
      ? <a href={raw} target="_blank" rel="noreferrer" style={{ wordBreak: "break-all" }}>{raw.slice(0, 60)}</a>
      : <span style={{ wordBreak: "break-all" }}>{raw.slice(0, 60)}</span>;
  }
  if (field.type === "user") return <UserName id={String(value)} />;
  if (field.type === "project") return <ProjectLink id={String(value)} groupId={groupId} />;
  if (field.type === "schedule") return <ScheduleLink id={String(value)} groupId={groupId} />;
  return <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{String(value)}</span>;
}

/** 專案連結欄：解析標題並直通專案頁（作用組撈不到＝別組或已刪，退回縮短 id） */
function ProjectLink({ id, groupId }: { id: string; groupId: string }) {
  const projects = trpc.projects.list.useQuery({ groupId: groupId || undefined }, { enabled: !!groupId });
  const title = projects.data?.find((p) => p.id === id)?.title;
  if (!title) return <span className="mono" title={id}>{id.slice(0, 8)}…</span>;
  return <Link href={`/p/${id}`} title="開啟專案">{title}</Link>;
}

/** 排程連結欄：解析標題並直通筆記排程頁 */
function ScheduleLink({ id, groupId }: { id: string; groupId: string }) {
  const list = trpc.schedule.list.useQuery({ groupId, includePast: true }, { enabled: !!groupId });
  const item = (list.data ?? []).find((s: { id: string }) => s.id === id) as { title?: string } | undefined;
  if (!item?.title) return <span className="mono" title={id}>{id.slice(0, 8)}…</span>;
  return <Link href="/planner" title="開啟筆記排程">{item.title}</Link>;
}

/** user 欄位顯示名字：成員清單可能跨組，前端只有本組成員表——查不到就顯示縮短 id */
function UserName({ id }: { id: string }) {
  const me = trpc.auth.me.useQuery();
  if (me.data?.user.id === id) return <>{me.data.user.name}</>;
  return <span className="mono" title={id}>{id.slice(0, 8)}…</span>;
}

function CellInput({ field, groupId, value, onChange }: { field: DataField; groupId: string; value: DataRowValue; onChange: (v: DataRowValue) => void }) {
  const common = { "aria-label": field.label, style: { width: "100%", minWidth: 90 } as const };
  switch (field.type) {
    case "project":
      return <ProjectPicker label={field.label} groupId={groupId} value={typeof value === "string" ? value : ""} onChange={onChange} />;
    case "schedule":
      return <SchedulePicker label={field.label} groupId={groupId} value={typeof value === "string" ? value : ""} onChange={onChange} />;
    case "checkbox":
      return <input type="checkbox" aria-label={field.label} checked={value === true} onChange={(e) => onChange(e.target.checked)} style={{ width: "auto" }} />;
    case "number":
      return <input type="number" {...common} value={value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
    case "date":
      return <input type="date" {...common} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || null)} />;
    case "select":
      return (
        <select {...common} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case "user":
      return <UserPicker label={field.label} value={typeof value === "string" ? value : ""} onChange={onChange} />;
    default: // text / url
      return <input {...common} value={typeof value === "string" ? value : ""} placeholder={field.type === "url" ? "https://…" : undefined} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** 專案挑選：作用組的專案清單（值存專案 id；既有值不在清單時仍保留顯示） */
function ProjectPicker({ label, groupId, value, onChange }: { label: string; groupId: string; value: string; onChange: (v: DataRowValue) => void }) {
  const projects = trpc.projects.list.useQuery({ groupId: groupId || undefined }, { enabled: !!groupId });
  const opts = projects.data ?? [];
  return (
    <select aria-label={label} style={{ width: "100%", minWidth: 90 }} value={value} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">—</option>
      {value && !opts.some((p) => p.id === value) && <option value={value}>（別組或已刪的專案）</option>}
      {opts.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
    </select>
  );
}

/** 排程挑選：作用組的排程清單（含過去；值存排程 id） */
function SchedulePicker({ label, groupId, value, onChange }: { label: string; groupId: string; value: string; onChange: (v: DataRowValue) => void }) {
  const list = trpc.schedule.list.useQuery({ groupId, includePast: true }, { enabled: !!groupId });
  const opts = (list.data ?? []) as Array<{ id: string; title: string; startsAt: string | Date }>;
  return (
    <select aria-label={label} style={{ width: "100%", minWidth: 90 }} value={value} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">—</option>
      {value && !opts.some((s) => s.id === value) && <option value={value}>（別組或已刪的排程）</option>}
      {opts.map((s) => <option key={s.id} value={s.id}>{new Date(s.startsAt).toLocaleDateString("zh-TW")}・{s.title}</option>)}
    </select>
  );
}

/** 成員挑選：下拉列出「我所有組」的成員聯集（跨範圍夠用；查無成員時退回自由填 id 的輸入框） */
function UserPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: DataRowValue) => void }) {
  const me = trpc.auth.me.useQuery();
  const groups = me.data?.groups ?? [];
  // 逐組抓成員太重；v1 用第一個組的成員清單＋自己（多數表是組內用）。之後有需求再擴。
  const firstGroup = groups[0]?.groupId ?? "";
  const members = trpc.projects.groupMembers.useQuery({ groupId: firstGroup }, { enabled: !!firstGroup });
  const opts = members.data ?? [];
  const myUser = me.data?.user;
  return (
    <select aria-label={label} style={{ width: "100%", minWidth: 90 }} value={value} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">—</option>
      {myUser && !opts.some((m) => m.userId === myUser.id) && <option value={myUser.id}>{myUser.name}（我）</option>}
      {opts.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
    </select>
  );
}
