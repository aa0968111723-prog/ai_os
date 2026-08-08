/**
 * 劇本編輯器：全螢幕寫作 ＋ 標注 ＋ 專業工具。
 *
 * 為什麼不只是一個 textarea：寫故事只要一個框，寫**劇本**要的是
 *   1. 不被打斷的版面——全螢幕吃掉頂欄／分頁列／浮動球，長稿一次看得到一整場；
 *   2. 標注——把散文裡的名字一鍵宣告成角色／場景／道具，把某一行標成對白／旁白／註記；
 *   3. 導覽與量測——大綱跳場、尋找取代、字數與預估片長；
 *   4. 鍵盤——手不離開稿子（Alt+1～9 標注、⌘F 尋找、⌘⇧F 全螢幕）。
 *
 * 所有會出錯的邏輯（選取範圍、toggle、取代、快捷鍵對照）都在 scriptTools.ts，
 * 這裡只負責接線與版面。標注寫進故事全文本身，不另存中繼格式——
 * 故事是唯一來源，AI 解析、版本、協作讀的都是同一份文字。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { Button, Chip, Meta } from "../../components/ui";
import { useImmersive } from "../../lib/useImmersive";
import {
  applyMark,
  findMatches,
  formatDuration,
  MARK_BY_KIND,
  replaceAll,
  resolveScriptShortcut,
  SCRIPT_MARKS,
  SCRIPT_SHORTCUT_HINTS,
  scriptOutline,
  scriptStats,
  type MarkKind,
} from "./scriptTools";

/** 字級偏好綁裝置（沿用站內 localStorage 前例）：手機與電腦各自舒服的大小不一樣 */
export const SCRIPT_FONT_STORAGE_KEY = "aios.script.fontScale";
const FONT_MIN = 0.9;
const FONT_MAX = 1.6;
const FONT_STEP = 0.1;

function readFontScale(): number {
  if (typeof window === "undefined") return 1;
  try {
    const raw = Number(window.localStorage.getItem(SCRIPT_FONT_STORAGE_KEY));
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    return Math.min(FONT_MAX, Math.max(FONT_MIN, raw));
  } catch {
    return 1;
  }
}

function writeFontScale(scale: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SCRIPT_FONT_STORAGE_KEY, String(scale));
  } catch {
    // 隱私模式：只維持當次頁面設定，不打斷編輯
  }
}

