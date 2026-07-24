import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "../api";
import { FEEDBACK_CATEGORIES, FEEDBACK_PAGES, type FeedbackCategory } from "@shared/options";
import { captureWithHighlight, pickElement, type PickResult } from "./picker";
import { Icon } from "../components/Icon";
import { useRovingRadio } from "../components/interactions";

/** 目前路由對應到人看得懂的頁面名（與 FEEDBACK_PAGES 對齊；對不上就回 null） */
function pageForPath(path: string): string | null {
  if (path === "/") return "作業台（首頁）";
  if (path.startsWith("/p/")) return "專案頁";
  if (path.startsWith("/admin")) return "團隊管理";
  if (path.startsWith("/models")) return "模型指南";
  if (path.startsWith("/feedback")) return "回饋頁";
  if (path.startsWith("/invite")) return "登入／邀請";
  return null;
}

type Mode = "closed" | "menu" | "picking" | "form";

/**
 * 元件級回饋 widget（任務 D）：右下角浮動鈕→標記某元件或只回報這一頁→分類/頁面/說明/截圖→送出。
 * 在 App 掛一次即可；未登入時自動不顯示。整個 widget 的節點都帶 data-fb-widget，
 * 讓選取模式與截圖都能把自己排除在外。
 */
export function FeedbackWidget() {
  const me = trpc.auth.me.useQuery();
  const [location] = useLocation();
  const [mode, setMode] = useState<Mode>("closed");
  const [target, setTarget] = useState<PickResult | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  // 表單欄位提升到這裡：重選元件時 ReportForm 會 remount，欄位放這才不會被清空
  const [category, setCategory] = useState<FeedbackCategory>(FEEDBACK_CATEGORIES[0].value);
  const [pages, setPages] = useState<Set<string>>(new Set());
  // 三步引導（需求 #3）：與其一格「想說的話」，分成「哪裡有問題」＋「希望怎麼改」兩題引導著寫
  const [problem, setProblem] = useState("");
  const [expected, setExpected] = useState("");
  const [noShot, setNoShot] = useState(false);
  const resetForm = () => { setCategory(FEEDBACK_CATEGORIES[0].value); setPages(new Set()); setProblem(""); setExpected(""); setNoShot(false); };

  // 離開頁面/卸載時務必收掉還開著的選取 overlay，免得殘留一層攔滑鼠的透明層
  useEffect(() => () => stopRef.current?.(), []);

  if (!me.data) return null; // 登入後才顯示

  // groupId 以「使用者真的屬於的組」為準，不直接信 localStorage——否則無組/已被移出的使用者
  // 帶到過期的 group，後端 requireGroup 會擋成 FORBIDDEN 讓整筆回饋送不出
  const storedGroup = localStorage.getItem("aidos_group");
  const validGroupId = me.data.groups.find((g) => g.groupId === storedGroup)?.groupId
    ?? me.data.groups[0]?.groupId
    ?? undefined;
  const currentPage = pageForPath(location);

  // 打開表單時把目前頁預勾一次（欄位還空時）
  const openForm = (t: PickResult | null) => {
    setTarget(t);
    if (pages.size === 0 && currentPage) setPages(new Set([currentPage]));
    setMode("form");
  };

  const startPick = () => {
    setMode("picking");
    stopRef.current = pickElement(
      (r) => {
        stopRef.current = null;
        openForm(r);
      },
      () => {
        stopRef.current = null;
        // 取消選取回到表單（若已在填）或選單——不清掉已填欄位
        setMode(problem || expected || pages.size ? "form" : "menu");
      },
    );
  };

  const openPageOnly = () => openForm(null);

  const close = () => {
    stopRef.current?.();
    stopRef.current = null;
    setTarget(null);
    resetForm();
    setMode("closed");
    // 關閉後把焦點交還浮動鈕，鍵盤使用者不會被丟回文件開頭
    (document.querySelector('[data-fb="回饋按鈕"]') as HTMLElement | null)?.focus();
  };

  return (
    <div data-fb-widget="root" style={{ position: "fixed", right: 18, bottom: 18, zIndex: 45 }}>
      {mode === "menu" && (
        <div
          className="card"
          role="group"
          aria-label="回饋選項"
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); close(); } }}
          style={{ width: 240, marginBottom: 12, padding: "var(--sp-16)" }}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <strong style={{ fontSize: 15 }}>想回報什麼？</strong>
            <button className="btn-ghost" onClick={close} aria-label="關閉">
              <Icon name="X" size={14} />
            </button>
          </div>
          <p className="hint" style={{ margin: "6px 0 12px" }}>
            指出畫面上某個地方，或只針對這一頁說幾句。
          </p>
          <button
            className="primary"
            style={{ width: "100%", marginBottom: 8 }}
            onClick={startPick}
          >
            <Icon name="MousePointer2" size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />標記某個元件
          </button>
          <button style={{ width: "100%" }} onClick={openPageOnly}>
            <Icon name="FileText" size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />只回報這一頁
          </button>
        </div>
      )}

      {mode === "form" && (
        <ReportForm
          target={target}
          groupId={validGroupId}
          category={category}
          setCategory={setCategory}
          pages={pages}
          togglePage={(p) => setPages((prev) => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n; })}
          problem={problem}
          setProblem={setProblem}
          expected={expected}
          setExpected={setExpected}
          noShot={noShot}
          setNoShot={setNoShot}
          onClose={close}
          onRepick={startPick}
        />
      )}

      {mode !== "picking" && (
        <button
          data-fb="回饋按鈕"
          className="primary"
          aria-label="開啟回饋"
          aria-expanded={mode !== "closed"}
          onClick={() => (mode === "closed" ? setMode("menu") : close())}
          style={{
            float: "right",
            borderRadius: 999,
            padding: "11px 20px",
            fontSize: 15,
            boxShadow: "var(--e3)",
          }}
        >
          <Icon name="MessageCircle" size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />回饋
        </button>
      )}
    </div>
  );
}

