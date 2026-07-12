import { useState } from "react";
import { trpc } from "../api";

const ITEMS: Array<{ key: string; label: string }> = [
  { key: "context", label: "AI 懂不懂我們的素材（不用重複解釋）" },
  { key: "cost", label: "額度夠用、花費看得懂" },
  { key: "collab", label: "協作/審批比試算表好用" },
  { key: "ai", label: "AI 導演的 idea 有沒有用" },
  { key: "daily", label: "能融入平常剪輯流程" },
  { key: "usability", label: "不用教也會用" },
];

/** 測試回饋（評估七項：第 7 項為優缺點文字） */
export function FeedbackPage({ groupId }: { groupId?: string }) {
  const submit = trpc.feedback.submit.useMutation();
  const [scores, setScores] = useState<Record<string, number>>({});
  const [best, setBest] = useState("");
  const [worst, setWorst] = useState("");
  const [note, setNote] = useState("");
  const [justSent, setJustSent] = useState(false);

  const missing = ITEMS.filter((it) => !scores[it.key]).length;

  const reset = () => {
    setScores({}); setBest(""); setWorst(""); setNote("");
    setJustSent(false);
    submit.reset();
  };

  if (submit.isSuccess && justSent) {
    return (
      <div className="card" style={{ maxWidth: 520, margin: "40px auto", textAlign: "center" }} role="status" aria-live="polite">
        <h2>收到了，感恩 🙏</h2>
        <p className="sub">你的回饋會直接影響下一版怎麼改。</p>
        <button style={{ marginTop: 12 }} onClick={reset}>再填一份</button>
      </div>
    );
  }

  const setScore = (key: string, n: number) => setScores((prev) => ({ ...prev, [key]: n }));

  return (
    <div style={{ maxWidth: 620, margin: "0 auto" }}>
      <h1>使用回饋</h1>
      <p className="sub">1＝很不行、5＝很好；憑直覺填就好，兩分鐘。</p>
      <div className="card">
        {ITEMS.map((item) => (
          <div key={item.key} style={{ marginBottom: 14 }}>
            <label id={`fb-${item.key}`} style={{ margin: "0 0 6px" }}>{item.label}</label>
            <div role="radiogroup" aria-labelledby={`fb-${item.key}`}>
              {[1, 2, 3, 4, 5].map((n) => {
                const on = scores[item.key] === n;
                return (
                  <span
                    key={n}
                    role="radio"
                    aria-checked={on}
                    aria-label={`${n} 分`}
                    tabIndex={0}
                    className={`chip pick ${on ? "on" : ""}`}
                    onClick={() => setScore(item.key, n)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setScore(item.key, n); }
                    }}
                  >
                    {n}
                  </span>
                );
              })}
            </div>
          </div>
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
            disabled={missing > 0 || submit.isPending}
            onClick={() => {
              submit.mutate(
                { scores, best: best.trim() || undefined, worst: worst.trim() || undefined, note: note.trim() || undefined, groupId },
                { onSuccess: () => setJustSent(true) },
              );
            }}
          >
            {submit.isPending ? "送出中…" : "送出回饋"}
          </button>
          {missing > 0 && <span className="hint">還有 {missing} 項沒評分</span>}
        </div>
        {submit.error && <p className="error" role="alert">送出失敗：{submit.error.message}</p>}
      </div>
    </div>
  );
}
