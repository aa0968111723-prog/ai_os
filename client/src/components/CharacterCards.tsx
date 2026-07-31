import { useRef, useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { ConfirmButton } from "./interactions";
import { ReferenceImagePicker, type ReferenceImage } from "./ReferenceImagePicker";
import { AssetImg } from "./MediaFallback";
import { Button, Card, Hint, Meta, Skeleton } from "./ui";
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
  // 冪等鍵（QA-003）：同一張「還沒建成功」的卡重試沿用同鍵——timeout 後再按不會建出重複卡；
  // 成功才換新鍵（下一張卡）
  const requestId = useRef<string>(crypto.randomUUID());
  const add = trpc.characters.add.useMutation({
    onSuccess: () => {
      requestId.current = crypto.randomUUID();
      utils.characters.list.invalidate({ projectId });
      setName(""); setAppearance(""); setNotes(""); setRefImg(null); setOpen(false);
    },
  });
  const remove = trpc.characters.remove.useMutation({ onSuccess: () => utils.characters.list.invalidate({ projectId }) });
  // 既有卡改綁/清除參考圖：成功後收起該卡的選擇器
  const update = trpc.characters.update.useMutation({
    onSuccess: () => {
      utils.characters.list.invalidate({ projectId });
      setRefEditId(null);
    },
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [appearance, setAppearance] = useState("");
  const [notes, setNotes] = useState("");
  /** 建卡時暫存的參考圖（上傳或素材庫挑選）；建立成功一併綁定 */
  const [refImg, setRefImg] = useState<ReferenceImage | null>(null);
  /** 正在編輯參考圖的既有卡 id（一次只開一張卡的選擇器） */
  const [refEditId, setRefEditId] = useState<string | null>(null);

  return (
    <Card as="section" data-fb="角色定裝卡">
      <h2>角色定裝卡（跨鏡一致）</h2>
      <Hint>設定角色外觀一次鎖定；生成時勾選角色，AI 自動帶入外觀，跨鏡頭不走樣。可上傳定裝參考圖，或從素材庫綁定。</Hint>

      {list.isLoading ? (
        <div className="asset-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          <Skeleton style={{ height: 104 }} />
          <Skeleton style={{ height: 104 }} />
        </div>
      ) : list.isError ? (
        <p className="error" role="alert" style={{ marginTop: 8 }}>
          角色清單暫時載入不了（不是資料不見了）——
          <Button variant="ghost" size="sm" style={{ marginLeft: "var(--sp-4)" }} onClick={() => list.refetch()}>
            再試一次
          </Button>
        </p>
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
                {/* 定裝參考圖縮圖：素材刪進回收桶時 referenceUrl 會是 null，縮圖自動消失；
                    URL 在但檔案遺失（後端 404）時顯示「參考圖遺失」佔位而非破圖 */}
                {c.referenceUrl && (
                  <AssetImg
                    src={c.referenceUrl}
                    alt={`${c.name} 的定裝參考圖`}
                    loading="lazy"
                    style={{ width: "100%", height: 96, objectFit: "cover", borderRadius: 8, marginTop: 6, border: "1px solid var(--border-soft)" }}
                    fallbackLabel="參考圖遺失——可重新綁定"
                    fallbackHeight={96}
                    fallbackStyle={{ marginTop: 6 }}
                  />
                )}
                <Meta as="div" style={{ fontSize: "var(--fs-12)", marginTop: "var(--sp-4)" }}><Icon name="User" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />{c.appearance}</Meta>
                {c.notes && <Meta as="div" style={{ fontSize: "var(--fs-11)", marginTop: 3 }}><Icon name="FileText" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />{c.notes}</Meta>}
                {refEditId === c.id ? (
                  <div style={{ marginTop: 6 }}>
                    <ReferenceImagePicker
                      projectId={projectId}
                      value={c.referenceAssetId && c.referenceUrl ? { id: c.referenceAssetId, url: c.referenceUrl, title: "定裝參考圖" } : null}
                      onChange={(next) => update.mutate({ id: c.id, referenceAssetId: next?.id ?? null })}
                      disabled={update.isPending}
                    />
                    <Button variant="ghost" style={{ marginTop: 4, fontSize: "var(--fs-11)" }} onClick={() => setRefEditId(null)}>收起</Button>
                  </div>
                ) : (
                  <Button variant="ghost"
                    style={{ marginTop: 6, fontSize: "var(--fs-11)" }}
                    title="綁一張定裝參考圖：上傳或從素材庫選，跨鏡比對更有依據"
                    onClick={() => setRefEditId(c.id)}>
                    <Icon name="Image" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                    {c.referenceUrl ? "換參考圖" : "設參考圖"}
                  </Button>
                )}
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
          <label style={{ marginTop: 8 }}>定裝參考圖（選填：上傳或從素材庫選）</label>
          <ReferenceImagePicker projectId={projectId} value={refImg} onChange={setRefImg} disabled={add.isPending} />
          <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
            <button className="primary" disabled={!name.trim() || !appearance.trim() || add.isPending} onClick={() => add.mutate({ projectId, name: name.trim(), appearance: appearance.trim(), notes: notes.trim() || undefined, referenceAssetId: refImg?.id, clientRequestId: requestId.current })}>
              {add.isPending ? "建立中…" : "建立角色"}
            </button>
            <button onClick={() => setOpen(false)}>取消</button>
          </div>
          {add.error && <p className="error">{add.error.message}</p>}
        </div>
      ) : (
        <button style={{ marginTop: "var(--sp-12)", display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => setOpen(true)}>
          <Icon name="Plus" size={14} />新增角色定裝
        </button>
      )}
      {remove.error && <p className="error">{remove.error.message}</p>}
      {update.error && <p className="error" role="alert">參考圖更新失敗：{update.error.message}</p>}
    </Card>
  );
}
