import { useState } from "react";
import {
  buildWorldviewInjectPreview,
  formatWorldviewInjectedPrompt,
  CARD_ANCHOR_MARKERS,
  type Worldview,
} from "@shared/worldview";
import { Card, Meta } from "./ui";
import { Icon } from "./Icon";

/**
 * 「AI 會收到什麼」——把隱形的世界觀注入攤開給人看。
 *
 * 這一區抽象的根因是：欄位標著「生成時自動注入」，但注入的那段文字使用者
 * 從頭到尾看不到。填了東西不知道發生什麼事，於是整組設定像在填無意義的表。
 *
 * 誠實性靠兩件事守住：
 * 1. 內容一律來自 `buildWorldviewInjectPreview`（只呼叫 generationCore 同一批
 *    公開 formatter），這個元件**不組任何提示詞字串**。
 * 2. 定裝卡錨點只印標記與張數——那三段是伺服器依 DB 與當下勾選組出來的
 *    （見 server/services/cardAnchors.ts），前端沒有等價輸入，猜了就是說謊。
 */
export function WorldviewPreview({
  wv,
  cardCounts,
  defaultOpen = true,
  id = "wv-inject-preview",
}: {
  wv: Worldview;
  /** 生成台當下實際勾選的卡片數（非資料庫總數） */
  cardCounts?: { characters: number; scenes: number; props: number };
  defaultOpen?: boolean;
  id?: string;
}) {
  const preview = buildWorldviewInjectPreview(wv);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (key: string, text: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(key);
        setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
      },
      () => {
        setCopied(`${key}:fail`);
        setTimeout(() => setCopied((c) => (c === `${key}:fail` ? null : c)), 1500);
      },
    );
  };

  const anchorNote = cardCounts
    ? `你在生成台勾的定裝卡會再接在後面（角色 ${cardCounts.characters}・場景 ${cardCounts.scenes}・素材 ${cardCounts.props}），` +
      `內容在送出當下才組：${CARD_ANCHOR_MARKERS.join(" ")}`
    : null;

  return (
    <Card as="details" variant="quiet" className="wv-preview" id={id} open={defaultOpen}>
      <summary className="wv-preview__summary">
        <span className="wv-preview__title">AI 會收到什麼？</span>
        <Meta as="span" className="wv-preview__hint">
          點開看實際送出去的字
        </Meta>
        <Icon name="ChevronDown" size={14} className="details-caret" style={{ marginLeft: "auto" }} />
      </summary>

      <div className="wv-preview__body">
        {preview.empty ? (
          <Meta as="p" className="wv-preview__blank">
            現在是空的——AI 只會收到你當下打的那句話，不會知道這支片的背景。
            補上「這支片在講什麼」和「畫風」，這裡就會出現實際送出去的字。
          </Meta>
        ) : (
          <>
            <PreviewBlock
              label="出圖／出影片時"
              text={formatWorldviewInjectedPrompt("〈你在生成台打的那句話〉", preview.visual.positive)}
              copied={copied === "visual"}
              failed={copied === "visual:fail"}
              onCopy={() => copy("visual", preview.visual.positive)}
            />

            {preview.visual.negative ? (
              <PreviewBlock
                label="出圖時會避開（負向）"
                text={preview.visual.negative}
                note="只有支援負向的模型吃得到，生成台會標。"
                copied={copied === "negative"}
                failed={copied === "negative:fail"}
                onCopy={() => copy("negative", preview.visual.negative)}
              />
            ) : null}

            <PreviewBlock
              label="寫字的 AI（旁白・腳本・文案）"
              text={formatWorldviewInjectedPrompt("〈你打的那句話〉", preview.llm.positive)}
              copied={copied === "llm"}
              failed={copied === "llm:fail"}
              onCopy={() => copy("llm", preview.llm.positive)}
            />
          </>
        )}

        {anchorNote ? (
          <Meta as="p" className="wv-preview__note">
            {anchorNote}
          </Meta>
        ) : null}

        <Meta as="p" className="wv-preview__note">
          配音（TTS）、配樂音效、轉檔類不會帶這段——敘事文字對它們是雜訊。
        </Meta>
      </div>
    </Card>
  );
}

function PreviewBlock({
  label,
  text,
  note,
  copied,
  failed,
  onCopy,
}: {
  label: string;
  text: string;
  note?: string;
  copied: boolean;
  failed: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="wv-preview__block">
      <div className="wv-preview__block-head">
        <Meta as="span" className="wv-preview__label">
          {label}
        </Meta>
        <button type="button" className="linkish wv-preview__copy" onClick={onCopy}>
          {copied ? "已複製" : failed ? "複製失敗" : "複製"}
        </button>
      </div>
      <pre className="wv-preview__pre">{text}</pre>
      {note ? (
        <Meta as="p" className="wv-preview__note">
          {note}
        </Meta>
      ) : null}
    </div>
  );
}
