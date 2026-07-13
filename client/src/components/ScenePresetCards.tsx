import { useState } from "react";
import { trpc } from "../api";

/**
 * 場景設定卡（提案核心「場景一致性」）：
 * 色板/光線設定一次鎖定，生成勾選 → 自動注入錨點，同場景跨鏡光影一致。
 */
export function ScenePresetCards({
  projectId,
  selectedIds,
  onToggle,
}: {
  projectId: string;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const utils = trpc.useUtils();
  const list = trpc.scenePresets.list.useQuery({ projectId });
  const add = trpc.scenePresets.add.useMutation({
    onSuccess: () => {
      utils.scenePresets.list.invalidate({ projectId });
      setName(""); setPalette(""); setLighting(""); setOpen(false);
    },
  });
  const remove = trpc.scenePresets.remove.useMutation({ onSuccess: () => utils.scenePresets.list.invalidate({ projectId }) });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [palette, setPalette] = useState("");
  const [lighting, setLighting] = useState("");

  return (
    <section className="card" data-fb="場景設定卡">
      <h2>場景設定卡（色板・光線一致）</h2>
      <p className="hint">設定場景色板/光線一次鎖定；生成時勾選，AI 自動帶入，同場景跨鏡光影不跳。</p>

      {list.isLoading ? (
        <p className="hint">載入中…</p>
      ) : list.data && list.data.length > 0 ? (
        <div className="asset-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {list.data.map((s) => {
            const on = selectedIds.includes(s.id);
            return (
              <div key={s.id} className="asset-cell" style={{ padding: 12, border: on ? "2px solid var(--primary)" : undefined }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>{s.name}</strong>
                  <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
                    <input type="checkbox" checked={on} onChange={() => onToggle(s.id)} /> 生成時帶入
                  </label>
                </div>
                <div className="hint" style={{ fontSize: 12, marginTop: 4 }}>🎨 {s.palette}</div>
                {s.lighting && <div className="hint" style={{ fontSize: 11, marginTop: 3 }}>💡 {s.lighting}</div>}
                <button
                  style={{ padding: "2px 10px", fontSize: 11, marginTop: 6, color: "var(--danger)" }}
                  disabled={remove.isPending}
                  onClick={() => window.confirm(`刪除場景「${s.name}」？`) && remove.mutate({ id: s.id })}
                >
                  刪除
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="hint" style={{ marginTop: 8 }}>還沒有場景——加一張（例：城市清晨＝暖色調、35mm 淺景深、柔和晨光斜射）。</p>
      )}

      {open ? (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
          <label>場景名</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：城市清晨" />
          <label>色板（主色調／配色，會注入生成）</label>
          <textarea value={palette} onChange={(e) => setPalette(e.target.value)} rows={2} placeholder="例：暖色調、米白與淡橘、低飽和" />
          <label>光線（選填）</label>
          <textarea value={lighting} onChange={(e) => setLighting(e.target.value)} rows={2} placeholder="例：柔和晨光斜射、淺景深、35mm" />
          <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
            <button className="primary" disabled={!name.trim() || !palette.trim() || add.isPending} onClick={() => add.mutate({ projectId, name: name.trim(), palette: palette.trim(), lighting: lighting.trim() || undefined })}>
              {add.isPending ? "建立中…" : "建立場景"}
            </button>
            <button onClick={() => setOpen(false)}>取消</button>
          </div>
          {add.error && <p className="error">{add.error.message}</p>}
        </div>
      ) : (
        <button style={{ marginTop: 12 }} onClick={() => setOpen(true)}>＋ 新增場景設定</button>
      )}
      {remove.error && <p className="error">{remove.error.message}</p>}
    </section>
  );
}
