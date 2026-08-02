import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  MAX_GENERATE_PROPS,
  MAX_PROJECT_PROPS,
  PROP_APPEARANCE_MAX,
  PROP_NAME_MAX,
  PROP_NOTES_MAX,
} from "@shared/cardLimits";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { CharCount, ConfirmButton } from "./interactions";
import { ReferenceImagePicker, type ReferenceImage } from "./ReferenceImagePicker";
import { AssetImg } from "./MediaFallback";
import { Button, Card, EmptyState, Hint, Meta, Skeleton } from "./ui";

export { MAX_GENERATE_PROPS };

/**
 * 素材設定卡（「角色·場景一致性」缺的第三塊：物件）：
 * 反覆出現的道具／標誌物件（紅傘、佛珠、活動主視覺牌）外觀材質一次鎖定，
 * 生成時勾選 → 自動注入錨點，同一件東西跨鏡不變樣。
 *
 * 與下方「素材庫」不同：素材庫是已經存在的檔案，這裡是還沒被畫出來的物件設定。
 * readOnly（檢視者）：隱藏新增／刪除／編輯／設參考圖。
 */
export function PropCards({
  projectId,
  selectedIds,
  onToggle,
  readOnly = false,
  maxSelect = MAX_GENERATE_PROPS,
  onCreated,
}: {
  projectId: string;
  selectedIds: string[];
  onToggle: (id: string) => void;
  readOnly?: boolean;
  /** 生成時最多帶入幾張（與後端 max 對齊） */
  maxSelect?: number;
  /** 新建成功回呼（父層可自動勾選） */
  onCreated?: (id: string) => void;
}) {
  const utils = trpc.useUtils();
  const list = trpc.props.list.useQuery({ projectId });
  // 冪等鍵：同一張「還沒建成功」的卡重試沿用同鍵——timeout 後再按不會建出重複卡
  const requestId = useRef<string>(crypto.randomUUID());
  const add = trpc.props.add.useMutation({
    onSuccess: (row) => {
      requestId.current = crypto.randomUUID();
      utils.props.list.invalidate({ projectId });
      setName("");
      setAppearance("");
      setNotes("");
      setRefImg(null);
      setOpen(false);
      if (row?.id) onCreated?.(row.id);
    },
  });
  const remove = trpc.props.remove.useMutation({
    onSuccess: () => utils.props.list.invalidate({ projectId }),
  });
  const update = trpc.props.update.useMutation({
    onSuccess: () => {
      utils.props.list.invalidate({ projectId });
      setRefEditId(null);
      setTextEditId(null);
    },
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [appearance, setAppearance] = useState("");
  const [notes, setNotes] = useState("");
  const [refImg, setRefImg] = useState<ReferenceImage | null>(null);
  const [refEditId, setRefEditId] = useState<string | null>(null);
  /** 正在就地編輯文字欄的卡 id */
  const [textEditId, setTextEditId] = useState<string | null>(null);
  const atSelectMax = selectedIds.length >= maxSelect;
  const cardCount = list.data?.length ?? 0;
  const atProjectMax = cardCount >= MAX_PROJECT_PROPS;

  return (
    <Card as="section" data-fb="素材設定卡">
      <h2>素材設定卡（道具・物件一致）</h2>
      <Hint>
        反覆出現的道具／物件外觀材質一次鎖定；生成時勾選，AI 自動帶入，同一件東西跨鏡不變樣。
        外觀前段會注入畫面生成（過長會自動截短）；用途備註只給導演／助手，不會畫進畫面。
        {list.data && list.data.length > 0 && (
          <>
            {" "}
            · 已選 {selectedIds.length}/{maxSelect}
            {atSelectMax ? "（已達上限）" : ""}
            {" · "}共 {cardCount}/{MAX_PROJECT_PROPS} 張
          </>
        )}
      </Hint>

      {list.isLoading ? (
        <div className="asset-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          <Skeleton style={{ height: 104 }} />
          <Skeleton style={{ height: 104 }} />
        </div>
      ) : list.isError ? (
        <p className="error" role="alert" style={{ marginTop: 8 }}>
          素材設定清單暫時載入不了（不是資料不見了）——
          <Button variant="ghost" size="sm" style={{ marginLeft: "var(--sp-4)" }} onClick={() => list.refetch()}>
            再試一次
          </Button>
        </p>
      ) : list.data && list.data.length > 0 ? (
        <div className="asset-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {list.data.map((p) => {
            const on = selectedIds.includes(p.id);
            const selectDisabled = !on && atSelectMax;
            const refTrashed = Boolean(p.referenceAssetId && !p.referenceUrl);
            const editingText = textEditId === p.id;
            return (
              <div
                key={p.id}
                className="asset-cell"
                style={{
                  padding: "var(--sp-12)",
                  boxShadow: on ? "inset 0 0 0 2px var(--primary)" : undefined,
                  transition: "box-shadow var(--dur-fast)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.name}>
                    {p.name}
                  </strong>
                  <label
                    style={{
                      fontSize: "var(--fs-12)",
                      display: "flex",
                      gap: 4,
                      alignItems: "center",
                      flexShrink: 0,
                      cursor: selectDisabled ? "not-allowed" : "pointer",
                      opacity: selectDisabled ? 0.55 : 1,
                    }}
                    title={selectDisabled ? `最多帶入 ${maxSelect} 個素材設定——先取消其他勾選` : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={selectDisabled}
                      onChange={() => {
                        if (selectDisabled) return;
                        onToggle(p.id);
                      }}
                    />{" "}
                    生成時帶入
                  </label>
                </div>

                {p.referenceUrl && (
                  <AssetImg
                    src={p.referenceUrl}
                    alt={`${p.name} 的素材參考圖`}
                    loading="lazy"
                    style={{
                      width: "100%",
                      height: 96,
                      objectFit: "cover",
                      borderRadius: 8,
                      marginTop: 6,
                      border: "1px solid var(--border-soft)",
                    }}
                    fallbackLabel="參考圖遺失——可重新綁定"
                    fallbackHeight={96}
                    fallbackStyle={{ marginTop: 6 }}
                  />
                )}
                {refTrashed && (
                  <Meta as="div" role="status" style={{ fontSize: "var(--fs-11)", marginTop: 6, color: "var(--danger-ink)" }}>
                    參考圖已在回收桶（綁定仍在）——可清除綁定，或先還原素材
                    {!readOnly && (
                      <Button
                        variant="ghost"
                        size="sm"
                        style={{ marginLeft: 6, fontSize: "var(--fs-11)" }}
                        disabled={update.isPending}
                        onClick={() => update.mutate({ id: p.id, referenceAssetId: null })}
                      >
                        清除綁定
                      </Button>
                    )}
                  </Meta>
                )}

                {editingText && !readOnly ? (
                  <PropTextEditor
                    name={p.name}
                    appearance={p.appearance}
                    notes={p.notes ?? ""}
                    projectId={projectId}
                    reference={
                      p.referenceAssetId && p.referenceUrl
                        ? { id: p.referenceAssetId, url: p.referenceUrl, title: "素材參考圖" }
                        : null
                    }
                    pending={update.isPending}
                    error={update.error?.message}
                    onCancel={() => {
                      setTextEditId(null);
                      update.reset();
                    }}
                    onSave={(next) =>
                      update.mutate({
                        id: p.id,
                        name: next.name,
                        appearance: next.appearance,
                        notes: next.notes || null,
                        referenceAssetId: next.referenceAssetId,
                      })
                    }
                  />
                ) : (
                  <>
                    <Meta
                      as="div"
                      title={p.appearance}
                      style={{
                        fontSize: "var(--fs-12)",
                        marginTop: "var(--sp-4)",
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      <Icon name="Package" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                      {p.appearance}
                    </Meta>
                    {p.notes && (
                      <Meta
                        as="div"
                        title={p.notes}
                        style={{
                          fontSize: "var(--fs-11)",
                          marginTop: 3,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        <Icon name="FileText" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                        {p.notes}
                      </Meta>
                    )}
                  </>
                )}

                {!readOnly && !editingText && (
                  <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <Button
                      variant="ghost"
                      style={{ fontSize: "var(--fs-11)" }}
                      onClick={() => {
                        setTextEditId(p.id);
                        setRefEditId(null);
                      }}
                    >
                      <Icon name="Pencil" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                      編輯
                    </Button>
                    {refEditId === p.id ? (
                      <div style={{ flexBasis: "100%" }}>
                        <ReferenceImagePicker
                          projectId={projectId}
                          value={
                            p.referenceAssetId && p.referenceUrl
                              ? { id: p.referenceAssetId, url: p.referenceUrl, title: "素材參考圖" }
                              : null
                          }
                          onChange={(next) => update.mutate({ id: p.id, referenceAssetId: next?.id ?? null })}
                          disabled={update.isPending}
                        />
                        <Button variant="ghost" style={{ marginTop: 4, fontSize: "var(--fs-11)" }} onClick={() => setRefEditId(null)}>
                          收起
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        style={{ fontSize: "var(--fs-11)" }}
                        title="綁一張素材參考圖：上傳或從素材庫選。選「圖生圖／參考圖」類模型又沒挑來源時，會自動拿它當來源圖（角色、場景卡優先）"
                        onClick={() => {
                          setRefEditId(p.id);
                          setTextEditId(null);
                        }}
                      >
                        <Icon name="Image" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                        {p.referenceUrl ? "換參考圖" : refTrashed ? "重設參考圖" : "設參考圖"}
                      </Button>
                    )}
                    <ConfirmButton
                      onConfirm={() => remove.mutate({ id: p.id })}
                      message={`刪除素材「${p.name}」？刪後生成勾選會自動清掉。`}
                      triggerClassName="btn-ghost"
                      triggerStyle={{ color: "var(--danger-ink)", fontSize: "var(--fs-11)" }}
                      disabled={remove.isPending}
                    >
                      刪除
                    </ConfirmButton>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="還沒有素材設定"
          description="加一張道具卡（例：紅傘＝正紅色長柄傘、木質握把、傘面微舊）。"
          /* 與角色卡同理：範例要能一鍵建出來，不要只寫在說明裡讓人自己打 */
          action={
            readOnly ? undefined : (
              <Button
                variant="tonal"
                disabled={add.isPending || atProjectMax}
                onClick={() =>
                  add.mutate({
                    projectId,
                    name: "紅傘",
                    appearance: "正紅色長柄傘、木質握把、傘面微舊",
                    notes: "由範例建立，可再改",
                    clientRequestId: requestId.current,
                  })
                }
              >
                {add.isPending ? "建立中…" : "帶入這張範例卡"}
              </Button>
            )
          }
        />
      )}

      {!readOnly &&
        (open ? (
          <div style={{ marginTop: "var(--sp-12)", borderTop: "1px solid var(--border-soft)", paddingTop: "var(--sp-12)" }}>
            <label htmlFor="prop-name">素材名</label>
            <input
              id="prop-name"
              value={name}
              maxLength={PROP_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：紅傘"
              autoComplete="off"
            />
            <CharCount value={name} max={PROP_NAME_MAX} />
            <label htmlFor="prop-appearance">外觀・材質（會注入生成，越具體越一致）</label>
            <textarea
              id="prop-appearance"
              value={appearance}
              maxLength={PROP_APPEARANCE_MAX}
              onChange={(e) => setAppearance(e.target.value)}
              rows={3}
              placeholder="例：正紅色長柄傘、霧面傘布、木質握把、傘面微舊"
            />
            <CharCount value={appearance} max={PROP_APPEARANCE_MAX} />
            <label htmlFor="prop-notes">用途・出現場合（選填，供 AI 導演參考，不畫進畫面）</label>
            <textarea
              id="prop-notes"
              value={notes}
              maxLength={PROP_NOTES_MAX}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="例：安倢每次出場都帶著；雨停後收起夾在臂彎"
            />
            <CharCount value={notes} max={PROP_NOTES_MAX} />
            <label style={{ marginTop: 8 }}>素材參考圖（選填：上傳或從素材庫選）</label>
            <ReferenceImagePicker projectId={projectId} value={refImg} onChange={setRefImg} disabled={add.isPending} />
            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                className="primary"
                disabled={!name.trim() || !appearance.trim() || add.isPending || atProjectMax}
                onClick={() =>
                  add.mutate({
                    projectId,
                    name: name.trim(),
                    appearance: appearance.trim(),
                    notes: notes.trim() || undefined,
                    referenceAssetId: refImg?.id,
                    clientRequestId: requestId.current,
                  })
                }
              >
                {add.isPending ? "建立中…" : "建立素材設定"}
              </button>
              <button type="button" onClick={() => setOpen(false)}>
                取消
              </button>
            </div>
            {add.error && (
              <p className="error" role="alert">
                {add.error.message}
              </p>
            )}
          </div>
        ) : (
          <button
            type="button"
            style={{
              marginTop: "var(--sp-12)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              opacity: atProjectMax ? 0.55 : 1,
              cursor: atProjectMax ? "not-allowed" : undefined,
            }}
            disabled={atProjectMax}
            title={atProjectMax ? `已達每專案 ${MAX_PROJECT_PROPS} 張上限` : undefined}
            onClick={() => {
              if (atProjectMax) return;
              setOpen(true);
            }}
          >
            <Icon name="Plus" size={14} />
            {atProjectMax ? `已達上限（${MAX_PROJECT_PROPS}）` : "新增素材設定"}
          </button>
        ))}
      {remove.error && (
        <p className="error" role="alert">
          {remove.error.message}
        </p>
      )}
      {update.error && !textEditId && (
        <p className="error" role="alert">
          更新失敗：{update.error.message}
        </p>
      )}
    </Card>
  );
}

/** 就地編輯：名稱／外觀材質／用途，失焦不自動存——明確按儲存，避免半打字就送出 */
function PropTextEditor({
  name,
  appearance,
  notes,
  projectId,
  reference,
  pending,
  error,
  onSave,
  onCancel,
}: {
  name: string;
  appearance: string;
  notes: string;
  /** 參考圖挑選器要用（上傳／從本專案素材庫挑） */
  projectId: string;
  /** 目前綁定的參考圖；null＝還沒綁 */
  reference: ReferenceImage | null;
  pending: boolean;
  error?: string;
  onSave: (next: { name: string; appearance: string; notes: string; referenceAssetId: string | null }) => void;
  onCancel: () => void;
}) {
  const [n, setN] = useState(name);
  const [a, setA] = useState(appearance);
  const [note, setNote] = useState(notes);
  const [ref, setRef] = useState<ReferenceImage | null>(reference);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const canSave = n.trim().length > 0 && a.trim().length > 0 && !pending;

  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={editLabel}>素材名</label>
      <input ref={firstRef} value={n} maxLength={PROP_NAME_MAX} disabled={pending} onChange={(e) => setN(e.target.value)} />
      <label style={editLabel}>外觀・材質</label>
      <textarea value={a} maxLength={PROP_APPEARANCE_MAX} disabled={pending} rows={3} onChange={(e) => setA(e.target.value)} />
      <CharCount value={a} max={PROP_APPEARANCE_MAX} />
      <label style={editLabel}>用途・備註（選填）</label>
      <textarea value={note} maxLength={PROP_NOTES_MAX} disabled={pending} rows={2} onChange={(e) => setNote(e.target.value)} />
      <label style={editLabel}>素材參考圖（選填：上傳或從素材庫選）</label>
      <ReferenceImagePicker projectId={projectId} value={ref} onChange={setRef} disabled={pending} />
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          type="button"
          className="primary"
          disabled={!canSave}
          onClick={() =>
            onSave({ name: n.trim(), appearance: a.trim(), notes: note.trim(), referenceAssetId: ref?.id ?? null })
          }
        >
          {pending ? "儲存中…" : "儲存"}
        </button>
        <button type="button" disabled={pending} onClick={onCancel}>
          取消
        </button>
      </div>
      {error && (
        <p className="error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}

const editLabel: CSSProperties = { fontSize: "var(--fs-11)", margin: 0 };
