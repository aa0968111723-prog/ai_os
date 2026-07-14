import { useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { ConfirmButton } from "./interactions";

/**
 * 角色定裝卡（提案核心「角色一致性」）：
 * 角色外觀設定一次鎖定，生成時勾選 → 自動注入錨點，跨鏡頭不走樣。
 */
export function CharacterCards({
  projectId,
  selectedIds,
  onToggle,
}: {
  projectId: string;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const utils = trpc.useUtils();
  const list = trpc.characters.list.useQuery({ projectId });
  const add = trpc.characters.add.useMutation({
    onSuccess: () => {
      utils.characters.list.invalidate({ projectId });
      setName(""); setAppearance(""); setNotes(""); setOpen(false);
    },
  });
  const remove = trpc.characters.remove.useMutation({ onSuccess: () => utils.characters.list.invalidate({ projectId }) });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [appearance, setAppearance] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <section className="card" data-fb="角色定裝卡">
      <h2>角色定裝卡（跨鏡一致）</h2>
      <p className="hint">設定角色外觀一次鎖定；生成時勾選角色，AI 自動帶入外觀，跨鏡頭不走樣。</p>

      {list.isLoading ? (
        <div className="asset-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          <div className="skeleton" style={{ height: 104 }} />
          <div className="skeleton" style={{ height: 104 }} />
        </div>
      ) : list.data && list.data.length > 0 ? (
        <div className="asset-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {list.data.map((c) => {
            const on = selectedIds.includes(c.id);
            return (
              <div key={c.id} className="asset-cell" style={{ padding: "var(--sp-12)", boxShadow: on ? "inset 0 0 0 2px var(--primary)" : undefined, transition: "box-shadow var(--dur-fast)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>{c.name}</strong>
                  <label style={{ fontSize: "var(--fs-12)", display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
                    <input type="checkbox" checked={on} onChange={() => onToggle(c.id)} /> 生成時帶入
                  </label>
                </div>
                <div className="hint" style={{ fontSize: "var(--fs-12)", marginTop: "var(--sp-4)" }}><Icon name="User" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />{c.appearance}</div>
                {c.notes && <div className="hint" style={{ fontSize: "var(--fs-11)", marginTop: 3 }}><Icon name="FileText" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />{c.notes}</div>}
                <ConfirmButton
                  onConfirm={() => remove.mutate({ id: c.id })}
                  message={`刪除角色「${c.name}」`}
                  triggerClassName="btn-ghost"
                  triggerStyle={{ marginTop: 6, color: "var(--danger-ink)" }}
                  disabled={remove.isPending}
                >
                  刪除
                </ConfirmButton>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <p>還沒有角色——加一張定裝卡（例：安倢＝紅傘、米白外套、帆布包、溫柔回望）。</p>
        </div>
      )}

      {open ? (
        <div style={{ marginTop: "var(--sp-12)", borderTop: "1px solid var(--border-soft)", paddingTop: "var(--sp-12)" }}>
          <label htmlFor="char-name">角色名</label>
          <input id="char-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：安倢" />
          <label htmlFor="char-appearance">外觀（會注入生成，越具體越一致）</label>
          <textarea id="char-appearance" value={appearance} onChange={(e) => setAppearance(e.target.value)} rows={2} placeholder="例：紅色雨傘、米白外套、帆布包、無眼鏡、溫柔回望" />
          <label htmlFor="char-notes">個性・語氣・關係（選填，供 AI 導演參考，不畫進畫面）</label>
          <textarea id="char-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="例：安靜溫柔，與慕恩是同社團學姐" />
          <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
            <button className="primary" disabled={!name.trim() || !appearance.trim() || add.isPending} onClick={() => add.mutate({ projectId, name: name.trim(), appearance: appearance.trim(), notes: notes.trim() || undefined })}>
              {add.isPending ? "建立中…" : "建立角色"}
            </button>
            <button onClick={() => setOpen(false)}>取消</button>
          </div>
          {add.error && <p className="error">{add.error.message}</p>}
        </div>
      ) : (
        <button style={{ marginTop: "var(--sp-12)" }} onClick={() => setOpen(true)}>＋ 新增角色定裝</button>
      )}
      {remove.error && <p className="error">{remove.error.message}</p>}
    </section>
  );
}
