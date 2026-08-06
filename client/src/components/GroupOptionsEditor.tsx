import { useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { ConfirmButton } from "./interactions";
import { Card, Chip, Hint, Skeleton } from "./ui";
import { FormatPicker, FormatSwatch } from "./FormatPicker";
import {
  OPTION_TYPES,
  OPTION_TYPE_META,
  PLATFORM_FORMATS,
  type OptionType,
  type GroupOption,
} from "@shared/options";

/**
 * 組選項編輯器（R23）：讓組長／管理員自訂「這一組」建專案與生成時可挑的選項
 * （內容類型、發布平台、調性、主軸、視覺風格）。頁面層級由 App 守門，這裡專注編輯。
 */
export function GroupOptionsEditor({ groupId }: { groupId: string }) {
  const utils = trpc.useUtils();
  // 全失效較穩：byGroup 有 active-only 與 includeInactive 兩種快取，改動後兩份都要重讀。
  const refresh = () => utils.options.byGroup.invalidate();

  const list = trpc.options.byGroup.useQuery({ groupId, includeInactive: true });
  const upsert = trpc.options.upsert.useMutation({ onSuccess: refresh });
  const setActive = trpc.options.setActive.useMutation({ onSuccess: refresh });
  const remove = trpc.options.remove.useMutation({ onSuccess: refresh });
  const reorder = trpc.options.reorder.useMutation({ onSuccess: refresh });

  // 任一動作進行中就擋住列上的按鈕，避免連點造成排序 / 狀態打架。
  const busy = upsert.isPending || setActive.isPending || remove.isPending || reorder.isPending;
  const actionError = upsert.error ?? setActive.error ?? remove.error ?? reorder.error;

  const rowsOf = (type: OptionType) => (list.data ?? []).filter((o) => o.type === type);

  // 依「目前顯示序（active＋inactive 混排）」組 orderedIds，交換相鄰兩筆後送出。
  const move = (type: OptionType, index: number, dir: -1 | 1) => {
    const rows = rowsOf(type);
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const ids = rows.map((o) => o.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate({ groupId, type, orderedIds: ids });
  };

  // 更新既有選項：平台類一律帶回目前比例，避免只改名字時把比例清掉。
  const editOption = (o: GroupOption, patch: { label?: string; format?: string }) => {
    const isPlatform = OPTION_TYPE_META[o.type].hasFormat;
    upsert.mutate({
      groupId,
      id: o.id,
      type: o.type,
      label: patch.label ?? o.label,
      ...(isPlatform ? { format: patch.format ?? o.format ?? PLATFORM_FORMATS[0] } : {}),
    });
  };

  if (list.isLoading) {
    return (
      <>
        <Card as="section" data-fb="組選項編輯器">
          <div aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="gen-row">
                <Skeleton style={{ height: 14 }} />
              </div>
            ))}
          </div>
        </Card>
      </>
    );
  }
  if (list.error) {
    return (
      <>
        <Card as="section" data-fb="組選項編輯器">
          <p className="error">
            選項載入失敗：{list.error.message}
            <button style={{ marginLeft: 8, padding: "3px 12px", fontSize: "var(--fs-12)" }} onClick={() => list.refetch()}>
              重試
            </button>
          </p>
        </Card>
      </>
    );
  }

  return (
    <>
    <Card as="section" data-fb="組選項編輯器">
      <h2>這一組的選項</h2>
      <Hint>
        這裡調整的是「你這個組」建專案與生成時能挑的選項；只有組長或管理員進得來，改完全組立即生效。
        停用的選項不會出現在挑選處，但保留紀錄、隨時可再啟用。
      </Hint>

      {OPTION_TYPES.map((type) => {
        const meta = OPTION_TYPE_META[type];
        const rows = rowsOf(type);
        return (
          <div key={type} style={{ marginTop: 20, borderTop: "1px solid var(--border-soft)", paddingTop: 14 }}>
            <div style={{ fontWeight: 600, fontSize: "var(--fs-15)" }}>{meta.label}</div>
            <Hint style={{ marginTop: 2 }}>{meta.hint}</Hint>

            {rows.length === 0 ? (
              <Hint layer="always" style={{ marginTop: 8 }}>還沒有選項——用下面的欄位加一個。</Hint>
            ) : (
              <div style={{ marginTop: 8 }}>
                {rows.map((o, i) => (
                  <div
                    key={o.id}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap",
                      border: "1px solid var(--border-soft)",
                      borderRadius: "var(--r-12)",
                      padding: "8px 12px",
                      marginTop: 8,
                      background: o.active ? "var(--card)" : "var(--card2)",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <button
                        aria-label="上移"
                        title="上移"
                        disabled={busy || i === 0}
                        onClick={() => move(type, i, -1)}
                        style={{ padding: "0 8px", fontSize: "var(--fs-12)", lineHeight: "18px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                      >
                        <Icon name="ChevronUp" size={14} />
                      </button>
                      <button
                        aria-label="下移"
                        title="下移"
                        disabled={busy || i === rows.length - 1}
                        onClick={() => move(type, i, 1)}
                        style={{ padding: "0 8px", fontSize: "var(--fs-12)", lineHeight: "18px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                      >
                        <Icon name="ChevronDown" size={14} />
                      </button>
                    </div>

                    <EditableLabel
                      key={o.label}
                      value={o.label}
                      onCommit={(next) => editOption(o, { label: next })}
                    />

                    {meta.hasFormat && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "none" }}>
                        {/* 小方框：一眼看出這個平台是橫的、直的還是方的（純數字比例對非技術夥伴不直觀） */}
                        <FormatSwatch format={o.format} box={20} />
                        <select
                          aria-label="畫面比例"
                          value={o.format ?? PLATFORM_FORMATS[0]}
                          disabled={busy}
                          onChange={(e) => editOption(o, { format: e.target.value })}
                          style={{ width: 92, flex: "none" }}
                        >
                          {PLATFORM_FORMATS.map((f) => (
                            <option key={f} value={f}>{f}</option>
                          ))}
                        </select>
                      </span>
                    )}

                    {!o.active && <Chip>停用中</Chip>}

                    <button
                      disabled={busy}
                      onClick={() => setActive.mutate({ id: o.id, active: !o.active })}
                      style={{ padding: "3px 12px", fontSize: "var(--fs-12)", flex: "none" }}
                    >
                      {o.active ? "停用" : "啟用"}
                    </button>
                    <ConfirmButton
                      onConfirm={() => remove.mutate({ id: o.id })}
                      message={`刪除選項「${o.label}」？`}
                      confirmLabel="刪除"
                      disabled={busy}
                      triggerStyle={{ padding: "3px 12px", fontSize: "var(--fs-12)", color: "var(--danger-ink)", flex: "none" }}
                    >
                      刪除
                    </ConfirmButton>
                  </div>
                ))}
              </div>
            )}

            <AddRow groupId={groupId} type={type} onRefresh={refresh} />
          </div>
        );
      })}

      {actionError && <p className="error">動作沒完成：{actionError.message}</p>}
    </Card>
    </>
  );
}

