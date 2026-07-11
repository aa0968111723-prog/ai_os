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
export function FeedbackPage() {
  const submit = trpc.feedback.submit.useMutation();
  const [scores, setScores] = useState<Record<string, number>>({});
  const [best, setBest] = useState("");
  const [worst, setWorst] = useState("");
  const [note, setNote] = useState("");

  if (submit.isSuccess) {
    return (
      <div className="card" style={{ maxWidth: 520, margin: "40px auto", textAlign: "center" }}>
        <h2>收到了，感恩 🙏</h2>
        <p className="sub">你的回饋會直接影響下一版怎麼改。</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 620, margin: "0 auto" }}>
      <h1>使用回饋</h1>
      <p className="sub">1＝很不行、5＝很好；憑直覺填就好，兩分鐘。</p>
      <div className="card">
        {ITEMS.map((item) => (
          <div key={item.key} style={{ marginBottom: 14 }}>
            <label style={{ margin: "0 0 6px" }}>{item.label}</label>
            <div>
              {[1, 2, 3, 4, 5].map((n) => (
                <span
                  key={n}
                  className={`chip pick ${scores[item.key] === n ? "on" : ""}`}
                  onClick={() => setScores({ ...scores, [item.key]: n })}
                >
                  {n}
                </span>
              ))}
            </div>
          </div>
        ))}
        <label>最喜歡的一點</label>
        <input value={best} onChange={(e) => setBest(e.target.value)} placeholder="例：不用一直重打背景說明" />
        <label>最想改的一點</label>
        <input value={worst} onChange={(e) => setWorst(e.target.value)} placeholder="例：生成等太久" />
        <label>其他想說的（選填）</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} />
        <div style={{ marginTop: 16 }}>
          <button
            className="primary"
            disabled={Object.keys(scores).length < ITEMS.length || submit.isPending}
            onClick={() => submit.mutate({ scores, best: best.trim() || undefined, worst: worst.trim() || undefined, note: note.trim() || undefined })}
          >
            {submit.isPending ? "送出中…" : "送出回饋"}
          </button>
        </div>
        {submit.error && <p className="error">{submit.error.message}</p>}
      </div>
    </div>
  );
}
