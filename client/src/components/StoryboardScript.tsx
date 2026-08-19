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
import { ConfirmButton } from "./interactions";
import { Button, Card, Hint, Meta } from "./ui";

/**
 * 逐格預覽最多列幾條。清單長到要捲就沒人讀了，剩下的收成「還有 N 鏡」——
 * 重點是讓人看見「動到的是哪幾格」，不是把全部倒出來。
 */
const PREVIEW_MAX = 10;

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
    onSuccess: (data) => {
      // 有截斷就把面板留著：尾段沒拆進來這件事只顯示在面板裡，收掉等於沒講。
      // 原文也留著，好讓人刪掉已拆的前段再拆一次。
      if (!data?.truncation) setRawScript(null);
      onApplied();
    },
  });

  /**
   * 寫回時要一起送出的分鏡指紋。
   *
   * rows 是投影過的文字欄位，沒有 id，而寫回是拿「鏡次／位置」對格的——夥伴在使用者編輯期間
   * 刪掉中間一格，第 3 鏡的文字就會落到原本的第 4 鏡上（見 scenes.applyScript 的 expectedSceneIds）。
   * 這裡讀的是與 SceneList 同一把 query key 的同一份快取（不會多打 API），
   * 拿到的正是產生 rows 的那份清單。
   */
  const sceneIds = trpc.scenes.listByProject.useQuery({ projectId }).data?.map((s) => s.id);

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
                <Button variant="ghost" size="sm" onClick={() => { apply.reset(); setDraft(current); }}>
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
            <Hint role="status" style={{ color: "var(--gold-ink)" }}>
              腳本過長，這次只送了前 {split.data.truncation.sentChars.toLocaleString()} 字
              （共 {split.data.truncation.totalChars.toLocaleString()} 字）——尾段沒有拆進來。
              原文留在上面沒清掉：刪掉已經拆好的前段，再按一次就能接著拆。
            </Hint>
          )}
        </div>
      )}

      {open && (
        <div style={{ marginTop: 8 }}>
          {rows.length === 0 && !editing ? (
            <Hint>
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
                每一鏡以「## 」開頭，例如「## 1. 開場 (5s)」；底下用「畫面：」「旁白：」「環境音：」。
                序號、秒數、任一區塊都可省略——**省略＝維持原值**，不會被清空。
                文字裡沒寫到的鏡會**保留不動**（要刪請用分鏡表的刪除鈕）。
                <br />
                {/* Live leftover: this help still taught 七幕 安倢／紅傘, not A–F. */}
                卡片用名字寫：「角色卡：小華・禪定龜龜」「場景卡：淡大校門口」「素材卡：禪學社圓標」。
                名字有一個對不上就<b>整行不套用</b>並告訴你是哪一個；留白＝維持原本綁定，
                要解除請寫「角色卡：無」。
              </Hint>
              {parsed?.errors.length ? (
                <p className="error" role="alert">{parsed.errors.join("；")}</p>
              ) : null}
              {parsed?.warnings.length ? (
                <Hint role="status" style={{ color: "var(--gold-ink)" }}>
                  {parsed.warnings.join("；")}
                </Hint>
              ) : null}
              {/*
                逐格列出要被蓋掉的鏡。「將更新 12 鏡」這種數字看不出動到哪幾格——
                而這一按會把夥伴剛寫進那幾格的字整批覆蓋，且沒有回收桶可還原。
                要人為覆蓋負責，就得先讓人看得見自己在覆蓋什麼。
              */}
              {diff && diff.updated.length > 0 && (
                <ul
                  aria-label="將被覆蓋的分鏡"
                  style={{ margin: "6px 0 0", paddingInlineStart: 18, listStyle: "disc" }}
                >
                  {/* 列的是**現況**標題（rows），不是文字裡的新標題：整份重貼時標題多半也改了，
                      印新名字等於在「將被覆蓋」底下寫一串分鏡表上根本不存在的鏡名，
                      使用者對不出自己要蓋掉的是哪幾格。標題本身也要改就補上「→ 新名」。 */}
                  {diff.updated.slice(0, PREVIEW_MAX).map((u) => {
                    const from = rows[u.index]?.title;
                    return (
                      <li key={u.index}>
                        <Meta as="span" style={{ fontSize: "var(--fs-11)" }}>
                          第 {u.index + 1} 鏡・{from ?? u.title}
                          {/* u.title 為空＝這一鏡的標題留空（維持原值），不是改名，別畫箭頭 */}
                          {from !== undefined && u.title && from !== u.title ? ` → ${u.title}` : ""}
                        </Meta>
                      </li>
                    );
                  })}
                  {diff.updated.length > PREVIEW_MAX && (
                    <li>
                      <Meta as="span" style={{ fontSize: "var(--fs-11)" }}>
                        還有 {diff.updated.length - PREVIEW_MAX} 鏡
                      </Meta>
                    </li>
                  )}
                </ul>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                {/*
                  整批寫回是站內唯一沒有確認就執行的破壞性操作，可是它一次覆寫十幾鏡：
                  破壞力遠大於刪一格，而刪一格反而有確認框（SceneList 的刪除鈕）。
                  刪掉的還能從回收桶還原，被覆蓋掉的字則是真的沒了——這裡更需要那道確認。
                  動到哪幾鏡由上面的逐格清單與旁邊的摘要交代，確認框只補那件清單講不了的事。
                */}
                {apply.isPending ? (
                  <Button variant="primary" size="sm" disabled>寫回中…</Button>
                ) : (
                  <ConfirmButton
                    // key 綁全文：ConfirmButton 的 disabled 只在「還沒按下第一段」時求值，
                    // armed 之後繼續打字不會再把關——確認框旁邊還掛著舊 text 算出來的清單，
                    // 送出的卻是新的（甚至是解析不過、清單整個消失的那份）。
                    // 換 key 讓它重新掛載＝草稿一動就收掉確認：使用者確認的一定是他看到的那一份。
                    key={text}
                    triggerClassName="primary btn-sm"
                    disabled={!!parsed?.errors.length || !diff}
                    message="被覆蓋掉的字沒有回收桶可還原，確定寫回？"
                    confirmLabel="確認寫回"
                    onConfirm={() => apply.mutate({ projectId, text, expectedSceneIds: sceneIds })}
                  >
                    寫回分鏡
                  </ConfirmButton>
                )}
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
          {/*
            伺服器才知道的事要講出來：卡片名字對不上時整行不套用，而寫回一成功編輯框就收掉了。
            不顯示這一則的話，使用者看到的只有「寫回成功」，他寫的角色卻一個都沒進去。
          */}
          {apply.data?.warnings?.length ? (
            <Hint role="status" style={{ color: "var(--gold-ink)" }}>
              寫回完成，但有幾行沒有照做：{apply.data.warnings.join("；")}
            </Hint>
          ) : null}
        </div>
      )}
    </Card>
  );
}