export function ScriptEditor({
  value,
  onChange,
  onBlur,
  canEdit,
  rows,
  placeholder,
  saveLabel,
  footer,
}: {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  canEdit: boolean;
  rows: number;
  placeholder: string;
  /** 存檔狀態（全螢幕時頂欄要看得到，不然使用者不知道有沒有存到） */
  saveLabel?: ReactNode;
  /** 解析摘要與主 CTA：全螢幕時要跟著進來，否則得退出全螢幕才能按「產生分鏡」 */
  footer?: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const { immersive, toggle, exit } = useImmersive(hostRef, "story-immersive");

  const [showOutline, setShowOutline] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  /** 稿子聚焦中＝手機鍵盤在畫面上。沉浸容器是定高的，鍵盤吃掉半個畫面後
      統計列與解析列得讓位（CSS 讀 .is-typing），不然稿子會被自己的工具擠成一條縫 */
  const [typing, setTyping] = useState(false);
  const [fontScale, setFontScale] = useState(1);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [hitIndex, setHitIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setFontScale(readFontScale()), []);

  const stats = useMemo(() => scriptStats(value), [value]);
  const outline = useMemo(() => (showOutline ? scriptOutline(value) : []), [showOutline, value]);
  const hits = useMemo(() => (showFind ? findMatches(value, query) : []), [showFind, query, value]);

  /** 改字＋把游標放回去：setSelectionRange 必須等 React 把新值刷進 DOM 之後才有效 */
  const commit = useCallback(
    (next: { text: string; selectionStart: number; selectionEnd: number }) => {
      onChange(next.text);
      requestAnimationFrame(() => {
        const el = areaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(next.selectionStart, next.selectionEnd);
      });
    },
    [onChange],
  );

  const mark = useCallback(
    (kind: MarkKind) => {
      const el = areaRef.current;
      if (!el || !canEdit) return;
      commit(applyMark(value, el.selectionStart, el.selectionEnd, MARK_BY_KIND[kind]));
    },
    [canEdit, commit, value],
  );

  /** 大綱／搜尋結果 → 把該處捲進視野並選起來（textarea 沒有 scrollIntoView，靠選取帶動） */
  const jumpTo = useCallback((start: number, end: number) => {
    const el = areaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(start, end);
    // 粗估行高把目標捲到視窗上緣三分之一處：比讓瀏覽器停在最底下好讀
    const before = el.value.slice(0, start).split("\n").length - 1;
    const lineHeight = el.scrollHeight / Math.max(1, el.value.split("\n").length);
    el.scrollTop = Math.max(0, before * lineHeight - el.clientHeight / 3);
  }, []);

  const gotoHit = useCallback(
    (index: number) => {
      if (!hits.length) return;
      const i = ((index % hits.length) + hits.length) % hits.length;
      setHitIndex(i);
      jumpTo(hits[i].start, hits[i].end);
    },
    [hits, jumpTo],
  );

  const setFont = useCallback((next: number) => {
    const clamped = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(next * 10) / 10));
    setFontScale(clamped);
    writeFontScale(clamped);
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const action = resolveScriptShortcut(event);
      if (!action) return;
      // Esc 在非沉浸時不攔：使用者可能想關別的東西（找找列、外層 sheet）
      if (action.type === "exitImmersive" && !immersive && !showFind) return;
      event.preventDefault();
      switch (action.type) {
        case "mark":
          mark(action.kind);
          break;
        case "toggleImmersive":
          toggle();
          break;
        case "exitImmersive":
          if (showFind) setShowFind(false);
          else exit();
          break;
        case "toggleFind":
          setShowFind((v) => !v);
          break;
        case "toggleOutline":
          setShowOutline((v) => !v);
          break;
      }
    },
    [exit, immersive, mark, showFind, toggle],
  );

  // 找找列開啟時把焦點送進查詢框（⌘F 之後直接打字）
  const findInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (showFind) findInputRef.current?.focus();
  }, [showFind]);

  return (
    <div
      ref={hostRef}
      className={`script-editor${immersive ? " is-immersive" : ""}${focusMode ? " is-focus" : ""}${typing ? " is-typing" : ""}`}
      /* 字級走 CSS 變數而非直接寫 font-size：手機的 ≥16px 防自動放大守則要留在樣式表裡，
         內聯 font-size 會蓋掉它，使用者一聚焦 iOS 就整頁縮放、打斷編輯 */
      style={{ "--script-font-scale": fontScale } as React.CSSProperties}
      onKeyDown={onKeyDown}
      data-fb="劇本編輯器"
    >
      <div className="script-editor__toolbar" role="toolbar" aria-label="劇本標注與工具">
        {canEdit && (
          <div className="script-editor__group" role="group" aria-label="標注">
            <Icon name="Highlighter" size={14} />
            {SCRIPT_MARKS.map((m) => (
              <button
                key={m.kind}
                type="button"
                className="script-mark-btn"
                title={`${m.hint}（${m.shortcut}）`}
                onClick={() => mark(m.kind)}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
        <span className="script-editor__spacer" />
        <div className="script-editor__group" role="group" aria-label="工具">
          <Button
            size="sm"
            variant={showOutline ? "tonal" : "ghost"}
            aria-pressed={showOutline}
            onClick={() => setShowOutline((v) => !v)}
            title="大綱：長稿裡一眼看完所有場，點一下跳過去（Ctrl/⌘ + Shift + O）"
          >
            <Icon name="List" size={14} /> 大綱
          </Button>
          <Button
            size="sm"
            variant={showFind ? "tonal" : "ghost"}
            aria-pressed={showFind}
            onClick={() => setShowFind((v) => !v)}
            title="尋找／取代：改角色名時一次改完（Ctrl/⌘ + F）"
          >
            <Icon name="Search" size={14} /> 尋找
          </Button>
          <Button
            size="sm"
            variant={focusMode ? "tonal" : "ghost"}
            aria-pressed={focusMode}
            onClick={() => setFocusMode((v) => !v)}
            title="專注模式：收起工具與統計，只留一欄好讀的稿子"
          >
            <Icon name="Aperture" size={14} /> 專注
          </Button>
          <span className="script-editor__font" role="group" aria-label="字級">
            <button type="button" onClick={() => setFont(fontScale - FONT_STEP)} title="縮小字級" aria-label="縮小字級">
              <Icon name="ZoomOut" size={14} />
            </button>
            <Meta as="span">{Math.round(fontScale * 100)}%</Meta>
            <button type="button" onClick={() => setFont(fontScale + FONT_STEP)} title="放大字級" aria-label="放大字級">
              <Icon name="ZoomIn" size={14} />
            </button>
          </span>
          <Button
            size="sm"
            variant={immersive ? "tonal" : "ghost"}
            aria-pressed={immersive}
            onClick={toggle}
            title="全螢幕寫作：收起全站介面，只剩你和稿子（Ctrl/⌘ + Shift + F；Esc 離開）"
          >
            <Icon name={immersive ? "Shrink" : "Expand"} size={14} /> {immersive ? "離開全螢幕" : "全螢幕"}
          </Button>
        </div>
        {saveLabel !== undefined && (
          <span className="script-editor__save story-stage__savestate" aria-live="polite">
            {saveLabel}
          </span>
        )}
      </div>

      {showFind && (
        <div className="script-find" role="search">
          <input
            ref={findInputRef}
            type="search"
            aria-label="尋找"
            placeholder="尋找…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHitIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                gotoHit(e.shiftKey ? hitIndex - 1 : hitIndex + 1);
              }
            }}
          />
          <Meta as="span" aria-live="polite">
            {query ? (hits.length ? `${Math.min(hitIndex + 1, hits.length)} / ${hits.length}` : "沒有符合") : ""}
          </Meta>
          <Button size="sm" variant="ghost" disabled={!hits.length} onClick={() => gotoHit(hitIndex - 1)} title="上一個">
            <Icon name="ChevronUp" size={14} />
          </Button>
          <Button size="sm" variant="ghost" disabled={!hits.length} onClick={() => gotoHit(hitIndex + 1)} title="下一個">
            <Icon name="ChevronDown" size={14} />
          </Button>
          {canEdit && (
            <>
              <input
                type="text"
                aria-label="取代為"
                placeholder="取代為…"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!hits.length}
                onClick={() => {
                  const r = replaceAll(value, query, replacement);
                  onChange(r.text);
                  setNotice(`已取代 ${r.count} 處（註記行不動）`);
                }}
                title="全部取代。註記行是寫給自己的話，不會被改到"
              >
                全部取代
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => setShowFind(false)} title="關閉（Esc）">
            <Icon name="X" size={14} />
          </Button>
        </div>
      )}

      <div className="script-editor__body">
        {showOutline && (
          <nav className="script-outline" aria-label="劇本大綱">
            <Meta as="p" className="script-outline__head">
              大綱（{outline.length}）
            </Meta>
            {outline.length === 0 && <Meta as="p">還沒有內容——寫下第一段就會出現</Meta>}
            <ol className="script-outline__list">
              {outline.map((item) => (
                <li key={item.offset}>
                  <button type="button" onClick={() => jumpTo(item.offset, item.offset)} title="跳到這一段">
                    {item.kind === "heading" && <Icon name="ChevronRight" size={12} />}
                    {item.label}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <textarea
          ref={areaRef}
          id="story-editor"
          className="story-editor"
          aria-label="故事內容"
          placeholder={placeholder}
          value={value}
          rows={rows}
          readOnly={!canEdit}
          onChange={(e) => {
            setNotice(null); // 使用者已經在打字＝上一則「已取代 N 處」看過了
            onChange(e.target.value);
          }}
          onFocus={() => setTyping(true)}
          onBlur={() => {
            setTyping(false);
            onBlur?.();
          }}
        />
      </div>

      <div className="script-editor__status">
        <Chip title="不含空白與註記行">{stats.chars.toLocaleString()} 字</Chip>
        <Chip title="空行分段＝AI 解析預期的場數">{stats.paragraphs} 段</Chip>
        <Chip title={`以每鏡 5 秒估算 ${stats.sentences} 個句子；實際以分鏡為準`}>
          約 {formatDuration(stats.estSeconds)}
        </Chip>
        {stats.noteChars > 0 && <Chip title="註記不會送進 AI 解析">註記 {stats.noteChars} 字</Chip>}
        <span className="script-editor__spacer" />
        <Button size="sm" variant="ghost" aria-expanded={showKeys} onClick={() => setShowKeys((v) => !v)}>
          <Icon name="Keyboard" size={14} /> 快捷鍵
        </Button>
      </div>
      {showKeys && (
        <ul className="script-editor__keys">
          {SCRIPT_SHORTCUT_HINTS.map((k) => (
            <li key={k.keys}>
              <kbd>{k.keys}</kbd> {k.what}
            </li>
          ))}
        </ul>
      )}
      {notice && (
        <Meta as="p" role="status" className="script-editor__notice">
          {notice}
        </Meta>
      )}
      {/* 包一層才有 class 可讓（手機全螢幕打字時整段解析列要讓開鍵盤上方的稿子） */}
      {footer !== undefined && <div className="script-editor__footer">{footer}</div>}
    </div>
  );
}
