import { useState } from "react";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { Badge, Button, Card, Hint, Meta } from "../../components/ui";
import {
  FOLDER_IMPORT_MODE_LABEL,
  type FolderImportMode,
  type FolderTreeNode,
} from "@shared/folderImport";

/**
 * 資料中心的「資料夾匯入」區：匯入清單 + 原始資料夾結構 + 分段進度。
 *
 * ★ 這是「原始資料夾」檢視——與「智慧分類」用的是**同一批** resource，不是第二份副本。
 *   資料夾結構是 Source Metadata，AI 分類是另一個維度，兩者同時存在。
 */

function TreeNode({ node, depth }: { node: FolderTreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  return (
    <li>
      <button
        type="button"
        className="folder-tree__node"
        style={{ paddingInlineStart: `${depth * 14}px` }}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={hasChildren ? open : undefined}
      >
        <Icon name={hasChildren ? (open ? "ChevronDown" : "ChevronRight") : "FolderGit2"} size={14} />
        <span>{node.name}</span>
        <Meta>{node.fileCount.toLocaleString("en-US")}</Meta>
      </button>
      {hasChildren && open && (
        <ul className="folder-tree">
          {node.children.map((child) => <TreeNode key={child.path} node={child} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
}

export function FolderImportsSection({ projectId }: { projectId?: string | null }) {
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const sessions = trpc.folderImport.list.useQuery(
    { projectId: projectId ?? undefined, limit: 10 },
    { staleTime: 15_000 },
  );
  const status = trpc.folderImport.status.useQuery(
    { sessionId: openSessionId ?? "" },
    {
      enabled: !!openSessionId,
      refetchInterval: (query) => query.state.data?.session.status === "uploading" ? 4_000 : false,
    },
  );
  const tree = trpc.folderImport.tree.useQuery(
    { sessionId: openSessionId ?? "" },
    { enabled: !!openSessionId, staleTime: 30_000 },
  );

  if (!sessions.data?.length) return null;

  return (
    <Card as="details" variant="quiet" className="hub-folder-imports" data-fb="資料夾匯入">
      <summary>
        <Icon name="FolderGit2" size={14} /> 資料夾匯入
        <Meta style={{ marginLeft: 8 }}>{sessions.data.length} 次</Meta>
      </summary>
      <ul className="hub-source-list">
        {sessions.data.map((session) => (
          <li key={session.id} className="hub-source">
            <span className="hub-source__icon"><Icon name="FolderGit2" size={16} /></span>
            <span className="hub-source__copy">
              <strong>{session.displayName}</strong>
              <small>
                {session.totalFiles.toLocaleString("en-US")} 個檔案
                ・已上傳 {session.uploadedFiles.toLocaleString("en-US")}
                {session.skippedFiles > 0 ? `・沒有變動 ${session.skippedFiles}` : ""}
                {session.failedFiles > 0 ? `・失敗 ${session.failedFiles}` : ""}
                {session.missingFiles > 0 ? `・來源消失 ${session.missingFiles}` : ""}
                ・{FOLDER_IMPORT_MODE_LABEL[session.mode as FolderImportMode] ?? session.mode}
              </small>
            </span>
            <Button size="sm" variant="ghost" onClick={() => setOpenSessionId(openSessionId === session.id ? null : session.id)}>
              {openSessionId === session.id ? "收合" : "原始資料夾"}
            </Button>
          </li>
        ))}
      </ul>

      {openSessionId && (
        <div className="hub-folder-imports__detail">
          {status.data?.stages.map((stage) => (
            <p key={stage.key} className="folder-import__line">
              <strong>{stage.label}</strong>
              <span>{stage.detail}</span>
              {stage.percent != null && <Badge>{stage.percent}%</Badge>}
            </p>
          ))}
          {!!status.data?.missingEntries.length && (
            <Hint style={{ margin: 0 }}>
              有 {status.data.missingEntries.length} 個檔案在來源已找不到。站內資料仍保留——
              需不需要刪除由你決定。
            </Hint>
          )}
          {tree.data && (
            <ul className="folder-tree folder-tree--root">
              {tree.data.tree.map((node) => <TreeNode key={node.path} node={node} depth={0} />)}
            </ul>
          )}
        </div>
      )}
      <Hint>原始資料夾結構與 AI 智慧分類是兩個維度，看的是同一批資料，不是兩份副本。</Hint>
    </Card>
  );
}
