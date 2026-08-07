import { useState } from "react";
import { Icon, type IconName } from "../../components/Icon";
import { Button, Chip, Meta, Pill } from "../../components/ui";
import { toolLabel, type ToolResultPreview as Preview } from "../../../../shared/toolResultPreview";
import { ToolResultPreview } from "./ToolResultPreview";

/**
 * AI 實際運作紀錄的事件時間軸。
 *
 * 取代原本 `AiTraceHistory` 裡那個 `<pre>{JSON.stringify(event.payload, null, 2)}</pre>`——
 * 資料一直都在前端手上，只是以「請你自己讀 JSON」的形式呈現。
 *
 * 設計取捨：
 * - **工具結果直接畫成實際內容**（素材縮圖、那一鏡的畫面、生成成品），這是使用者真正想看的。
 * - **模型請求／回應這類技術事件維持可收合的 JSON**。那是除錯資料，硬做成圖表只會假裝
 *   我們理解它；收合起來、要看的人點開，比較誠實也比較有用。
 * - **耗時常駐顯示**。`latencyMs` 一直都有記錄，卻從來沒有顯示過——這是純賺的資訊。
 *
 * 版面是直向鏈，不是節點圖：主要使用情境是 390px 直立手機，而 html/body 為
 * `overflow-x: clip`（有測試鎖住），橫向節點圖不會給你捲軸，只會被硬裁。
 */

/** 事件列的最小結構（對應 ai_trace_events 的欄位，不綁 tRPC 推導型別以便單元測試）。 */
export interface TraceEventLike {
  id: string;
  sequence: number;
  eventType: string;
  summary: string;
  payload: unknown;
  latencyMs?: number | null;
  truncatedFields?: string[] | null;
}

const EVENT_ICON: Record<string, IconName> = {
  prepared: "Layers",
  provider_request: "Sparkles",
  provider_response: "Sparkles",
  tool_call: "Search",
  tool_result: "Check",
  validation: "Check",
  completed: "Check",
  failed: "X",
  stopped: "X",
};

/** 終局事件才配狀態色；中間步驟一律中性，否則整條軌跡會滿是彩色而失去指示作用。 */
function eventPill(eventType: string): "done" | "failed" | null {
  if (eventType === "completed") return "done";
  if (eventType === "failed" || eventType === "stopped") return "failed";
  return null;
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * payload 裡的 preview 欄位。
 *
 * 只做「有沒有 kind 這個字串鍵」的最小驗證，不逐欄驗型別：這是自家伺服器寫進自家資料庫的
 * 資料，過度驗證只是把成本轉嫁到每次渲染。真的形狀不對時，下游的 switch 會落到 default
 * 而不渲染任何東西——降級成只顯示摘要，不會爆掉。
 */
function readPreview(payload: unknown): Preview | null {
  const record = asRecord(payload);
  const preview = record ? asRecord(record.preview) : null;
  return preview && typeof preview.kind === "string" ? (preview as unknown as Preview) : null;
}

/** tool_call 的參數 → chips。空參數（工具無參數呼叫）不渲染空容器。 */
function ArgChips({ payload }: { payload: unknown }) {
  const record = asRecord(payload);
  const args = record ? asRecord(record.args) : null;
  if (!args) return null;
  const entries = Object.entries(args).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!entries.length) return null;
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
      {entries.map(([key, value]) => (
        <Chip key={key}>{key}：{String(value).slice(0, 40)}</Chip>
      ))}
    </div>
  );
}

/** 技術細節（模型請求／回應等）：預設收合的原始 JSON。 */
function TechnicalDetail({ payload }: { payload: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 4 }}>
      <Button variant="ghost" size="sm" type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? "ChevronUp" : "ChevronDown"} size={12} />
        技術細節
      </Button>
      {open ? (
        <pre
          style={{
            margin: "4px 0 0",
            maxHeight: 280,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: "var(--card2)",
            padding: 8,
            borderRadius: 8,
            fontSize: 12,
          }}
        >
          {JSON.stringify(payload, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function TraceEventRow({ event }: { event: TraceEventLike }) {
  const preview = event.eventType === "tool_result" ? readPreview(event.payload) : null;
  const pill = eventPill(event.eventType);
  const record = asRecord(event.payload);
  const tool = typeof record?.tool === "string" ? record.tool : null;

  return (
    <li style={{ display: "flex", gap: 8, listStyle: "none" }}>
      {/* 左側軌道：圓點＋直線。純 CSS，不用 SVG——手機上 SVG 的線寬與縮放很難控。 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" }}>
        <Icon name={EVENT_ICON[event.eventType] ?? "Layers"} size={13} />
        <div style={{ flex: 1, width: 1, background: "var(--border-soft)", marginTop: 2 }} />
      </div>

      <div style={{ flex: 1, minWidth: 0, paddingBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13 }}>{event.summary}</span>
          {tool ? <Chip>{toolLabel(tool)}</Chip> : null}
          {pill ? <Pill status={pill}>{pill === "done" ? "完成" : "中止"}</Pill> : null}
          {/* 耗時：一直有記錄卻從沒顯示過 */}
          {typeof event.latencyMs === "number" ? (
            <Meta as="span" style={{ fontSize: 11 }}>{formatMs(event.latencyMs)}</Meta>
          ) : null}
        </div>

        {event.eventType === "tool_call" ? <ArgChips payload={event.payload} /> : null}

        {preview ? (
          <div style={{ marginTop: 6 }}>
            <ToolResultPreview preview={preview} />
          </div>
        ) : (
          <TechnicalDetail payload={event.payload} />
        )}

        {/* sanitize 截斷過的欄位要講出來，否則使用者會以為看到的是全部 */}
        {event.truncatedFields?.length ? (
          <Meta as="p" style={{ margin: "4px 0 0", fontSize: 11 }}>
            過長已截斷：{event.truncatedFields.join("、")}
          </Meta>
        ) : null}
      </div>
    </li>
  );
}

export function TraceEventList({ events }: { events: TraceEventLike[] }) {
  if (!events.length) return <Meta as="p">這筆紀錄還沒有事件。</Meta>;
  return (
    <ul style={{ margin: "8px 0 0", padding: 0 }}>
      {events.map((event) => (
        <TraceEventRow key={event.id} event={event} />
      ))}
    </ul>
  );
}
