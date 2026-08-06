import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { Button, Hint } from "./ui";
import { FormatPicker } from "./FormatPicker";
import { OPTION_TYPE_META, type OptionType } from "@shared/options";
import { DEFAULT_PROJECT_FORMAT, type ProjectFormat } from "@shared/models";
import type { GroupOption } from "@shared/options";

/**
 * 選項就地新增（建立表單／工作台共用）。
 *
 * 為什麼：原本要新增一個「內容類型」或「發布平台」，得先離開手上的建立表單、
 * 繞去選單裡的「選項」頁、加完再走回來重填——中間所有已輸入的內容都白打。
 * 現在缺什麼就在缺的地方加，加完自動選上，全組立即可用。
 *
 * 權限：後端 options.upsert 仍限組長以上（呼叫端自行決定要不要渲染這顆鈕）。
 */
export function AddOptionInline({
  groupId,
  type,
  onAdded,
  buttonLabel,
}: {
  groupId: string;
  type: OptionType;
  /** 新增成功後回傳整筆選項（呼叫端通常會把它設為目前選取值） */
  onAdded: (option: GroupOption) => void;
  buttonLabel?: string;
}) {
  const utils = trpc.useUtils();
  const meta = OPTION_TYPE_META[type];
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [format, setFormat] = useState<ProjectFormat>(DEFAULT_PROJECT_FORMAT);
  const add = trpc.options.upsert.useMutation({
    onSuccess: (opt) => {
      utils.options.byGroup.invalidate();
      onAdded(opt);
      setLabel("");
      setOpen(false);
    },
  });

  const submit = () => {
    const l = label.trim();
    if (!l || add.isPending) return;
    add.mutate({ groupId, type, label: l, ...(meta.hasFormat ? { format } : {}) });
  };

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        type="button"
        title={`新增一個${meta.label}（全組共用；加完自動選上）`}
        onClick={() => setOpen(true)}
        style={{ marginTop: 6 }}
      >
        <Icon name="Plus" size={13} />{buttonLabel ?? `自己加一個${meta.label}`}
      </Button>
    );
  }

  return (
    <div
      style={{
        marginTop: 8,
        padding: "10px 12px",
        border: "1px solid var(--border-soft)",
        borderRadius: "var(--r-12)",
        background: "var(--card2)",
      }}
    >
      <Hint layer="always" style={{ marginTop: 0 }}>新增的{meta.label}全組共用，之後每次建立都選得到。</Hint>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
        <input
          autoFocus
          value={label}
          aria-label={`新增${meta.label}名稱`}
          placeholder={`例如：${meta.label === "發布平台" ? "IG 直式貼文" : "見證故事"}`}
          maxLength={60}
          disabled={add.isPending}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); submit(); }
            if (e.key === "Escape") { setOpen(false); setLabel(""); }
          }}
          style={{ flex: "1 1 180px", minWidth: 140 }}
        />
      </div>
      {meta.hasFormat && (
        <div style={{ marginTop: 8 }}>
          <Hint layer="always" style={{ marginTop: 0, fontWeight: 600 }}>這個平台的畫面尺寸</Hint>
          <FormatPicker value={format} onChange={setFormat} disabled={add.isPending} />
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Button size="sm" variant="primary" type="button" disabled={!label.trim() || add.isPending} onClick={submit}>
          {add.isPending ? "新增中…" : "加入"}
        </Button>
        <Button size="sm" type="button" disabled={add.isPending} onClick={() => { setOpen(false); setLabel(""); }}>
          取消
        </Button>
        {/* 改名／停用／排序這些少用的整理動作仍在整理頁；選單不再放它，改由這裡進入 */}
        <Link href="/options" className="m-touch" style={{ alignSelf: "center", fontSize: "var(--fs-12)" }}>整理全部選項</Link>
      </div>
      {add.error && <p className="error" role="alert">新增失敗：{add.error.message}</p>}
    </div>
  );
}
