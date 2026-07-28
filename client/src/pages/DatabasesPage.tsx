import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon, type IconName } from "../components/Icon";
import { ConfirmButton } from "../components/interactions";
import {
  type DatabaseDetailTab,
} from "../components/databaseTabs";
import { DatabaseDetailTabs } from "../components/DatabaseDetailTabs";
import {
  clearDatabaseImportAttempt,
  databaseImportPayloadSignature,
  getDatabaseImportAttempt,
} from "../components/databaseImportIdempotency";
import { FIELD_TYPES, FILE_CATEGORY_SUGGESTIONS, MAX_FILE_CATEGORY, newFieldKey, type DataField, type DataRowData, type DataRowValue } from "@shared/databaseFields";
import { detectFormat, inferFields, parseTabular, TABULAR_ACCEPT, TABULAR_FORMATS, type TabularFormat } from "@shared/tabular";

/** 匯入結果外形（importData mutation 回傳；建庫與詳頁匯入共用顯示） */
type ImportResult = {
  imported: number;
  failed: number;
  skipped: number;
  truncated: boolean;
  errors: Array<{ line: number; error: string }>;
  replayed: boolean;
};

/** 文件上傳的 accept 清單（與伺服器白名單 storage.MIME_EXT 同口徑；伺服器仍是最終把關） */
const DB_FILE_ACCEPT = [
  ".txt", ".md", ".csv", ".tsv", ".json", ".html", ".htm", ".srt", ".vtt",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".rtf", ".epub",
  ".zip", ".7z", ".rar", ".gz", ".tar",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".heif", ".avif", ".bmp", ".tif", ".tiff", ".svg",
  ".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi", ".3gp", ".mpg", ".mpeg",
  ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".amr",
].join(",");

/** 去抖：大量貼上/逐字輸入時，避免每次按鍵都同步全量 parseTabular 凍結 UI（改為停手 250ms 才解析一次） */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** 客端粗解析 headers＋列數（JSON 格式錯回 error 人話）；正式解析仍在後端。
 *  內容經去抖：大檔貼上或逐字輸入時不會每次按鍵都同步解析（見 useDebounced）。 */
function usePreview(content: string, format: TabularFormat) {
  const debounced = useDebounced(content, 250);
  return useMemo(() => {
    if (!debounced.trim()) return { headers: [] as string[], count: 0, error: null as string | null };
    try {
      const p = parseTabular(debounced, format);
      return { headers: p.headers, count: p.records.length, error: null as string | null };
    } catch (e) {
      return { headers: [] as string[], count: 0, error: e instanceof Error ? e.message : "解析失敗" };
    }
  }, [debounced, format]);
}

/** 匯入結果摘要（成功/失敗/截斷＋前幾筆錯誤） */
function ImportResultView({ result }: { result: ImportResult }) {
  return (
    <div style={{ marginTop: 8 }}>
      <p className="hint" style={{ color: result.imported > 0 ? "var(--success-ink)" : undefined }}>
        匯入完成：成功 {result.imported} 列{result.failed > 0 ? `、失敗 ${result.failed} 列` : ""}
        {result.truncated ? `（超過 5000 列上限，另有 ${result.skipped} 列未處理——請分批匯入）` : ""}
        {result.replayed ? "（連線重試已安全回放，未重複寫入）" : ""}
      </p>
      {result.errors.length > 0 && (
        <ul style={{ margin: "4px 0", paddingLeft: 18, fontSize: 12, color: "var(--danger-ink, #a33)" }}>
          {result.errors.slice(0, 10).map((e) => <li key={e.line}>第 {e.line} 筆：{e.error}</li>)}
        </ul>
      )}
    </div>
  );
}

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

  // 深連結（知識地圖節點等來源）：/databases?open=<id> 進頁即選定該庫。
  // 只在掛載時讀一次——之後的選擇交回使用者操作；id 無效（無權/不存在）時 find 不到，安靜落回清單。
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("open");
    if (id) setSelectedId(id);
  }, []);

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
        團隊 AI 助手答題時看得到；外部 AI 助手（MCP）也能查詢與寫入——權限跟你在網頁上一樣。
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

  // 從檔案匯入建立：套用推斷欄位後把「內容＋格式＋表頭對應」暫存，建庫成功後一併把列資料匯入
  const [importSeed, setImportSeed] = useState<{ content: string; format: TabularFormat; headerMap: Record<string, string> } | null>(null);
  const [finished, setFinished] = useState<{ id: string; result: ImportResult | null } | null>(null);
  const createdImportAttempt = useRef<{ signature: string; key: string } | null>(null);
  const importData = trpc.databases.importData.useMutation();

  const importIntoCreatedTable = async (tableId: string): Promise<void> => {
    if (!importSeed || Object.keys(importSeed.headerMap).length === 0) return;
    const payload = { tableId, ...importSeed };
    const signature = databaseImportPayloadSignature(payload);
    if (!createdImportAttempt.current || createdImportAttempt.current.signature !== signature) {
      createdImportAttempt.current = getDatabaseImportAttempt(payload);
    }
    try {
      const attemptKey = createdImportAttempt.current.key;
      const r = await importData.mutateAsync({
        ...payload,
        idempotencyKey: attemptKey,
      });
      clearDatabaseImportAttempt(tableId, attemptKey);
      createdImportAttempt.current = null;
      setFinished({ id: tableId, result: r });
    } catch {
      // Keep the same key so a response-loss retry can only replay, never
      // append the imported rows a second time.
      setFinished({ id: tableId, result: null });
    }
  };

  const create = trpc.databases.create.useMutation({
    onSuccess: async (row) => {
      utils.databases.list.invalidate();
      // 有匯入種子＝從檔案建表：建好後把列資料灌進去，再顯示結果摘要（含失敗列）讓使用者過目
      if (importSeed && Object.keys(importSeed.headerMap).length > 0) {
        await importIntoCreatedTable(row.id);
      } else {
        onDone(row.id);
      }
    },
  });
  const canSubmit = name.trim().length > 0 && fields.length > 0 && fields.every((f) => f.label.trim()) && !create.isPending && !importData.isPending;

  // 建庫＋匯入完成：顯示摘要，讓使用者確認匯入結果後再進入資料庫
  if (finished) {
    return (
      <section className="card" data-fb="建立資料庫完成卡">
        <h2><Icon name="CheckCircle2" size={18} /> 資料庫「{name.trim()}」已建立</h2>
        {finished.result ? (
          <ImportResultView result={finished.result} />
        ) : importSeed ? (
          <>
            <p className="hint" style={{ color: "var(--danger-ink, #a33)" }}>
              欄位已建好，但尚未收到匯入結果。可用相同安全重試鍵再確認一次，不會重複新增資料。
            </p>
            <button
              className="btn-sm"
              disabled={importData.isPending}
              onClick={() => void importIntoCreatedTable(finished.id)}
            >
              {importData.isPending ? "重新確認中…" : "安全重試匯入"}
            </button>
          </>
        ) : null}
        <div style={{ marginTop: 12 }}>
          <button className="primary" onClick={() => onDone(finished.id)}>開啟資料庫</button>
        </div>
      </section>
    );
  }

  return (
    <section className="card" data-fb="建立資料庫卡">
      <h2>建立資料庫</h2>
      <ImportToCreate
        onApply={({ fields: inferred, name: suggested, seed }) => {
          setFields(inferred);
          if (suggested && !name.trim()) setName(suggested);
          setImportSeed(seed);
        }}
      />
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
          {importData.isPending ? "匯入資料中…" : create.isPending ? "建立中…" : importSeed ? "建立並匯入" : "建立"}
        </button>
        <button onClick={onCancel}>取消</button>
      </div>
      {importSeed && <p className="hint" style={{ marginTop: 6 }}>已備妥 {Object.keys(importSeed.headerMap).length} 欄的匯入資料——按「建立並匯入」會一併把列資料灌進新資料庫。</p>}
      {(create.error || importData.error) && <p className="error" role="alert">{create.error?.message ?? importData.error?.message}</p>}
    </section>
  );
}