/** 各分類的引導提問（需求 #3：引導寫出「哪裡有問題、怎麼改」，而不是面對一格空白不知從何說起） */
const GUIDE: Record<FeedbackCategory, { problem: string; expected: string }> = {
  bug: { problem: "你做了什麼、然後發生什麼？（按了哪裡、看到什麼錯誤或怪畫面）", expected: "你原本預期它應該怎樣？" },
  uiux: { problem: "哪裡不好按、看不懂、位置怪或太小？", expected: "你希望它長什麼樣、或放在哪裡比較順手？" },
  feature: { problem: "現在少了什麼，讓你在哪個環節卡住或繞路？", expected: "想要的功能大概怎麼運作？（描述理想流程即可）" },
  stuck: { problem: "你想完成什麼、卡在哪一步？", expected: "你覺得在哪裡加個提示或入口就能自己過關？" },
  other: { problem: "想說的話…", expected: "有什麼建議或期待？（可留空）" },
};

function ReportForm({
  target,
  groupId,
  category,
  setCategory,
  pages,
  togglePage,
  problem,
  setProblem,
  expected,
  setExpected,
  noShot,
  setNoShot,
  onClose,
  onRepick,
}: {
  target: PickResult | null;
  groupId: string | undefined;
  category: FeedbackCategory;
  setCategory: (c: FeedbackCategory) => void;
  pages: Set<string>;
  togglePage: (p: string) => void;
  problem: string;
  setProblem: (v: string) => void;
  expected: string;
  setExpected: (v: string) => void;
  noShot: boolean;
  setNoShot: (v: boolean) => void;
  onClose: () => void;
  onRepick: () => void;
}) {
  const [location] = useLocation();
  const currentPage = pageForPath(location);
  const submit = trpc.feedbackReports.submit.useMutation();
  const categoryHint = FEEDBACK_CATEGORIES.find((c) => c.value === category)?.hint;
  const catRoving = useRovingRadio(FEEDBACK_CATEGORIES.map((c) => c.value), category, (v) => setCategory(v as FeedbackCategory));
  const [shotUrl, setShotUrl] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const shotBlobRef = useRef<Blob | null>(null);
  const [justSent, setJustSent] = useState(false);

  // 表單一開就先擷取一張截圖當預覽（widget 自身不入鏡）；有標定元件就在圖上描框
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    (async () => {
      const blob = await captureWithHighlight(target?.targetRect ?? null);
      if (!alive) {
        return;
      }
      shotBlobRef.current = blob;
      if (blob) {
        url = URL.createObjectURL(blob);
        setShotUrl(url);
      }
      setCapturing(false);
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [target]);

  // 送出成功短暫顯示感謝後自動關閉
  useEffect(() => {
    if (!justSent) return;
    const t = setTimeout(onClose, 1600);
    return () => clearTimeout(t);
  }, [justSent, onClose]);

  const doSubmit = async () => {
    if (submitting) return; // 截圖上傳期間 submit.isPending 還沒 true，另用 submitting 擋重複送出
    setSubmitting(true);
    try {
      let screenshotPath: string | undefined;
      if (!noShot && shotBlobRef.current) {
        try {
          const fd = new FormData();
          fd.append("file", shotBlobRef.current, "shot.png");
          const res = await fetch("/api/feedback/screenshot", { method: "POST", body: fd });
          if (res.ok) {
            const j = (await res.json()) as { path?: string };
            if (j.path) screenshotPath = j.path;
          }
        } catch {
          // 截圖是可選的：上傳失敗就當沒附，不擋文字回報
        }
      }
      // 兩題引導答案組成一段結構化文字存進既有 note 欄位（不動 DB schema；審閱端直接可讀）
      const note = expected.trim()
        ? `【哪裡有問題】${problem.trim()}\n【希望怎麼改】${expected.trim()}`
        : problem.trim();
      await submit.mutateAsync({
        category,
        pages: [...pages],
        note,
        targetLabel: target?.targetLabel,
        targetSelector: target?.targetSelector,
        targetRect: target?.targetRect,
        screenshotPath,
        groupId,
      });
      setJustSent(true);
    } catch {
      // 失敗訊息由 submit.error 顯示；submitting 在 finally 放開讓使用者重試
    } finally {
      setSubmitting(false);
    }
  };

  if (justSent) {
    return (
      <div
        className="card"
        role="status"
        aria-live="polite"
        style={{ width: 300, marginBottom: 12, padding: 20, textAlign: "center" }}
      >
        <strong style={{ fontSize: 15 }}>收到了，感恩</strong>
        <p className="hint" style={{ margin: "6px 0 0" }}>你說的會直接影響下一版怎麼改。</p>
        <Link href="/my-reports" onClick={onClose} style={{ display: "inline-block", marginTop: 10, fontSize: 13 }}>
          查看我的回報
        </Link>
      </div>
    );
  }

  const canSubmit = problem.trim().length > 0 && !submitting;
  const guide = GUIDE[category] ?? GUIDE.other;

  return (
    <div
      className="card"
      role="dialog"
      aria-label="填寫回饋"
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}
      style={{ width: 320, maxWidth: "92vw", marginBottom: 12, padding: 16, maxHeight: "78vh", overflowY: "auto" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 15 }}>填寫回饋</strong>
        <button className="btn-ghost" onClick={onClose} aria-label="關閉">
          <Icon name="X" size={14} />
        </button>
      </div>

      {target && (
        <p className="hint" style={{ margin: "8px 0 0" }}>
          標定：<strong style={{ color: "var(--primary-ink)" }}>{target.targetLabel}</strong>{" "}
          <span role="button" tabIndex={0} onClick={onRepick} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRepick(); } }} style={{ color: "var(--primary-ink)", cursor: "pointer", textDecoration: "underline" }}>
            重選
          </span>
        </p>
      )}

      <label style={{ margin: "12px 0 4px" }}>① 這是什麼樣的回饋？</label>
      <div role="radiogroup" aria-label="回饋分類" {...catRoving.groupProps}>
        {FEEDBACK_CATEGORIES.map((c, i) => {
          const on = category === c.value;
          return (
            <span
              key={c.value}
              role="radio"
              aria-checked={on}
              {...catRoving.itemProps(i)}
              title={c.hint}
              className={`chip pick ${on ? "on" : ""}`}
              onClick={() => setCategory(c.value)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCategory(c.value); } }}
            >
              {c.label}
            </span>
          );
        })}
      </div>
      {categoryHint && (
        <p className="hint" style={{ margin: "6px 0 0" }}>{categoryHint}</p>
      )}

      <label style={{ margin: "12px 0 4px" }}>涉及哪些頁面？（可複選）</label>
      <div role="group" aria-label="涉及頁面">
        {FEEDBACK_PAGES.map((p) => {
          const on = pages.has(p);
          return (
            <span
              key={p}
              role="checkbox"
              aria-checked={on}
              tabIndex={0}
              className={`chip pick ${on ? "on" : ""}`}
              onClick={() => togglePage(p)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePage(p); } }}
            >
              {p}
              {p === currentPage ? "・目前" : ""}
            </span>
          );
        })}
      </div>

      <label htmlFor="fb-problem" style={{ margin: "12px 0 4px" }}>② 哪裡有問題？</label>
      <textarea
        id="fb-problem"
        value={problem}
        maxLength={1200}
        onChange={(e) => setProblem(e.target.value)}
        placeholder={guide.problem}
        style={{ minHeight: 72 }}
        autoFocus
      />

      <label htmlFor="fb-expected" style={{ margin: "12px 0 4px" }}>③ 希望怎麼改？<span className="hint">（選填）</span></label>
      <textarea
        id="fb-expected"
        value={expected}
        maxLength={700}
        onChange={(e) => setExpected(e.target.value)}
        placeholder={guide.expected}
        style={{ minHeight: 56 }}
      />

      <div style={{ marginTop: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={noShot}
            onChange={(e) => setNoShot(e.target.checked)}
            style={{ width: "auto" }}
          />
          不附截圖
        </label>
        {!noShot && (
          <div style={{ marginTop: 8 }}>
            {capturing ? (
              <p className="hint" style={{ margin: 0 }}>正在擷取畫面…</p>
            ) : shotUrl ? (
              <img
                src={shotUrl}
                alt="截圖預覽"
                style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", display: "block" }}
              />
            ) : (
              <p className="hint" style={{ margin: 0 }}>這次沒能擷取到畫面，送出文字仍會收到。</p>
            )}
          </div>
        )}
      </div>

      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
        <button className="primary" disabled={!canSubmit} onClick={doSubmit}>
          {submitting ? "送出中…" : "送出"}
        </button>
        <span className="hint">{problem.trim().length === 0 ? "第 ② 題至少寫一句" : ""}</span>
      </div>
      {submit.error && (
        <p className="error" role="alert">
          送出失敗，請稍後再試
        </p>
      )}
    </div>
  );
}
