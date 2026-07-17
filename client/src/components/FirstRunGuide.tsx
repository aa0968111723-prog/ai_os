import { type CSSProperties } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "../api";
import { Icon } from "./Icon";

/** 流程六步（設計規格）：建專案 → 世界觀 → 拆分鏡 → 逐格生成 → 送審 → 交付 */
const STEPS: Array<{ n: string; label: string; hint: string }> = [
  { n: "1", label: "建專案", hint: "選內容類型與發布平台" },
  { n: "2", label: "世界觀", hint: "一分鐘寫下故事與調性" },
  { n: "3", label: "拆分鏡", hint: "貼腳本，AI 幫你切成一幕幕" },
  { n: "4", label: "逐格生成", hint: "每一格出圖、配音" },
  { n: "5", label: "送審", hint: "組長審核把關" },
  { n: "6", label: "交付", hint: "一鍵打包成品包" },
];

const numStyle: CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: "50%",
  background: "var(--primary-solid)",
  color: "var(--primary-fg)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  fontWeight: 700,
  fontFamily: "var(--mono)",
  flex: "none",
};

/**
 * 新手導覽卡（首次進作業台、還沒有任何專案時顯示）：
 * 說明整條流程，並提供一鍵「建立範例專案」——範例已填好世界觀＋草稿分鏡＋免費佔位縮圖，
 * 絕不花點數（見 server projects.createSample）。是否顯示與「略過」記憶由 Launchpad 管理。
 */
export function FirstRunGuide({ groupId, onDismiss }: { groupId: string; onDismiss: () => void }) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const createSample = trpc.projects.createSample.useMutation({
    onSuccess: (project) => {
      utils.projects.list.invalidate();
      onDismiss(); // 建好就當作看過導覽，之後不再自動彈出
      navigate(`/p/${project.id}`);
    },
  });

  return (
    <div className="card card--primary" data-fb="新手導覽卡" style={{ marginBottom: "var(--sp-20)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className="orb" aria-hidden />
        <h2 style={{ margin: 0 }}>歡迎加入 · 先看一個完整範例</h2>
        <span className="badge" style={{ marginLeft: "auto" }}>新手導覽</span>
      </div>

      <p className="hint" style={{ marginTop: 8, fontSize: 13 }}>
        這是一套把「腳本 → 分鏡 → 生成 → 送審 → 交付」串起來的工具。第一次來，建議先開一個<strong>範例專案</strong>看看完整長相——
        裡面已經填好世界觀、附了四格草稿分鏡（含提示詞與配音詞）與一張示範縮圖，<strong>不會花到任何點數</strong>。
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "12px 0 4px" }}>
        {STEPS.map((s, i) => (
          <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title={s.hint}>
              <span className="mono" style={numStyle}>{s.n}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</span>
            </span>
            {i < STEPS.length - 1 && (
              <span className="hint" aria-hidden style={{ opacity: 0.55 }}><Icon name="ArrowRight" size={14} /></span>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button
          className="primary"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          disabled={!groupId || createSample.isPending}
          onClick={() => createSample.mutate({ groupId })}
        >
          <Icon name="Sparkles" size={16} />
          {createSample.isPending ? "建立範例中…" : "建立範例專案看看"}
        </button>
        <button onClick={onDismiss}>略過</button>
        <Link href="/help" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13 }}>
          <Icon name="HelpCircle" size={14} />看怎麼用
        </Link>
        {!groupId && <span className="hint">（要先屬於一個組才能建立範例）</span>}
      </div>

      {createSample.error && <p className="error">{createSample.error.message}</p>}
    </div>
  );
}
