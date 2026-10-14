/**
 * 在場夥伴的名字 chip ＋ 點開的小卡（Phase 3：Project Header 的協作控制中心）。
 *
 * 之前的 chip 只有名字，點一下直接切換鏡像跟隨——資訊量是零：看不出他在哪、
 * 在做什麼，也沒有第二個動作可選。這張小卡要回答的是「值不值得去找他」：
 *
 *   韋澔
 *   🟢 在線 · 正在：分鏡 · Shot 08
 *   [跟隨畫面] [傳訊息]
 *
 * 「正在哪」來自語意視圖狀態（peerViews），與 Presenter 跟隨同一個真相來源——
 * 不另外開一條「他在哪」的推斷路徑，兩邊顯示的位置永遠一致。
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { describeViewState, type ViewState } from "../../../../shared/viewState";
import type { CollabPeer, PeerView } from "../../realtime";
import { Button, Hint } from "../../components/ui";
import { Icon } from "../../components/Icon";

/** 手機主要觸控目標下限 */
const TAP = 44;

/**
 * 這位使用者「現在在看什麼」。
 *
 * 同一人多分頁時取**資訊最多**的那一份（欄位數多者），而不是隨便取第一份：
 * Tab A 停在首頁層級（只有 section）、Tab B 開著 Shot 08 時，
 * 「正在 Shot 08」遠比「正在分鏡」有用。純函式，可測。
 */
export function latestViewForUser(peerViews: Map<string, PeerView>, userId: string): ViewState | null {
  let best: ViewState | null = null;
  let bestScore = -1;
  for (const pv of peerViews.values()) {
    if (pv.userId !== userId) continue;
    const score = Object.keys(pv.view).length + (pv.view.sceneId ? 2 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = pv.view;
    }
  }
  return best;
}

/** 由 sceneId 找給人看的標籤（「SHOT 08」）；找不到就退回泛稱，不顯示裸 UUID */
export function sceneLabelOf(
  scenes: Array<{ id: string; title: string }> | undefined,
  view: ViewState | null,
): string | null {
  if (!view?.sceneId || !scenes) return null;
  return scenes.find((s) => s.id === view.sceneId)?.title ?? null;
}

export function PeerBadge({
  peer,
  isMe,
  view,
  sceneLabel,
  following,
  onToggleFollow,
}: {
  peer: CollabPeer;
  isMe: boolean;
  /** 他目前的語意視圖（null＝還沒回報過） */
  view: ViewState | null;
  /** view.sceneId 對應的鏡標題（查得到才給） */
  sceneLabel: string | null;
  /** 我是否正在鏡像跟隨他 */
  following: boolean;
  onToggleFollow: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  // 點卡片外面就關（含 Esc）；不擋住頁面其他互動
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const whereabouts = describeViewState(view, sceneLabel);

  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        className={!isMe ? "m-touch" : undefined}
        aria-haspopup={!isMe ? "menu" : undefined}
        aria-expanded={!isMe ? open : undefined}
        disabled={isMe}
        title={isMe ? "你在這個專案裡" : `${peer.name} · ${whereabouts}`}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          fontSize: 12, padding: "2px 10px", borderRadius: 999,
          border: `1px solid ${peer.color}`, color: peer.color,
          background: "transparent",
          textShadow: "0 1px 2px var(--scrim)",
          opacity: isMe ? 0.55 : 1,
          cursor: isMe ? "default" : "pointer",
          outline: following ? `2px solid ${peer.color}` : undefined,
          outlineOffset: 2,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: peer.color }} />
        {isMe ? "你" : peer.name}
        {following ? " · 跟隨中" : ""}
      </button>

      {open && !isMe && (
        <div
          role="menu"
          aria-label={`${peer.name} 的協作選單`}
          data-testid="peer-card"
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 60,
            minWidth: 220, padding: "10px 12px", borderRadius: 10,
            background: "var(--card)", border: "1px solid var(--border-soft)",
            boxShadow: "0 6px 24px var(--scrim)",
            display: "grid", gap: 8,
          }}
        >
          <div>
            <strong style={{ fontSize: "var(--fs-13)" }}>{peer.name}</strong>
            <Hint as="p" style={{ margin: "2px 0 0", fontSize: "var(--fs-12)" }}>
              <span aria-hidden style={{ color: "var(--success-ink)" }}>●</span> 在線 ·{" "}
              {/* 「正在：分鏡 · Shot 08」——與 Presenter 跟隨同一個 viewState 真相 */}
              正在：{whereabouts}
            </Hint>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Button
              size="sm"
              style={{ minHeight: TAP }}
              onClick={() => {
                onToggleFollow();
                setOpen(false);
              }}
            >
              {following ? "停止跟隨" : "跟隨畫面"}
            </Button>
            <Link
              href={`/chat/${peer.userId}`}
              className="btn-ghost btn-sm"
              style={{ minHeight: TAP, display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Icon name="MessageCircle" size={14} /> 傳訊息
            </Link>
          </div>
        </div>
      )}
    </span>
  );
}
