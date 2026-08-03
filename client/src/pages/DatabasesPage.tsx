import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon, type IconName } from "../components/Icon";
import { GoogleDrivePicker } from "../components/GoogleDrivePicker";
import { NotionPagePicker } from "../components/NotionPagePicker";
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

import { Badge, Button, Card, Chip, EmptyState, Hint, Meta } from "../components/ui";
import { useCollab, CursorOverlay } from "../realtime";
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

export function DatabasesPage({ groupId }: { groupId: string }) {
  // 全組協作：presence + 游標（組房 g:${groupId}）
  const collab = useCollab(groupId, !!groupId, "group");

  return (
    <div
      className="page-shell database-page"
      ref={collab.containerRef}
      onPointerMove={collab.onPointerMove}
      style={{ position: "relative" }}
    >
      <CursorOverlay cursors={collab.cursors} />
      <header className="page-intro database-intro">
        <div>
          <p className="eyebrow">團隊資料中心</p>
          <h1>資料庫</h1>
          <p className="page-lede">把名單、素材、任務與文件變成團隊和 AI 都能安全使用的共同資料。</p>
        </div>
      </header>
      {collab.connected && collab.peers.length > 0 && (
        <div
          aria-label="組內在線"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 12,
            alignItems: "center",
          }}
        >
          <Hint as="span" layer="always" style={{ margin: 0, fontSize: 12 }}>
            組內在線
          </Hint>
          {collab.peers.map((p) => (
            <Chip
              key={p.userId}
              style={{
                margin: 0,
                background: p.color,
                color: "#fff",
                borderColor: p.color,
              }}
              title={p.userId === collab.self?.userId ? "你" : p.name}
            >
              {p.userId === collab.self?.userId ? "你" : p.name}
            </Chip>
          ))}
        </div>
      )}
      <p style={{ marginTop: 24 }}>
        <Link href="/dashboard">回今日工作台</Link>
      </p>
    </div>
  );
}
