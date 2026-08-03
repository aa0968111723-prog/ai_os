import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { Button, Card, Hint, Meta } from "./ui";
import {
  readDmBubbleEnabled,
  subscribeDmBubbleEnabled,
  writeDmBubbleEnabled,
} from "../lib/dmBubblePreference";

/** 相對時間（與 ChatPage 對齊） */
function relTime(d: string | Date | null): string {
  if (!d) return "";
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "剛剛";
  if (mins < 60) return `${mins} 分鐘前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} 天前` : new Date(d).toLocaleDateString("zh-TW");
}

function avatarInitial(name: string): string {
  return name.trim().charAt(0).toLocaleUpperCase("zh-TW") || "人";
}

/**
 * Messenger 風格私訊浮動小球球（左下角）。
 * - 登入後、偏好開啟時顯示
 * - 圓形按鈕＋未讀角標；點擊展開最近對話串清單
 * - 點串列導向 /chat/:peerId
 * - 關頁通知仍由既有 Web Push 處理（本元件只負責站內浮層）
 */
export function FloatingDmBubble() {
  const me = trpc.auth.me.useQuery();
  const [location, navigate] = useLocation();
  const [enabled, setEnabled] = useState(readDmBubbleEnabled);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 偏好訂閱（本頁 + 跨分頁）
  useEffect(() => subscribeDmBubbleEnabled(setEnabled), []);

  // 點外面關閉面板
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Escape 關閉
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const unread = trpc.dm.unread.useQuery(undefined, {
    enabled: !!me.data && enabled,
    refetchInterval: open ? 10_000 : 30_000,
  });
  const threads = trpc.dm.threads.useQuery(undefined, {
    enabled: !!me.data && enabled && open,
    refetchInterval: open ? 15_000 : false,
  });

  if (!me.data || !enabled) return null;

  // 在聊天頁本身時仍顯示小球球（方便快速切換對象），但展開後可導航
  const totalUnread = unread.data?.total ?? 0;
  const recent = (threads.data ?? []).slice(0, 8);

  return (
    <div ref={rootRef} className="dm-bubble-root" data-dm-bubble="root">
      {open && (
        <Card
          role="dialog"
          aria-label="私訊最近對話"
          className="dm-bubble-panel"
          style={{
            width: 280,
            maxWidth: "92vw",
            marginBottom: 12,
            padding: 0,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px",
              borderBottom: "1px solid var(--border-soft)",
            }}
          >
            <strong style={{ fontSize: 14 }}>私訊</strong>
            <div style={{ display: "flex", gap: 4 }}>
              <Button
                variant="ghost"
                size="sm"
                aria-label="開啟完整私訊頁"
                onClick={() => {
                  setOpen(false);
                  navigate("/chat");
                }}
                title="開啟完整私訊頁"
              >
                <Icon name="MessageCircle" size={14} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="關閉"
                onClick={() => setOpen(false)}
              >
                <Icon name="X" size={14} />
              </Button>
            </div>
          </div>

          {threads.isLoading ? (
            <Meta as="p" style={{ padding: 16, margin: 0 }}>
              載入中…
            </Meta>
          ) : recent.length === 0 ? (
            <div style={{ padding: 16 }}>
              <Hint layer="always" style={{ margin: 0 }}>
                還沒有對話——到私訊頁發起新對話。
              </Hint>
              <Button
                variant="primary"
                size="sm"
                style={{ marginTop: 10, width: "100%" }}
                onClick={() => {
                  setOpen(false);
                  navigate("/chat");
                }}
              >
                去私訊頁
              </Button>
            </div>
          ) : (
            <ul className="dm-bubble-list" role="list">
              {recent.map((t) => {
                const active = location === `/chat/${t.peerId}`;
                return (
                  <li key={t.peerId}>
                    <button
                      type="button"
                      className={`dm-bubble-row${active ? " is-active" : ""}${t.unread > 0 ? " has-unread" : ""}`}
                      onClick={() => {
                        setOpen(false);
                        navigate(`/chat/${t.peerId}`);
                      }}
                    >
                      <span className="dm-bubble-avatar" aria-hidden>
                        {avatarInitial(t.peerName)}
                      </span>
                      <span className="dm-bubble-meta">
                        <span className="dm-bubble-name">
                          {t.peerName}
                          {t.unread > 0 && (
                            <span className="dm-bubble-unread-pill">{t.unread}</span>
                          )}
                        </span>
                        <span className="dm-bubble-preview">
                          {t.lastFromMe ? "你：" : ""}
                          {t.lastBody || "（附件）"}
                        </span>
                      </span>
                      <span className="dm-bubble-time">{relTime(t.lastAt)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div
            style={{
              padding: "8px 12px",
              borderTop: "1px solid var(--border-soft)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Hint as="span" style={{ margin: 0, fontSize: 12 }}>
              可在設定關閉小球球
            </Hint>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                writeDmBubbleEnabled(false);
                setEnabled(false);
                setOpen(false);
              }}
            >
              關閉
            </Button>
          </div>
        </Card>
      )}

      <button
        type="button"
        className="dm-bubble-fab primary"
        aria-label={totalUnread > 0 ? `私訊，${totalUnread} 則未讀` : "私訊"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="MessageCircle" size={20} />
        {totalUnread > 0 && (
          <span className="dm-bubble-badge" aria-hidden>
            {totalUnread > 99 ? "99+" : totalUnread}
          </span>
        )}
      </button>
    </div>
  );
}
