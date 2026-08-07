import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { useRovingRadio } from "../components/interactions";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";
import { Card, Chip, Hint, Skeleton } from "../components/ui";
const ITEMS: Array<{ key: string; label: string }> = [
  { key: "context", label: "AI 懂不懂我們的素材（不用重複解釋）" },
  { key: "cost", label: "額度夠用、花費看得懂" },
  { key: "collab", label: "協作比試算表好用" },
  { key: "ai", label: "AI 導演的 idea 有沒有用" },
  { key: "daily", label: "能融入平常剪輯流程" },
  { key: "usability", label: "不用教也會用" },
];

/** 測試回饋（6 題評分＋優缺點/備註文字）；一人一組一份，之前填過就預填、重送＝修改 */
export function FeedbackPage({ groupId }: { groupId?: string }) {
  const mine = trpc.feedback.mine.useQuery({ groupId });

  // 等既有回饋載入完再掛表單：預填走 useState 初始值，不用 effect 事後回填（避免表單先空白再跳成舊值）
  if (mine.isLoading)
    return (
      <div style={{ maxWidth: 620, margin: "0 auto" }} role="status" aria-busy="true" aria-label="載入中">
        <Skeleton style={{ height: 34, width: "45%", margin: "24px 0 12px" }} />
        <Skeleton style={{ height: 16, width: "80%", marginBottom: 24 }} />
        <Card>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ marginBottom: 16 }}>
              <Skeleton style={{ height: 14, width: "55%", marginBottom: 8 }} />
              <Skeleton style={{ height: 26 }} />
            </div>
          ))}
        </Card>
      </div>
    );
  // 載入失敗不能退回空白表單：看不到既有內容就送出，upsert 會把舊回饋整份覆寫掉
  if (mine.isError) {
    return (
      <p className="error">
        回饋資料載入不了——請稍候再{" "}
        <button onClick={() => mine.refetch()}>重試</button>
      </p>
    );
  }
  // key 綁組別：切換作用組時整份表單重掛，才不會把 A 組的草稿帶到 B 組
  return <FeedbackForm key={groupId ?? ""} groupId={groupId} existing={mine.data ?? null} />;
}

function FeedbackForm({
  groupId,
  existing,
}: {
  groupId?: string;
  existing: { scores: unknown; best: string | null; worst: string | null; note: string | null } | null;
}) {
  const utils = trpc.useUtils();
  // 送出後刷新 mine：第一次填完，按鈕文案與提示才會切成「已填過」狀態
  const submit = trpc.feedback.submit.useMutation({ onSuccess: () => utils.feedback.mine.invalidate() });
  const [scores, setScores] = useState<Record<string, number>>(
    () => (existing?.scores as Record<string, number> | undefined) ?? {},
  );
  const [best, setBest] = useState(existing?.best ?? "");
  const [worst, setWorst] = useState(existing?.worst ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [justSent, setJustSent] = useState(false);

  const hasExisting = existing != null;
  const rated = Object.keys(scores).length;

  // 回表單修改：保留剛剛填的內容，不清空
  const backToForm = () => {
    setJustSent(false);
    submit.reset();
  };

  if (submit.isSuccess && justSent) {
    return (
      <Card style={{ maxWidth: 520, margin: "40px auto", textAlign: "center" }} role="status" aria-live="polite">
        <h2>收到了，感恩</h2>
        <p className="sub">你的回饋會直接影響下一版怎麼改。</p>
        <div style={{ marginTop: 12, display: "flex", gap: 16, justifyContent: "center", alignItems: "center" }}>
          <button onClick={backToForm}>再修改</button>
          <Link href="/dashboard">回今日工作台</Link>
        </div>
      </Card>
    );
  }

  // 再點同一分數＝取消該題（部分評分後端也收）
  const setScore = (key: string, n: number) =>
    setScores((prev) => {
      if (prev[key] === n) {
        const { [key]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: n };
    });

  return (
    <div className="page-shell secondary-page secondary-page--narrow feedback-page" data-fb="使用回饋頁">
      <SecondaryPageHeader
        eyebrow="兩分鐘就好"
        title="使用回饋"
        icon="MessageCircle"
        badge={`已回答 ${rated}/${ITEMS.length}`}
        description={<>依直覺選 1 到 5 分；沒用到的功能可以留空，再點同一分數即可取消。</>}
      />
      {hasExisting && <Hint>你之前填過——直接修改後重新送出即可。</Hint>}
      <Card>
        {ITEMS.map((item) => (
          <RatingRow key={item.key} item={item} value={scores[item.key]} onSet={setScore} />
        ))}
        <label htmlFor="fb-best">最喜歡的一點</label>
        <input id="fb-best" value={best} maxLength={500} onChange={(e) => setBest(e.target.value)} placeholder="例：不用一直重打背景說明" />
        <label htmlFor="fb-worst">最想改的一點</label>
        <input id="fb-worst" value={worst} maxLength={500} onChange={(e) => setWorst(e.target.value)} placeholder="例：生成等太久" />
        <label htmlFor="fb-note">其他想說的（選填）</label>
        <textarea id="fb-note" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <button
            className="primary"
            disabled={rated === 0 || submit.isPending}
            onClick={() => {
              submit.mutate(
                { scores, best: best.trim() || undefined, worst: worst.trim() || undefined, note: note.trim() || undefined, groupId },
                { onSuccess: () => setJustSent(true) },
              );
            }}
          >
            {submit.isPending ? "送出中…" : hasExisting ? "更新回饋" : "送出回饋"}
          </button>
          <Hint as="span">{rated === 0 ? "至少評 1 題就能送出" : "沒用到的功能可以留空"}</Hint>
        </div>
        {submit.error && <p className="error" role="alert">送出失敗，請稍後再試</p>}
      </Card>
    </div>
  );
}

/** 單題評分列：5 顆分數 chip 以 radiogroup＋方向鍵漫遊呈現；再點同分＝取消該題 */
function RatingRow({
  item,
  value,
  onSet,
}: {
  item: { key: string; label: string };
  value: number | undefined;
  onSet: (key: string, n: number) => void;
}) {
  const roving = useRovingRadio(
    ["1", "2", "3", "4", "5"],
    value ? String(value) : "",
    (v) => onSet(item.key, Number(v)),
  );
  return (
    <div style={{ marginBottom: "var(--sp-16)" }}>
      <label id={`fb-${item.key}`} style={{ margin: "0 0 6px" }}>{item.label}</label>
      <div role="radiogroup" aria-labelledby={`fb-${item.key}`} {...roving.groupProps}>
        {[1, 2, 3, 4, 5].map((n, i) => {
          const on = value === n;
          return (
            <Chip
              key={n}
              selected={on}
              onClick={() => onSet(item.key, n)}
              role="radio"
              aria-checked={on}
              aria-label={`${n} 分`}
              // 選取態由 role="radio" 的 aria-checked 表達；aria-pressed 只在 role="button"
              // 合法，Chip 見到自訂 role 就不會再補（見 ui/Chip.tsx）。
              // Enter／空白鍵啟動由 Chip 提供；方向鍵漫遊與 tabIndex 由 roving 覆蓋。
              {...roving.itemProps(i)}
            >
              {n}
            </Chip>
          );
        })}
      </div>
    </div>
  );
}