/** 單列名稱的行內編輯：改完按 Enter 或點別處就存；Esc 還原。空白或沒改不送出。 */
function EditableLabel({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const next = draft.trim();
    if (!next || next === value) {
      setDraft(value);
      return;
    }
    onCommit(next);
  };
  return (
    <input
      value={draft}
      aria-label="選項名稱"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      style={{ flex: "1 1 150px", minWidth: 120 }}
    />
  );
}

/** 每區底部的「＋新增」：自帶送出狀態，成功後清空欄位、刷新清單。 */
function AddRow({ groupId, type, onRefresh }: { groupId: string; type: OptionType; onRefresh: () => void }) {
  const meta = OPTION_TYPE_META[type];
  const [label, setLabel] = useState("");
  const [format, setFormat] = useState<string>(PLATFORM_FORMATS[0]);
  const add = trpc.options.upsert.useMutation({
    onSuccess: () => {
      onRefresh();
      setLabel("");
      setFormat(PLATFORM_FORMATS[0]);
    },
  });

  const submit = () => {
    const l = label.trim();
    if (!l || add.isPending) return;
    add.mutate({ groupId, type, label: l, ...(meta.hasFormat ? { format } : {}) });
  };

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={label}
          aria-label={`新增${meta.label}`}
          placeholder={`新增${meta.label}…`}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          style={{ flex: "1 1 150px", minWidth: 120 }}
        />
        <button
          className="primary"
          disabled={!label.trim() || add.isPending}
          onClick={submit}
          style={{ padding: "6px 16px", fontSize: "var(--fs-13)", flex: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          {add.isPending ? "新增中…" : <><Icon name="Plus" size={14} />新增</>}
        </button>
        {add.error && <span className="error" style={{ marginTop: 0 }}>新增失敗：{add.error.message}</span>}
      </div>
      {/* 平台要挑畫面尺寸：改用等比例小圖，模型支援的比例全都在（原本只有三個數字下拉） */}
      {meta.hasFormat && (
        <div style={{ marginTop: 8 }}>
          <Hint layer="always" id={`add-format-${type}`} style={{ marginTop: 0, fontWeight: 600 }}>畫面尺寸</Hint>
          <FormatPicker
            value={format}
            onChange={(f) => setFormat(f)}
            labelledBy={`add-format-${type}`}
            disabled={add.isPending}
          />
        </div>
      )}
    </div>
  );
}
