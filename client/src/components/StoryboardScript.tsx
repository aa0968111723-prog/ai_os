import { useMemo, useState } from "react";
import {
  diffStoryboardScript,
  formatStoryboardScript,
  parseStoryboardScript,
  summarizeStoryboardScriptDiff,
  type StoryboardScriptRow,
} from "@shared/storyboardScript";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { Button, Card, Hint, Meta } from "./ui";

/**
 * 文字分鏡腳本：整份分鏡當一份文件來讀、來寫。
 *
 * 分鏡表適合「改某一鏡」，不適合「通讀一遍」或「一次把十二鏡寫完」——
 * 編劇的工作方式是寫一整份，不是填十二張表單。
 *
 * 寫回刻意保守（規則在 shared/storyboardScript.ts，伺服器再解析一次為準）：
 * 只更新與新增，永不刪除；文字裡省略的欄位維持原值。套用前先講清楚會動到什麼。
 */
export function StoryboardScript({
  projectId,
  rows,
  canEdit,
  onApplied,
}: {
  projectId: string;
  rows: StoryboardScriptRow[];
  canEdit: boolean;
  onApplied: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** 貼一份原始腳本讓 AI 拆成分鏡——標準模式先前只能繞去知識庫或助手對話 */
  const [rawScript, setRawScript] = useState<string | null>(null);
  const split = trpc.director.splitScript.useMutation({
    onSuccess: () => {
      setRawScript(null);
      onApplied();
    },
  });

  const current = useMemo(() => formatStoryboardScript(rows), [rows]);
  const editing = draft !== null;
  const text = draft ?? current;

  const apply = trpc.scenes.applyScript.useMutation({
    onSuccess: () => {
      setDraft(null);
      onApplied();
    },
  });

  // 差異在前端先算一次給人看；實際寫入以伺服器解析為準（前端這份只是預告）
  const parsed = useMemo(() => (editing ? parseStoryboardScript(text) : null), [editing, text]);
  const diff = useMemo(
    () => (parsed && !parsed.errors.length ? diffStoryboardScript(rows, parsed.scenes) : null),
    [parsed, rows],
  );

  const copy = () => {
    navigator.clipboard.writeText(current).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  };

  return (
    <Card as="section" variant="quiet" data-fb="文字分鏡腳本">
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <Icon name={open ? "ChevronUp" : "ChevronDown"} size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
          文字腳本
        </Button>
        <Meta as="span" style={{ fontSize: "var(--fs-11)" }}>
          {rows.length} 鏡・整份當文件讀或改
        </Meta>
        {open && (
          <>
            <Button variant="ghost" size="sm" onClick={copy} disabled={rows.length === 0}>
              <Icon name="Copy" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
              {copied ? "已複製" : "複製全文"}
            </Button>
            {canEdit && !editing && (
              rawScript === null ? (
                <Button variant="ghost" size="sm" onClick={() => setRawScript("")}>
                  <Icon name="Clapperboard" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                  貼腳本拆分鏡
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => { setRawScript(null); split.reset(); }}>
                  取消拆分鏡
                </Button>
              )
            )}
            {canEdit &&
              (editing ? (
                <Button variant="ghost" size="sm" onClick={() => { setDraft(null); apply.reset(); }}>
                  取消編輯
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setDraft(current)}>
                  <Icon name="Pencil" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                  編輯全文
                </Button>
              ))}
          </>
        )}
      </div>

      {open && rawScript !== null && canEdit && (
        <div style={{ marginTop: 8 }}>
          <label htmlFor="storyboard-raw-script">貼上原始腳本（AI 會切成一幕一幕，接在現有分鏡後面）</label>
          <textarea
            id="storyboard-raw-script"
            value={rawScript}
            onChange={(e) => setRawScript(e.target.value)}
            rows={8}
            placeholder="貼上完整腳本或開示稿；空白行分段。留空則改用知識庫裡的腳本。"
          />
          <Hint>
            拆出來的是草稿分鏡（含建議畫面提示詞與旁白），不會動到現有的鏡，也不會自動出圖。
            拆完可以在下方文字腳本裡整份微調。
          </Hint>
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Button
              variant="primary"
              size="sm"
              disabled={split.isPending}
              onClick={() => split.mutate({ projectId, scriptText: rawScript.trim() || undefined })}
            >
              {split.isPending ? "拆分鏡中…" : "AI 拆分鏡"}
            </Button>
            <Meta as="span" style={{ fontSize: "var(--fs-11)" }}>
              免費（走 NVIDIA NIM 額度，不扣點）
            </Meta>
          </div>
          {split.error && <p className="error" role="alert">拆分鏡失敗：{split.error.message}</p>}
          {split.data?.truncation && (
            <Hint layer="always" role="status" style={{ color: "var(--gold-ink)" }}>
              腳本過長，這次只送了前 {split.data.truncation.sentChars.toLocaleString()} 字
              （共 {split.data.truncation.totalChars.toLocaleString()} 字）——尾段沒有拆進來，可分批再拆一次。
            </Hint>
          )}
        </div>
      )}

      {open && (
        <div style={{ marginTop: 8 }}>
          {rows.length === 0 && !editing ? (
            <Hint layer="always">
              還沒有分鏡——上面「貼腳本拆分鏡」把腳本交給 AI 切幕，或到下方分鏡表新增一鏡，
              這裡就會出現整份可讀的文字腳本。
            </Hint>
          ) : editing ? (
            <>
              <textarea
                value={text}
                onChange={(e) => setDraft(e.target.value)}
                rows={18}
                spellCheck={false}
                aria-label="分鏡腳本全文"
                style={{ width: "100%", fontFamily: "var(--font-mono, monospace)", fontSize: "var(--fs-12)" }}
              />
              <Hint>
                每一鏡以「## 」開頭，例如「## 1. 開場 (5s)」；底下用「畫面：」「旁白：」。
                序號、秒數、任一區塊都可省略——**省略＝維持原值**，不會被清空。
                文字裡沒寫到的鏡會**保留不動**（要刪請用分鏡表的刪除鈕）。設定卡是唯讀標注，改文字不會動到綁定。
              </Hint>
              {parsed?.errors.length ? (
                <p className="error" role="alert">{parsed.errors.join("；")}</p>
              ) : null}
              {parsed?.warnings.length ? (
                <Hint layer="always" role="status" style={{ color: "var(--gold-ink)" }}>
                  {parsed.warnings.join("；")}
                </Hint>
              ) : null}
              <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={apply.isPending || !!parsed?.errors.length || !diff}
                  onClick={() => apply.mutate({ projectId, text })}
                >
                  {apply.isPending ? "寫回中…" : "寫回分鏡"}
                </Button>
                {diff && (
                  <Meta as="span" style={{ fontSize: "var(--fs-11)" }}>
                    將{summarizeStoryboardScriptDiff(diff)}
                  </Meta>
                )}
              </div>
              {apply.error && (
                <p className="error" role="alert">寫回失敗：{apply.error.message}</p>
              )}
            </>
          ) : (
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: "var(--fs-12)",
                maxHeight: 420,
                overflow: "auto",
              }}
            >
              {current}
            </pre>
          )}
        </div>
      )}
    </Card>
  );
}
