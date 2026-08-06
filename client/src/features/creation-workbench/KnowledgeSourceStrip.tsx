import { useMemo, useState } from "react";
import { trpc } from "../../api";
import { focusAndReveal } from "../../lib/scrollIntoViewForChrome";
import { Button, Chip, Hint, Meta } from "../../components/ui";

const KIND_LABEL: Record<string, string> = {
  transcript: "開示",
  testimony: "見證",
  script: "腳本",
  note: "筆記",
};

/**
 * 工作台：勾選本次問 AI／多步開拍要優先注入的知識篇（寫入 creationDraft.knowledgeIds）。
 * 與代理卡 extraSourceIds 同語意；最多 20 篇。
 */
export function KnowledgeSourceStrip({
  projectId,
  selectedIds,
  onChange,
  disabled = false,
}: {
  projectId: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const list = trpc.knowledge.list.useQuery(
    { projectId, q: q.trim() || undefined },
    { enabled: open || selectedIds.length > 0 },
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const titleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of list.data ?? []) m.set(row.id, row.title);
    return m;
  }, [list.data]);

  const toggle = (id: string) => {
    if (disabled) return;
    if (selectedSet.has(id)) onChange(selectedIds.filter((x) => x !== id));
    else if (selectedIds.length < 20) onChange([...selectedIds, id]);
  };

  return (
    <div style={{ marginTop: 8, marginBottom: 4 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <Meta as="span" style={{ fontSize: 12 }}>
          本次知識優先
        </Meta>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "收合選單" : selectedIds.length ? `已選 ${selectedIds.length}` : "從知識庫勾選"}
        </Button>
        {selectedIds.length > 0 && !disabled && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>
            清空
          </Button>
        )}
      </div>
      {selectedIds.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
          {selectedIds.map((id) => (
            <Chip
              key={id}
              selected
              onClick={() => toggle(id)}
              title="點一下取消優先"
            >
              {titleById.get(id) ?? id.slice(0, 8)}
            </Chip>
          ))}
        </div>
      )}
      {open && (
        <div style={{ marginTop: 8, border: "1px solid var(--border-soft)", borderRadius: 8, padding: 8 }}>
          <input
            type="search"
            placeholder="搜尋標題／內容…"
            value={q}
            disabled={disabled}
            onFocus={(e) => focusAndReveal(e.currentTarget)}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: "100%", marginBottom: 8, fontSize: 13 }}
            aria-label="搜尋知識庫"
          />
          {list.isLoading ? (
            <Meta>載入中…</Meta>
          ) : list.isError ? (
            <p className="error">{list.error.message}</p>
          ) : !list.data?.length ? (
            <Hint layer="always">沒有符合的知識（可到專案知識庫新增或釘選）</Hint>
          ) : (
            <div style={{ maxHeight: 180, overflow: "auto", display: "grid", gap: 4 }}>
              {list.data.map((k) => {
                const on = selectedSet.has(k.id);
                const atMax = !on && selectedIds.length >= 20;
                return (
                  <label
                    key={k.id}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      fontSize: 13,
                      cursor: disabled || atMax ? "not-allowed" : "pointer",
                      opacity: atMax ? 0.5 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={disabled || atMax}
                      onChange={() => toggle(k.id)}
                    />
                    <span>
                      {k.pinned ? "📌 " : ""}
                      [{KIND_LABEL[k.kind] ?? k.kind}] {k.title}
                      <Meta as="span" style={{ marginLeft: 6 }}>
                        {k.chars.toLocaleString()} 字
                      </Meta>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <Hint style={{ marginTop: 6 }}>
            勾選後問 AI／排計畫會<strong>優先注入</strong>這些篇（最多 20）。可與知識庫「釘選」併用。
          </Hint>
        </div>
      )}
    </div>
  );
}
