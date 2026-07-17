import { useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { ConfirmButton } from "./interactions";

/**
 * 長文版本歷史（#29）：知識庫長文（師父開示逐字稿／見證故事）每次「內容更新」前，
 * 後端會自動存一版快照。這裡把歷史版本由新到舊列出，可一鍵「還原此版本」——
 * 還原會先把當前內容也存一版（可再反悔），再把長文改回舊版，避免手滑覆蓋就永久遺失。
 *
 * 收合式：預設不展開、也不打 API；點開才 lazily 查 listVersions（省流量）。
 */
export function VersionHistory({ knowledgeId, projectId }: { knowledgeId: string; projectId?: string }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const versions = trpc.knowledge.listVersions.useQuery({ knowledgeId }, { enabled: open });
  const restore = trpc.knowledge.restoreVersion.useMutation({
    onSuccess: () => {
      // 還原後：清單摘要（字數／預覽）、版本歷史、與編輯用全文都可能變了，一併失效重抓。
      utils.knowledge.list.invalidate(projectId ? { projectId } : undefined);
      utils.knowledge.listVersions.invalidate({ knowledgeId });
      utils.knowledge.get.invalidate({ id: knowledgeId });
    },
  });

  return (
    <div style={{ marginTop: 10 }}>
      <button
        className="btn-sm"
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Icon name="Clock" size={14} />
        版本歷史
        <Icon name={open ? "ChevronUp" : "ChevronDown"} size={14} />
      </button>

      {open && (
        <div style={{ marginTop: 8 }}>
          {versions.isLoading ? (
            <div aria-hidden="true">
              <div className="skeleton" style={{ height: 14, maxWidth: 260, marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 14, maxWidth: 200 }} />
            </div>
          ) : versions.error ? (
            <p className="error">{versions.error.message}</p>
          ) : !versions.data || versions.data.length === 0 ? (
            <p className="hint">還沒有歷史版本——這筆長文「更新內容」後，更新前的舊版會存到這裡。</p>
          ) : (
            <div>
              <p className="hint" style={{ marginBottom: 6 }}>
                共 {versions.data.length} 個歷史版本（最新在上，最多保留 20 版）。
              </p>
              {versions.data.map((v) => {
                const firstLine = v.preview.split("\n")[0]?.trim() || "（空白開頭）";
                return (
                  <div
                    key={v.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 0",
                      borderTop: "1px solid var(--border-soft)",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                      <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span className="badge">{new Date(v.createdAt).toLocaleString("zh-Hant")}</span>
                        {v.title && <span style={{ fontWeight: 600 }}>{v.title}</span>}
                        <span className="meta">{v.chars.toLocaleString()} 字</span>
                      </div>
                      <div
                        className="meta"
                        style={{
                          marginTop: 2,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {firstLine}
                      </div>
                    </div>
                    <ConfirmButton
                      triggerClassName="btn-sm"
                      triggerStyle={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                      disabled={restore.isPending}
                      message="還原此版本？目前內容會先自動存成一版（可再還原），再改回這個版本。"
                      confirmLabel="還原"
                      onConfirm={() => restore.mutate({ knowledgeId, versionId: v.id })}
                    >
                      <Icon name="RotateCcw" size={13} />
                      還原此版本
                    </ConfirmButton>
                  </div>
                );
              })}
              {restore.error && <p className="error">{restore.error.message}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