/**
 * 從檔案匯入建立：上傳／貼上 CSV／TSV／JSON，自動判讀格式與表頭，一鍵推斷成欄位。
 * 只推斷「文字」欄位（先求能成表，型別建庫後再調）；套用後把內容交回上層，建庫時一併匯入列資料。
 */
function ImportToCreate({ onApply }: { onApply: (args: { fields: DataField[]; name: string | null; seed: { content: string; format: TabularFormat; headerMap: Record<string, string> } }) => void }) {
  const [content, setContent] = useState("");
  const [format, setFormat] = useState<TabularFormat>("csv");
  const [formatTouched, setFormatTouched] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { headers, count, error } = usePreview(content, format);

  const setBoth = (text: string, fmt?: TabularFormat) => {
    setContent(text);
    setApplied(false);
    if (fmt) { setFormat(fmt); setFormatTouched(true); }
    else if (!formatTouched) setFormat(detectFormat(fileName, text));
  };
  const onFile = async (f: File) => {
    const text = await f.text();
    setFileName(f.name);
    setFormatTouched(true);
    setContent(text);
    setFormat(detectFormat(f.name, text));
    setApplied(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const apply = () => {
    const inferred = inferFields(headers);
    const headerMap: Record<string, string> = {};
    headers.slice(0, inferred.length).forEach((h, i) => { headerMap[h] = inferred[i].key; });
    const suggested = fileName ? fileName.replace(/\.[^.]+$/, "").slice(0, 80) : null;
    onApply({ fields: inferred, name: suggested, seed: { content, format, headerMap } });
    setApplied(true);
  };

  return (
    <details className="card card--quiet" style={{ margin: "4px 0 12px" }} data-fb="從檔案建立資料庫">
      <summary>
        <Icon name="Package" size={14} /> 從檔案匯入建立（CSV／TSV／JSON，自動判讀欄位）
        <Icon name="ChevronDown" size={14} style={{ marginLeft: "auto" }} />
      </summary>
      <div style={{ marginTop: 10 }}>
        <p className="hint" style={{ marginTop: 0 }}>
          已經有資料？上傳或貼上 CSV／TSV／JSON，自動判讀出欄位——按「套用為欄位」後再按下方「建立並匯入」，一步成表並灌入列資料。
          圖片／影片／PDF 等檔案不走這裡：建立後到資料庫的「文件與圖影」區上傳（支援拖放、多檔），或加「附件」欄位逐列掛檔。
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
          <input ref={fileInput} type="file" aria-label="選擇匯入檔" accept={TABULAR_ACCEPT} style={{ width: "auto" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
            格式
            <select aria-label="匯入格式" value={format} style={{ width: "auto" }} onChange={(e) => { setFormat(e.target.value as TabularFormat); setFormatTouched(true); setApplied(false); }}>
              {TABULAR_FORMATS.map((f) => <option key={f.id} value={f.id} title={f.hint}>{f.label}</option>)}
            </select>
          </label>
        </div>
        <textarea
          aria-label="匯入內容"
          value={content}
          onChange={(e) => setBoth(e.target.value)}
          placeholder={format === "json" ? '[{"姓名":"小美","年齡":28}]' : format === "tsv" ? "姓名\t年齡\n小美\t28" : "姓名,年齡\n小美,28"}
          rows={4}
          style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
        />
        <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn-sm primary" disabled={headers.length === 0} onClick={apply}>套用為欄位（{headers.length} 欄）</button>
          {error ? (
            <span className="meta" style={{ color: "var(--danger-ink, #a33)" }}>{error}</span>
          ) : applied ? (
            <span className="meta" style={{ color: "var(--success-ink)" }}>已套用 {headers.length} 欄、備妥 {count} 列——確認下方欄位與型別後建立</span>
          ) : (
            <span className="meta">{headers.length > 0 ? `偵測到 ${headers.length} 欄、${count} 列` : "上傳或貼上資料後可自動判讀"}</span>
          )}
        </div>
      </div>
    </details>
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
  const [detailTab, setDetailTab] = useState<DatabaseDetailTab>("rows");
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

      <DatabaseDetailTabs
        value={detailTab}
        rowCount={rows.data?.total}
        onChange={setDetailTab}
      />

      <div
        id="database-rows-panel"
        role="tabpanel"
        aria-label="資料列"
        hidden={detailTab !== "rows"}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          <input aria-label="搜尋資料" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋…" style={{ maxWidth: 220 }} />
          <span className="meta">{rows.data ? `${rows.data.total.toLocaleString()} 列` : "…"}</span>
          <span className="spacer" />
          {/* 匯出 CSV（接 Excel／其他資料庫）；同源 a 標籤帶 cookie 認證 */}
          <a className="btn-sm" href={`/api/databases/${table.id}/rows.csv`} download title="匯出成 CSV（可用 Excel/其他資料庫開啟）">
            <Icon name="Download" size={13} /> 匯出 CSV
          </a>
          {canWrite && (
            <button className="btn-sm" onClick={() => setShowImport((v) => !v)} title="批次匯入資料列（CSV／TSV／JSON——Excel／Google 試算表／其他資料庫的匯出檔）">
              <Icon name="Package" size={13} /> {showImport ? "收合批次匯入" : "批次匯入"}
            </button>
          )}
        </div>
        {showImport && canWrite && <DataImportPanel table={table} onImported={invalidate} />}

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
                      <CellInput field={f} groupId={groupId} tableId={table.id} value={draft[f.key] ?? null} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
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
                  tableId={table.id}
                  row={{ id: r.id, data: r.data as DataRowData }}
                  canWrite={table.access.canWriteRows}
                  canDelete={table.access.canManage || table.access.canWriteRows}
                  onSave={(data) => updateRow.mutate({ id: r.id, data })}
                  onDelete={() => removeRow.mutate({ id: r.id })}
                />
              ))}
            </tbody>
          </table>
          {rows.data && rows.data.rows.length === 0 && <p className="hint" style={{ marginTop: 8 }}>{q ? "沒有符合的資料" : "還沒有資料——從上面那一列開始加，或使用「批次匯入」一次加入最多 5,000 列"}</p>}
        </div>
        {mutationError && <p className="error" role="alert">{mutationError}</p>}
      </div>

      <div id="database-files-panel" role="tabpanel" aria-label="文件" hidden={detailTab !== "files"}>
        <FilesSection table={table} groupId={groupId} />
      </div>
      <div id="database-connect-panel" role="tabpanel" aria-label="同步與 API" hidden={detailTab !== "connect"}>
        <ConnectPanel table={table} />
      </div>
    </section>
  );
}

/* ────────────────────────── 多格式匯入（CSV／TSV／JSON）────────────────────────── */

function DataImportPanel({ table, onImported }: { table: TableSummary; onImported: () => void }) {
  const [content, setContent] = useState("");
  const [format, setFormat] = useState<TabularFormat>("csv");
  const [formatTouched, setFormatTouched] = useState(false); // 使用者手動選過格式就別再自動覆寫
  const [mapping, setMapping] = useState<Record<string, string>>({}); // 欄位 key → 來源表頭
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const importAttempt = useRef<{ signature: string; key: string } | null>(null);
  const importData = trpc.databases.importData.useMutation({
    // 匯入後刷新格線，但「不自動關閉面板」——讓使用者看到「成功幾列、失敗哪幾筆」的結果再自行收合
    onSuccess: (r) => {
      if (importAttempt.current) {
        clearDatabaseImportAttempt(table.id, importAttempt.current.key);
      }
      importAttempt.current = null; // 成功後下一次明確匯入要使用新 key
      setResult(r);
      if (r.imported > 0) onImported();
    },
  });

  const { headers, count, error: parseError } = usePreview(content, format);

  // 表頭變動時自動對應（表頭＝欄位 label 或 key 就連起來），保留使用者已手改的對應
  useEffect(() => {
    if (headers.length === 0) return;
    setMapping((prev) => {
      const next = { ...prev };
      for (const f of table.fields) {
        if (next[f.key]) continue; // 別覆寫使用者手選
        const hit = headers.find((h) => h === f.label || h === f.key);
        if (hit) next[f.key] = hit;
      }
      return next;
    });
  }, [headers, table.fields]);

  const applyContent = (text: string, fmt?: TabularFormat) => {
    setContent(text);
    setResult(null);
    setMapping({});
    if (fmt) { setFormat(fmt); setFormatTouched(true); }
    else if (!formatTouched) setFormat(detectFormat(null, text)); // 貼上內容自動嗅探格式
  };

  const onFile = async (f: File) => {
    const text = await f.text();
    const fmt = detectFormat(f.name, text);
    setFormatTouched(true);
    applyContent(text, fmt);
    if (fileInput.current) fileInput.current.value = "";
  };

  const headerMap = Object.fromEntries(Object.entries(mapping).filter(([, h]) => h).map(([key, h]) => [h, key]));
  const startImport = () => {
    const payload = { tableId: table.id, content, format, headerMap };
    const signature = databaseImportPayloadSignature(payload);
    if (!importAttempt.current || importAttempt.current.signature !== signature) {
      importAttempt.current = getDatabaseImportAttempt(payload);
    }
    importData.mutate({
      ...payload,
      idempotencyKey: importAttempt.current.key,
    });
  };
  const placeholder = format === "json" ? '[{"姓名":"小美","年齡":28},{"姓名":"阿哲","年齡":30}]' : format === "tsv" ? "姓名\t年齡\n小美\t28\n阿哲\t30" : "姓名,年齡\n小美,28\n阿哲,30";

  return (
    <div style={{ margin: "8px 0", padding: 12, border: "1px dashed var(--border, #ccc)", borderRadius: 8 }}>
      <p className="hint" style={{ marginTop: 0 }}>
        上傳或貼上 CSV／TSV／JSON——Excel／Google 試算表可「另存為 CSV／Tab 分隔」，其他資料庫或 API 可匯出 JSON（物件陣列）。
        選檔會自動判斷格式並對應欄位，確認對照後匯入。
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <input
          ref={fileInput}
          type="file"
          aria-label="選擇匯入檔"
          accept={TABULAR_ACCEPT}
          style={{ width: "auto" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
          格式
          <select aria-label="匯入格式" value={format} style={{ width: "auto" }} onChange={(e) => { setFormat(e.target.value as TabularFormat); setFormatTouched(true); setResult(null); }}>
            {TABULAR_FORMATS.map((f) => <option key={f.id} value={f.id} title={f.hint}>{f.label}</option>)}
          </select>
        </label>
      </div>
      <ExternalFetchRow onFetched={(text, fmt) => applyContent(text, fmt)} />
      <textarea
        aria-label="匯入內容"
        value={content}
        onChange={(e) => applyContent(e.target.value)}
        placeholder={placeholder}
        rows={5}
        style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
      />
      <div style={{ marginTop: 6 }}>
        {parseError ? (
          <span className="meta" style={{ color: "var(--danger-ink, #a33)" }}>{parseError}</span>
        ) : (
          <span className="meta">{headers.length > 0 ? `偵測到 ${headers.length} 欄、${count} 列資料：${headers.join("、")}` : "上傳或貼上資料後自動對應欄位"}</span>
        )}
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
          disabled={!content.trim() || !!parseError || Object.keys(headerMap).length === 0 || importData.isPending}
          onClick={startImport}
        >
          {importData.isPending ? "匯入中…" : "開始匯入"}
        </button>
      </div>
      {importData.error && <p className="error" role="alert">{importData.error.message}</p>}
      {result && <ImportResultView result={result} />}
    </div>
  );
}

/**
 * 從外部連接抓取（個人整合）：在「連接的資料來源」頁登記過的外部資料庫/API，
 * 這裡選一條＋路徑一鍵抓，內容直接灌進匯入面板（格式依回應 content-type 自動選）。
 */
function ExternalFetchRow({ onFetched }: { onFetched: (text: string, fmt?: TabularFormat) => void }) {
  const list = trpc.integrations.list.useQuery();
  const fetchApi = trpc.integrations.fetchApi.useMutation();
  const [connId, setConnId] = useState("");
  const [path, setPath] = useState("");
  const apis = list.data?.apis ?? [];
  if (list.data && apis.length === 0) {
    return (
      <p className="hint" style={{ margin: "0 0 8px" }}>
        也可以直接從你自己的系統抓：先到<Link href="/integrations">連接的資料來源</Link>登記外部資料庫／API，這裡就會出現一鍵抓取。
      </p>
    );
  }
  const mimeToFormat = (mime: string): TabularFormat | undefined =>
    mime.includes("json") ? "json" : mime.includes("csv") ? "csv" : mime.includes("tab-separated") ? "tsv" : undefined;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
      <span className="meta">從外部連接抓：</span>
      <select aria-label="選擇外部連接" value={connId} style={{ width: "auto", maxWidth: 200 }} onChange={(e) => setConnId(e.target.value)}>
        <option value="">選連接…</option>
        {apis.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <input aria-label="抓取路徑" value={path} maxLength={500} placeholder="路徑（選填）如 ?limit=100" style={{ flex: "1 1 160px", maxWidth: 260 }} onChange={(e) => setPath(e.target.value)} />
      <button
        className="btn-sm"
        disabled={!connId || fetchApi.isPending}
        onClick={() =>
          fetchApi.mutate(
            { id: connId, path: path.trim() || undefined },
            { onSuccess: (r) => onFetched(r.content, mimeToFormat(r.mime)) },
          )
        }
      >
        {fetchApi.isPending ? "抓取中…" : "抓取"}
      </button>
      {fetchApi.error && <span className="meta" style={{ color: "var(--danger-ink, #a33)" }}>{fetchApi.error.message}</span>}
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
  const batchUrl = `${origin}/api/v1/databases/${table.id}/rows/batch`;
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
          反方向——讓本系統去抓「你自己的」Google 雲端／Notion／外部資料庫，到<Link href="/integrations">連接的資料來源</Link>設定。
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
  ${restUrl}

# 批次新增（最多 500 列）；24 小時內逾時重試沿用同一 Idempotency-Key
curl -X POST -H "x-api-key: 你的金鑰" \\
  -H "Idempotency-Key: import-20260726-001" \\
  -H "Content-Type: application/json" \\
  -d '{"rows":[{"data":{"欄位key":"值"}}]}' \\
  ${batchUrl}`}
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

/** 媒體類型的顯示標籤與圖示（listFiles 回的 kind） */
const FILE_KIND_META: Record<string, { label: string; icon: IconName }> = {
  image: { label: "圖片", icon: "Image" },
  video: { label: "影片", icon: "Film" },
  audio: { label: "音訊", icon: "Mic" },
  doc: { label: "文件", icon: "FileText" },
};

/**
 * 資訊量面板：列數／文件數／圖影音文分佈／容量／AI 可讀字數／分類分佈。
 * 分類 chips 可點＝過濾下方文件清單（onPickCategory）。
 */
function StatsStrip({ tableId, category, onPickCategory }: { tableId: string; category: string | null; onPickCategory: (c: string | null) => void }) {
  const stats = trpc.databases.stats.useQuery({ tableId });
  const s = stats.data;
  if (!s) return null;
  const kinds = s.files.byKind.filter((k) => k.count > 0);
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "8px 0", padding: "8px 10px", background: "var(--bg-sunken, rgba(0,0,0,.04))", borderRadius: 8 }} data-fb="資料庫資訊量面板">
      <Icon name="Info" size={14} />
      <span className="meta">資訊量：資料 {s.rowCount.toLocaleString()} 列（{s.fieldCount} 欄）</span>
      <span className="meta">・文件 {s.files.count} 份{s.files.count > 0 ? `（${kinds.map((k) => `${FILE_KIND_META[k.kind]?.label ?? k.kind} ${k.count}`).join("、")}）共 ${formatBytes(s.files.totalBytes)}` : ""}</span>
      {s.files.readableChars > 0 && <span className="meta">・AI 可讀 {s.files.readableChars.toLocaleString()} 字</span>}
      {s.files.describedCount > 0 && <span className="meta">・已看圖描述 {s.files.describedCount} 份</span>}
      {s.categories.length > 0 && (
        <span style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
          <span className="meta">・分類：</span>
          {s.categories.map((c) => (
            <button
              key={c.category}
              className="badge"
              style={{ cursor: "pointer", ...(category === c.category ? { outline: "2px solid var(--accent, #4a7)", outlineOffset: 1 } : {}) }}
              title={category === c.category ? "取消過濾" : `只看「${c.category}」的文件`}
              onClick={() => onPickCategory(category === c.category ? null : c.category)}
            >
              {c.category} {c.count}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

/** 分類編輯（datalist 提示建議與既有分類；空白＝清除分類） */
function CategoryEditor({ fileId, tableId, initial, existing, onDone }: { fileId: string; tableId: string; initial: string | null; existing: string[]; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [value, setValue] = useState(initial ?? "");
  const setMeta = trpc.databases.setFileMeta.useMutation({
    onSuccess: () => {
      utils.databases.listFiles.invalidate({ tableId });
      utils.databases.stats.invalidate({ tableId });
      onDone();
    },
  });
  const suggestions = [...new Set([...existing, ...FILE_CATEGORY_SUGGESTIONS])];
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <input
        aria-label="分類"
        value={value}
        maxLength={MAX_FILE_CATEGORY}
        list={`cat-suggest-${fileId}`}
        placeholder="分類（空白＝清除）"
        style={{ width: 130 }}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") setMeta.mutate({ id: fileId, category: value.trim() || null }); if (e.key === "Escape") onDone(); }}
      />
      <datalist id={`cat-suggest-${fileId}`}>
        {suggestions.map((c) => <option key={c} value={c} />)}
      </datalist>
      <button className="btn-sm primary" title="儲存分類" disabled={setMeta.isPending} onClick={() => setMeta.mutate({ id: fileId, category: value.trim() || null })}>
        <Icon name="Check" size={13} />
      </button>
      <button className="btn-sm" title="取消" onClick={onDone}><Icon name="X" size={13} /></button>
    </span>
  );
}

/** 送到專案素材庫：挑專案→確認（實體複製一份，兩邊獨立） */
function SendToProject({ fileId, groupId, onDone }: { fileId: string; groupId: string; onDone: (msg: string) => void }) {
  const projects = trpc.projects.list.useQuery({ groupId: groupId || undefined }, { enabled: !!groupId });
  const [projectId, setProjectId] = useState("");
  const send = trpc.databases.sendFileToProject.useMutation({
    onSuccess: (r) => onDone(`已把「${r.title}」送進專案「${r.projectTitle}」的素材庫`),
  });
  const opts = (projects.data ?? []).filter((p) => p.status !== "archived");
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
      <select aria-label="選擇專案" value={projectId} style={{ width: "auto", maxWidth: 200 }} onChange={(e) => setProjectId(e.target.value)}>
        <option value="">選專案…</option>
        {opts.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
      </select>
      <button className="btn-sm primary" disabled={!projectId || send.isPending} onClick={() => send.mutate({ fileId, projectId })}>
        {send.isPending ? "送出中…" : "送出"}
      </button>
      {send.error && <span className="meta" style={{ color: "var(--danger-ink, #a33)" }}>{send.error.message}</span>}
    </span>
  );
}

/**
 * 文件區：檔案上傳（文字/PDF/Word/圖片/影音…）＋網址匯入（Google 公開連結、Notion）。
 * 文字檔伺服器抽純文字、圖片可「AI 分類」產生繁中描述＋分類標籤——AI 助手與 MCP 代理都讀得到；
 * 圖影有縮圖與播放預覽、可分類過濾、可送進專案素材庫。配額每人預設 5GB（管理員可調）。
 */
function FilesSection({ table, groupId }: { table: TableSummary; groupId: string }) {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const list = trpc.databases.listFiles.useQuery({ tableId: table.id });
  const invalidateFiles = () => {
    utils.databases.listFiles.invalidate({ tableId: table.id });
    utils.databases.stats.invalidate({ tableId: table.id });
  };
  const importUrl = trpc.databases.importUrl.useMutation({ onSuccess: () => { invalidateFiles(); setUrl(""); setUrlName(""); } });
  const refresh = trpc.databases.refreshFile.useMutation({
    onSuccess: (_r, vars) => {
      invalidateFiles();
      // 開著的全文預覽也要跟上重抓後的內容，否則顯示過期文字
      utils.databases.getFileText.invalidate({ id: vars.id });
    },
  });
  const removeFile = trpc.databases.removeFile.useMutation({ onSuccess: invalidateFiles });
  // 修 R5-01：AI 看圖分類會扣點——成功後一併失效 quota.my，讓頂欄餘額即時同步（比照 GenerationList/AgentCard）
  const classify = trpc.databases.classifyFile.useMutation({ onSuccess: () => { invalidateFiles(); utils.quota.my.invalidate(); } });

  const [url, setUrl] = useState("");
  const [urlName, setUrlName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editCatId, setEditCatId] = useState<string | null>(null);
  const [sendToId, setSendToId] = useState<string | null>(null);
  const [sentMsg, setSentMsg] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const allFiles = list.data?.files ?? [];
  const previewFile = allFiles.find((f) => f.id === previewId) ?? null;
  // 文字預覽只對「有抽出文字」的文件發查詢；圖影預覽是媒體本身＋AI 描述，不打 getFileText
  const preview = trpc.databases.getFileText.useQuery(
    { id: previewId ?? "" },
    { enabled: !!previewId && (previewFile?.readableChars ?? 0) > 0 },
  );

  // 多檔逐一上傳（伺服器單請求收一檔）：部分失敗不中止，最後彙整回報哪幾個檔為什麼失敗
  const doUploadMany = async (picked: File[]) => {
    if (picked.length === 0) return;
    setUploading(true);
    setUploadError(null);
    setProgress({ done: 0, total: picked.length });
    const errors: string[] = [];
    for (const f of picked) {
      try {
        const form = new FormData();
        form.append("file", f);
        form.append("tableId", table.id);
        const res = await fetch("/api/databases/upload", { method: "POST", body: form, credentials: "same-origin" });
        const body = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !body.ok) errors.push(`${f.name}：${body.error ?? "上傳失敗"}`);
      } catch {
        errors.push(`${f.name}：上傳失敗（網路問題）`);
      }
      setProgress((p) => (p ? { done: p.done + 1, total: p.total } : p));
    }
    invalidateFiles();
    if (errors.length > 0) setUploadError(errors.slice(0, 5).join("；") + (errors.length > 5 ? `（另有 ${errors.length - 5} 個失敗）` : ""));
    setUploading(false);
    setProgress(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const quota = list.data?.quota;
  const files = catFilter ? allFiles.filter((f) => f.category === catFilter) : allFiles;
  const existingCategories = [...new Set(allFiles.map((f) => f.category).filter((c): c is string => !!c))];
  const canWrite = table.access.canWriteRows;
  const myId = me.data?.user.id;

  return (
    <div
      style={{
        marginTop: 20, paddingTop: 12, borderTop: "1px solid var(--border-soft, #eee)",
        ...(dragOver ? { outline: "2px dashed var(--accent, #4a7)", outlineOffset: -2, borderRadius: 8 } : {}),
      }}
      onDragOver={canWrite ? (e) => { e.preventDefault(); setDragOver(true); } : undefined}
      onDragLeave={canWrite ? () => setDragOver(false) : undefined}
      onDrop={canWrite ? (e) => { e.preventDefault(); setDragOver(false); void doUploadMany([...(e.dataTransfer?.files ?? [])]); } : undefined}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>文件與圖影（AI 可讀）</h3>
        {quota && (
          <span className="meta" title="所有資料庫合計、按上傳者計；管理員可在「團隊管理→點數與額度」調整">
            我的空間：{formatBytes(quota.usedBytes)}{quota.quotaBytes != null ? ` / ${formatBytes(quota.quotaBytes)}` : "（不限）"}
          </span>
        )}
      </div>
      <p className="hint" style={{ marginTop: 4 }}>
        圖片（含 iPhone HEIC）、影片、音訊、PDF、Word/Excel/PowerPoint、文字/字幕/壓縮檔等常見格式都能放——
        可一次選多個檔，或直接把檔案拖進這一區。文字/PDF/Word 自動抽成純文字；圖片可按「AI 分類」產生繁中描述＋自動歸類（1 點/張）——
        團隊 AI 助手與 MCP 代理都讀得到（受上方「AI 存取」等級管控）。影片／音訊可手動分類、可預覽播放；
        在欄位加「附件」型別，還能把檔案逐列掛進資料表。
        Google／Notion 私有內容：到<Link href="/integrations">連接的資料來源</Link>連結你自己的 Google 帳戶或 Notion token，
        之後貼私有連結就能直接匯入（公開連結照舊可用）。
      </p>

      <StatsStrip tableId={table.id} category={catFilter} onPickCategory={setCatFilter} />

      {canWrite && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          <input
            ref={fileInput}
            type="file"
            aria-label="上傳文件"
            accept={DB_FILE_ACCEPT}
            multiple
            style={{ width: "auto" }}
            disabled={uploading}
            onChange={(e) => { void doUploadMany([...(e.target.files ?? [])]); }}
          />
          {uploading && <span className="meta">{progress && progress.total > 1 ? `上傳中（${progress.done}/${progress.total}）…` : "上傳並抽取文字中…"}</span>}
        </div>
      )}
      {canWrite && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          <input
            aria-label="匯入網址"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="貼 Google 文件/試算表/雲端硬碟連結、Notion 頁面或網頁網址（已連結整合可貼私有連結）"
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
      {(uploadError || importUrl.error || refresh.error || removeFile.error || classify.error) && (
        <p className="error" role="alert">{uploadError ?? importUrl.error?.message ?? refresh.error?.message ?? removeFile.error?.message ?? classify.error?.message}</p>
      )}
      {sentMsg && <p className="hint" style={{ color: "var(--success-ink)" }}>{sentMsg}</p>}

      {allFiles.length === 0 && list.data && <p className="hint" style={{ marginTop: 8 }}>還沒有文件——上傳逐字稿、腳本、名單或劇照，AI 就能引用它們回答。</p>}
      {catFilter && <p className="meta" style={{ margin: "6px 0 0" }}>只顯示分類「{catFilter}」的 {files.length} 份文件——<button className="btn-sm" onClick={() => setCatFilter(null)}>顯示全部</button></p>}
      {files.map((f) => {
        const kindMeta = FILE_KIND_META[f.kind] ?? FILE_KIND_META.doc;
        const fileUrl = `/api/databases/files/${f.id}/file`;
        const isMedia = f.kind !== "doc";
        return (
        <div key={f.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "6px 0", borderBottom: "1px solid var(--border-soft, #eee)" }}>
          {f.kind === "image" && f.hasFile ? (
            <img
              src={fileUrl}
              alt={f.name}
              loading="lazy"
              style={{ height: 36, width: 48, objectFit: "cover", borderRadius: 6, cursor: "pointer", flex: "0 0 auto" }}
              onClick={() => setPreviewId(previewId === f.id ? null : f.id)}
            />
          ) : (
            <Icon name={kindMeta.icon} size={15} />
          )}
          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 240 }} title={f.name}>{f.name}</span>
          <span className="meta">{formatBytes(f.sizeBytes)}・{f.uploaderName}</span>
          {isMedia && <span className="badge">{kindMeta.label}</span>}
          {f.category && <span className="badge" title="分類">{f.category}</span>}
          {f.readableChars > 0 ? (
            <button className="badge" style={{ cursor: "pointer" }} title="點開預覽 AI 讀到的純文字" onClick={() => setPreviewId(previewId === f.id ? null : f.id)}>
              AI 可讀 {f.readableChars.toLocaleString()} 字
            </button>
          ) : f.aiDescription ? (
            <button className="badge" style={{ cursor: "pointer" }} title="AI 已看圖——點開看描述" onClick={() => setPreviewId(previewId === f.id ? null : f.id)}>
              AI 已看圖
            </button>
          ) : isMedia ? (
            <button className="badge" style={{ cursor: "pointer" }} title="預覽" onClick={() => setPreviewId(previewId === f.id ? null : f.id)}>預覽</button>
          ) : (
            <span className="badge" title="此格式暫不支援文字抽取（僅存檔）">僅存檔</span>
          )}
          <span className="spacer" />
          {canWrite && f.kind === "image" && f.hasFile && (
            <button
              className="btn-sm"
              title="AI 看圖：產生繁中描述並自動分類（1 點/張；點數走你的額度）"
              disabled={classify.isPending}
              onClick={() => classify.mutate({ id: f.id })}
            >
              <Icon name="Sparkles" size={13} /> {classify.isPending && classify.variables?.id === f.id ? "分類中…" : "AI 分類"}
            </button>
          )}
          {canWrite && (editCatId === f.id ? (
            <CategoryEditor fileId={f.id} tableId={table.id} initial={f.category} existing={existingCategories} onDone={() => setEditCatId(null)} />
          ) : (
            <button className="btn-sm" title="編輯分類" onClick={() => { setEditCatId(f.id); setSendToId(null); }}>
              <Icon name="Tag" size={13} />
            </button>
          ))}
          {f.hasFile && (sendToId === f.id ? (
            <SendToProject fileId={f.id} groupId={groupId} onDone={(msg) => { setSendToId(null); setSentMsg(msg); }} />
          ) : (
            <button className="btn-sm" title="送到專案素材庫（複製一份，分鏡與生成即可取用）" onClick={() => { setSendToId(f.id); setEditCatId(null); setSentMsg(null); }}>
              <Icon name="Package" size={13} />
            </button>
          ))}
          {f.hasFile && <a className="btn-sm" href={fileUrl} download title="下載原檔"><Icon name="Download" size={13} /></a>}
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
            <div style={{ flexBasis: "100%", background: "var(--bg-sunken, rgba(0,0,0,.04))", borderRadius: 8, padding: 10, maxHeight: isMedia ? 420 : 240, overflowY: "auto" }}>
              {f.kind === "image" && f.hasFile && (
                <img src={fileUrl} alt={f.name} style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 8, display: "block", marginBottom: 8 }} />
              )}
              {f.kind === "video" && f.hasFile && (
                <video src={fileUrl} controls preload="metadata" style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 8, display: "block", marginBottom: 8 }} />
              )}
              {f.kind === "audio" && f.hasFile && (
                <audio src={fileUrl} controls preload="metadata" style={{ width: "100%", marginBottom: 8 }} />
              )}
              {isMedia && (
                f.aiDescription ? (
                  <>
                    <p className="meta" style={{ margin: "0 0 4px" }}>AI 看圖描述{f.category ? `（分類：${f.category}）` : ""}——AI 助手與 MCP 代理讀這段回答圖影問題：</p>
                    <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>{f.aiDescription}</p>
                  </>
                ) : (
                  <p className="meta" style={{ margin: 0 }}>
                    {f.kind === "image" ? "尚未有 AI 描述——按「AI 分類」讓視覺模型看圖產生描述與分類，AI 助手就答得出這張圖的內容。" : "影片／音訊可用「編輯分類」手動歸類；描述可之後補。"}
                  </p>
                )
              )}
              {!isMedia && (preview.data ? (
                <>
                  {/* 「前 20,000 字」只在真的被截斷時講——短檔顯示「前 20,000 字／共 500 字」自相矛盾 */}
                  <p className="meta" style={{ margin: "0 0 6px" }}>AI 讀到的純文字（{preview.data.totalChars > 20000 ? "前 20,000 字／" : ""}共 {preview.data.totalChars.toLocaleString()} 字）：</p>
                  <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontSize: 13 }}>{preview.data.text}</pre>
                </>
              ) : preview.error ? (
                <p className="error" role="alert" style={{ margin: 0 }}>預覽載入失敗：{preview.error.message}</p>
              ) : (f.readableChars > 0 ? (
                <p className="meta" style={{ margin: 0 }}>載入中…</p>
              ) : (
                <p className="meta" style={{ margin: 0 }}>此格式暫不支援文字抽取（僅存檔）。</p>
              )))}
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}

/** 一列（點值進入行內編輯；blur/Enter 儲存整列） */
function GridRow({
  fields, groupId, tableId, row, canWrite, canDelete, onSave, onDelete,
}: {
  fields: DataField[];
  groupId: string;
  tableId: string;
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
            <CellInput field={f} groupId={groupId} tableId={tableId} value={draft[f.key] ?? null} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
          </td>
        ))}
        <td style={{ padding: "4px 4px", whiteSpace: "nowrap" }}>
          <button className="btn-sm primary" title="儲存" onClick={() => { onSave(draft); setEditing(false); }}><Icon name="Check" size={13} /></button>
          <button className="btn-sm" title="取消" onClick={() => { setDraft(row.data); setEditing(false); }}><Icon name="X" size={13} /></button>
        </td>
      </tr>
    );
  }
  // 進入編輯時以「當下最新」的 row.data 重種草稿：draft 是掛載時的舊快照，
  // 共享表（組員／MCP 代理都能寫）若這列已被別人改過，拿舊草稿去存會靜默覆蓋對方的修改（lost update）
  const beginEdit = () => { setDraft(row.data); setEditing(true); };
  return (
    <tr
      onDoubleClick={() => canWrite && beginEdit()}
      title={canWrite ? "雙擊編輯" : undefined}
      style={{ cursor: canWrite ? "pointer" : "default" }}
    >
      {fields.map((f) => (
        <td key={f.key} style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-soft, #eee)" }}>
          <CellDisplay field={f} groupId={groupId} tableId={tableId} value={row.data[f.key] ?? null} />
        </td>
      ))}
      <td style={{ padding: "4px 4px", whiteSpace: "nowrap" }}>
        {canWrite && <button className="btn-sm" title="編輯" onClick={beginEdit}><Icon name="Ellipsis" size={13} /></button>}
        {canDelete && (
          <ConfirmButton onConfirm={onDelete} message="刪除這一列？" triggerClassName="btn-sm" triggerAriaLabel="刪除這一列">
            <Icon name="X" size={13} />
          </ConfirmButton>
        )}
      </td>
    </tr>
  );
}

function CellDisplay({ field, groupId, tableId, value }: { field: DataField; groupId: string; tableId: string; value: DataRowValue }) {
  if (value === null || value === "") return <span className="meta">—</span>;
  if (field.type === "checkbox") return value ? <Icon name="Check" size={14} /> : <span className="meta">—</span>;
  if (field.type === "file") return <FileCell tableId={tableId} fileId={String(value)} />;
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

/** 附件欄顯示：圖片給縮圖、其他給圖示＋檔名；點擊開原檔（圖影內嵌預覽、文件下載） */
function FileCell({ tableId, fileId }: { tableId: string; fileId: string }) {
  // 與文件區共用同一個 listFiles 查詢（react-query 以 key 去重，一表多附件格也只打一次）
  const files = trpc.databases.listFiles.useQuery({ tableId });
  const f = files.data?.files.find((x) => x.id === fileId);
  if (!files.data) return <span className="meta">…</span>;
  if (!f) return <span className="meta" title={fileId}>（文件已刪除）</span>;
  const url = `/api/databases/files/${f.id}/file`;
  const kindMeta = FILE_KIND_META[f.kind] ?? FILE_KIND_META.doc;
  return (
    <a href={url} target="_blank" rel="noreferrer" title={`${f.name}（${formatBytes(f.sizeBytes)}）——點開檢視/下載`} style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%" }}>
      {f.kind === "image" && f.hasFile ? (
        <img src={url} alt={f.name} loading="lazy" style={{ height: 28, width: 36, objectFit: "cover", borderRadius: 4, flex: "0 0 auto" }} />
      ) : (
        <Icon name={kindMeta.icon} size={14} />
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{f.name}</span>
    </a>
  );
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
  const item = (list.data?.items ?? []).find((s: { id: string }) => s.id === id) as { title?: string } | undefined;
  if (!item?.title) return <span className="mono" title={id}>{id.slice(0, 8)}…</span>;
  return <Link href="/planner" title="開啟筆記排程">{item.title}</Link>;
}

/** user 欄位顯示名字：成員清單可能跨組，前端只有本組成員表——查不到就顯示縮短 id */
function UserName({ id }: { id: string }) {
  const me = trpc.auth.me.useQuery();
  if (me.data?.user.id === id) return <>{me.data.user.name}</>;
  return <span className="mono" title={id}>{id.slice(0, 8)}…</span>;
}

function CellInput({ field, groupId, tableId, value, onChange }: { field: DataField; groupId: string; tableId: string; value: DataRowValue; onChange: (v: DataRowValue) => void }) {
  const common = { "aria-label": field.label, style: { width: "100%", minWidth: 90 } as const };
  switch (field.type) {
    case "file":
      return <FileCellInput label={field.label} tableId={tableId} value={typeof value === "string" ? value : ""} onChange={onChange} />;
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

/**
 * 附件欄輸入：從本庫既有文件挑選，或按「＋」直接上傳新檔（圖片/影片/PDF/各種格式）——
 * 檔案進文件層（data_files）、格子存文件 id，文件區與 AI 讀取同步受惠。
 */
function FileCellInput({ label, tableId, value, onChange }: { label: string; tableId: string; value: string; onChange: (v: DataRowValue) => void }) {
  const utils = trpc.useUtils();
  const files = trpc.databases.listFiles.useQuery({ tableId });
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const opts = files.data?.files ?? [];

  const doUpload = async (f: File) => {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", f);
      form.append("tableId", tableId);
      const res = await fetch("/api/databases/upload", { method: "POST", body: form, credentials: "same-origin" });
      const body = (await res.json()) as { ok?: boolean; file?: { id: string }; error?: string };
      if (!res.ok || !body.ok || !body.file) {
        setError(body.error ?? "上傳失敗，請稍後再試");
      } else {
        onChange(body.file.id);
        utils.databases.listFiles.invalidate({ tableId });
        utils.databases.stats.invalidate({ tableId });
      }
    } catch {
      setError("上傳失敗（網路問題），請稍後再試");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <span style={{ display: "flex", gap: 4, alignItems: "center", minWidth: 140 }}>
      <select aria-label={label} value={value} style={{ flex: 1, minWidth: 90 }} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">—</option>
        {value && !opts.some((o) => o.id === value) && <option value={value}>（已刪除的文件）</option>}
        {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <input ref={inputRef} type="file" aria-label={`上傳${label}`} accept={DB_FILE_ACCEPT} style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void doUpload(f); }} />
      <button className="btn-sm" type="button" title="上傳新檔到這一格（也會進本庫的文件區）" disabled={uploading} onClick={() => inputRef.current?.click()}>
        {uploading ? "…" : <Icon name="Plus" size={13} />}
      </button>
      {error && <span className="meta" style={{ color: "var(--danger-ink, #a33)" }}>{error}</span>}
    </span>
  );
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
  const opts = (list.data?.items ?? []) as Array<{ id: string; title: string; startsAt: string | Date }>;
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
