import { useRef, useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { ConfirmButton } from "./interactions";
import { ReferenceImagePicker, type ReferenceImage } from "./ReferenceImagePicker";
import { AssetImg } from "./MediaFallback";

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
  // 冪等鍵（QA-003）：同一張「還沒建成功」的卡重試沿用同鍵，timeout 重按不建重複卡；成功才換新鍵
  const requestId = useRef<string>(crypto.randomUUID());
  const add = trpc.scenePresets.add.useMutation({
    onSuccess: () => {
      requestId.current = crypto.randomUUID();
      utils.scenePresets.list.invalidate({ projectId });
      setName(""); setPalette(""); setLighting(""); setRefImg(null); setOpen(false);
    },
  });
  const remove = trpc.scenePresets.remove.useMutation({ onSuccess: () => utils.scenePresets.list.invalidate({ projectId }) });
  // 既有卡改綁/清除參考圖：成功後收起該卡的選擇器
  const update = trpc.scenePresets.update.useMutation({
    onSuccess: () => {
      utils.scenePresets.list.invalidate({ projectId });
      setRefEditId(null);
    },
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [palette, setPalette] = useState("");
  const [lighting, setLighting] = useState("");
  /** 建卡時暫存的參考圖（上傳或素材庫挑選）；建立成功一併綁定 */
  const [refImg, setRefImg] = useState<ReferenceImage | null>(null);
  /** 正在編輯參考圖的既有卡 id（一次只開一張卡的選擇器） */
  const [refEditId, setRefEditId] = useState<string | null>(null);

  return (
    <section className="card" data-fb="場景設定卡">
      <h2>場景設定卡（色板・光線一致）</h2>
      <p className="hint">設定場景色板/光線一次鎖定；生成時勾選，AI 自動帶入，同場景跨鏡光影不跳。可上傳場景參考圖，或從素材庫綁定。</p>

      {list.isLoading ? (
        // 佔位高度對齊載入後的卡片網格（比照 CharacterCards）：不跳版、不被誤讀成「卡住了」
        <div className="asset-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }} aria-hidden="true">
          <div className="skeleton" style={{ height: 104 }} />
          <div className="skeleton" style={{ height: 104 }} />
        </div>
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
                {/* 場景參考圖縮圖：素材刪進回收桶時 referenceUrl 會是 null，縮圖自動消失；
                    URL 在但檔案遺失（後端 404）時顯示「參考圖遺失」佔位而非破圖 */}
                {s.referenceUrl && (
                  <AssetImg
                    src={s.referenceUrl}
                    alt={`${s.name} 的場景參考圖`}
                    loading="lazy"
                    style={{ width: "100%", height: 96, objectFit: "cover", borderRadius: 8, marginTop: 6, border: "1px solid var(--border-soft)" }}
                    fallbackLabel="參考圖遺失——可重新綁定"
                    fallbackHeight={96}
                    fallbackStyle={{ marginTop: 6 }}
                  />
                )}
                <div className="hint" style={{ fontSize: 12, marginTop: 4 }}><Icon name="Palette" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />{s.palette}</div>
                {s.lighting && <div className="hint" style={{ fontSize: 11, marginTop: 3 }}><Icon name="Lightbulb" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />{s.lighting}</div>}
                {refEditId === s.id ? (
                  <div style={{ marginTop: 6 }}>
                    <ReferenceImagePicker
                      projectId={projectId}
                      value={s.referenceAssetId && s.referenceUrl ? { id: s.referenceAssetId, url: s.referenceUrl, title: "場景參考圖" } : null}
                      onChange={(next) => update.mutate({ id: s.id, referenceAssetId: next?.id ?? null })}
                      disabled={update.isPending}
                    />
                    <button className="btn-ghost" style={{ marginTop: 4, fontSize: 11 }} onClick={() => setRefEditId(null)}>收起</button>
                  </div>
                ) : (
                  <button
                    className="btn-ghost"
                    style={{ marginTop: 6, fontSize: 11 }}
                    title="綁一張場景參考圖：上傳或從素材庫選，色板／光線比對更有依據"
                    onClick={() => setRefEditId(s.id)}
                  >
                    <Icon name="Image" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                    {s.referenceUrl ? "換參考圖" : "設參考圖"}
                  </button>
                )}
                <ConfirmButton
                  triggerStyle={{ padding: "2px 10px", fontSize: 11, marginTop: 6, color: "var(--danger-ink)" }}
                  disabled={remove.isPending}
                  onConfirm={() => remove.mutate({ id: s.id })}
                  message={`刪除場景「${s.name}」？`}
                  confirmLabel="刪除"
                >
                  刪除
                </ConfirmButton>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="hint" style={{ marginTop: 8 }}>還沒有場景——加一張（例：城市清晨＝暖色調、35mm 淺景深、柔和晨光斜射）。</p>
      )}

      {open ? (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
          <label htmlFor="preset-name">場景名</label>
          <input id="preset-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：城市清晨" />
          <label htmlFor="preset-palette">色板（主色調／配色，會注入生成）</label>
          <textarea id="preset-palette" value={palette} onChange={(e) => setPalette(e.target.value)} rows={2} placeholder="例：暖色調、米白與淡橘、低飽和" />
          <label htmlFor="preset-lighting">光線（選填）</label>
          <textarea id="preset-lighting" value={lighting} onChange={(e) => setLighting(e.target.value)} rows={2} placeholder="例：柔和晨光斜射、淺景深、35mm" />
          <label style={{ marginTop: 8 }}>場景參考圖（選填：上傳或從素材庫選）</label>
          <ReferenceImagePicker projectId={projectId} value={refImg} onChange={setRefImg} disabled={add.isPending} />
          <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
            <button className="primary" disabled={!name.trim() || !palette.trim() || add.isPending} onClick={() => add.mutate({ projectId, name: name.trim(), palette: palette.trim(), lighting: lighting.trim() || undefined, referenceAssetId: refImg?.id, clientRequestId: requestId.current })}>
              {add.isPending ? "建立中…" : "建立場景"}
            </button>
            <button onClick={() => setOpen(false)}>取消</button>
          </div>
          {add.error && <p className="error" role="alert">{add.error.message}</p>}
        </div>
      ) : (
        <button style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => setOpen(true)}><Icon name="Plus" /> 新增場景設定</button>
      )}
      {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
      {update.error && <p className="error" role="alert">參考圖更新失敗：{update.error.message}</p>}
    </section>
  );
}
