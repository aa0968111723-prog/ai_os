import { type ReactNode } from "react";
import { Link } from "wouter";
import { Icon } from "../components/Icon";

/**
 * 怎麼用 / 常見問題：純靜態白話說明頁（無資料查詢、無新依賴）。
 * 內容對齊本專案實際流程——世界觀→拆分鏡→逐格生成→送審→打包 zip；
 * 用 <details>/<summary> 折疊，summary 為 ≥44px 觸控目標。
 */

/** 單則問答：折疊卡片，標題即 summary（可鍵盤展開）；defaultOpen 讓第一則預設展開。 */
function Faq({ q, defaultOpen = false, children }: { q: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details className="card" open={defaultOpen} style={{ padding: 0, overflow: "hidden" }}>
      <summary
        style={{
          minHeight: 44,
          padding: "13px 18px",
          cursor: "pointer",
          fontWeight: 600,
          fontSize: 15,
          userSelect: "none",
        }}
      >
        {q}
      </summary>
      <div
        style={{
          padding: "12px 18px 16px",
          borderTop: "1px solid var(--border-soft)",
          lineHeight: 1.8,
          fontSize: "var(--fs-14)",
        }}
      >
        {children}
      </div>
    </details>
  );
}

/** 名詞小辭典的一列：粗體詞＋白話解釋。 */
function Term({ word, children }: { word: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <b>{word}</b>
      <div className="hint" style={{ fontSize: "var(--fs-14)", lineHeight: 1.75, marginTop: 2 }}>
        {children}
      </div>
    </div>
  );
}

export function HelpPage() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }} data-fb="怎麼用頁">
      <h1>怎麼用 · 常見問題</h1>
      <p className="sub">
        用白話說明 AI Director OS 怎麼運作：從一份腳本，到分鏡、逐格生成畫面／配音，最後打包成一包 zip 拖進剪映或 Premiere 就能剪。看到不懂的名詞，翻到最下面的
        <b>名詞小辭典</b>。
      </p>

      <h2 style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}><Icon name="HelpCircle" size={18} />開始使用</h2>
      <div className="stack">
        <Faq q="這是什麼？能幫我做到什麼？" defaultOpen>
          <p style={{ marginTop: 0 }}>
            AI Director OS 把「一份腳本」變成「一支片的素材包」。整條路線是：
          </p>
          <p style={{ margin: "0 0 8px" }}>
            貼上腳本 → 自動拆成一格一格的<b>分鏡</b> → 每一格逐格生成畫面（圖或影片）、旁白配音、字幕 → 排好順序、送組長審核 → 一鍵打包成 zip。
          </p>
          <p style={{ margin: 0 }}>
            這包 zip 裡是分好資料夾、依鏡號排好的素材，直接拖進剪映或 Premiere 就能開始剪，不用自己找圖、配音、對字幕。而且 AI 會記得這個專案的
            <b>世界觀</b>（背景、語氣、畫風），每次生成自動帶入，不用一直重講背景。
          </p>
        </Faq>

        <Faq q="第一次用，怎麼開始？">
          <ol style={{ margin: 0, paddingLeft: 22 }}>
            <li>在作業台<b>建一個專案</b>（選格式與平台）。</li>
            <li>
              填<b>世界觀</b>——一句話故事、一句關鍵訊息，勾選調性與視覺風格。填一次，之後每次生成 AI 都記得。
            </li>
            <li>把腳本貼進<b>「AI 拆分鏡」</b>，系統自動拆成一格一格的分鏡草稿。</li>
            <li>
              <b>逐格生成</b>：在生成台挑模型、寫提示詞（世界觀會自動帶入），做出畫面；需要旁白就生成逐鏡配音。
            </li>
            <li>把滿意的成品<b>加入分鏡</b>，用 <Icon name="ChevronUp" size={14} style={{ verticalAlign: "-2px" }} /><Icon name="ChevronDown" size={14} style={{ verticalAlign: "-2px" }} /> 排好順序。</li>
            <li>
              <b>送審</b>給組長；通過後<b>一鍵打包成 zip</b> 交付。
            </li>
          </ol>
          <p className="hint" style={{ margin: "10px 0 0", fontSize: 13 }}>
            專案頁上方有「從這裡開始」四步清單，做到哪一步會自動打勾，點一下能跳到對應區塊。
          </p>
        </Faq>
      </div>

      <h2 style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 8 }}><Icon name="Gem" size={18} />點數與生成</h2>
      <div className="stack">
        <Faq q="「點數」是什麼？大概要生多久？">
          <ul style={{ margin: 0, paddingLeft: 22 }}>
            <li>
              點數＝每次生成要花的額度。每個模型旁邊都標「X 點／次」，<b>送出前會先跳確認框</b>讓你看預估點數，點頭才真的扣。
            </li>
            <li>
              額度由<b>管理員</b>設定（可設週上限、日上限，或不限）。頂欄的 <Icon name="Gem" size={13} style={{ verticalAlign: "-2px" }} /> 徽章隨時看得到目前剩多少。
            </li>
            <li>
              生成需要一點時間（圖較快、影片較久）。送出後那一格會顯示「排隊中／生成中」，好了自動變「完成」，不用一直守著。
            </li>
          </ul>
        </Faq>

        <Faq q="生成失敗會不會白白扣點？">
          <p style={{ margin: 0 }}>
            <b>不會，失敗自動全額退點。</b>不論是送出失敗、還是生成中途失敗，系統都會退回那一次的點數，並在該格標「失敗（已退點）」。你只會為真正做出來的成品付費。
          </p>
        </Faq>

        <Faq q="生成是真的在呼叫 AI 嗎？">
          <ul style={{ margin: 0, paddingLeft: 22 }}>
            <li>
              是。系統一律以<b>正式模式</b>運作：每次生成都實際呼叫 AI 供應商產出成品，並依模型標示扣點。
            </li>
            <li>
              若管理員尚未設定 AI 供應商金鑰（FAL_KEY），生成會直接顯示明確的失敗訊息並<b>自動退點</b>——不會偷偷回傳示範素材。
            </li>
            <li>金鑰狀態可由管理員在「團隊管理→跑系統自檢」的「生成模式」項目確認。</li>
          </ul>
        </Faq>
      </div>

      <h2 style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 8 }}><Icon name="Package" size={18} />交付</h2>
      <div className="stack">
        <Faq q="做好後怎麼交付？zip 裡面長怎樣？">
          <p style={{ marginTop: 0 }}>
            分鏡送審通過後，在<b>「分鏡・交付」</b>區一鍵打包下載一包 zip。資料夾用業界通用的編號命名、依鏡號排好（有內容的資料夾才會出現）：
          </p>
          <ul style={{ margin: "0 0 8px", paddingLeft: 22 }}>
            <li>
              <b>01_視頻素材</b>——影片類成品，依鏡號排序
            </li>
            <li>
              <b>02_旁白音檔</b>——逐鏡旁白配音，檔名鏡號對應畫面與字幕
            </li>
            <li>
              <b>03_圖像</b>——圖片類成品
            </li>
            <li>
              <b>04_字幕</b>——字幕.srt，可直接匯入剪映／Premiere／YouTube
            </li>
            <li>
              <b>05_文件</b>——腳本與鏡頭表.md（每鏡的秒數、檔名、提示詞、模型一覽）
            </li>
          </ul>
          <p className="hint" style={{ margin: "0 0 8px", fontSize: 13 }}>
            若專案有<b>鎖定素材</b>，會多一個 00_鎖定原素材（原封不動的原音／開示／配樂）；另附 README.txt 說明資料夾結構。
          </p>
          <p style={{ margin: 0 }}>媒體檔直接拖進剪映或 Premiere，照鏡號順序組裝，就能對齊畫面、旁白與字幕。</p>
        </Faq>
      </div>

      <h2 style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 8 }}><Icon name="FileText" size={18} />名詞小辭典</h2>
      <div className="card">
        <Term word="世界觀">
          這支片的固定設定（一句話故事、關鍵訊息、調性、視覺風格、禁忌）。填一次，之後每次生成自動帶入，不用重講背景。
        </Term>
        <Term word="分鏡">把片子切成一格一格的鏡頭；每一格有秒數、畫面，可配旁白與字幕。</Term>
        <Term word="逐鏡配音">
          一格一格分開生成的旁白音檔，檔名鏡號對應該鏡畫面，剪輯時把同鏡號的旁白對齊該鏡即可。
        </Term>
        <Term word="工作流">一鍵把多個步驟串起來（例如 文字→圖→影→音），每一步各自扣點。</Term>
        <Term word="來源素材">
          某些模型需要一個輸入檔（例如對嘴需要人臉圖、轉錄需要音檔）；可從素材庫選，或貼上網址。
        </Term>
        <Term word="鎖定素材">
          不可更動的原素材（師父原音、開示、配樂）。打包時原封放進 00_鎖定原素材，剪輯時圍繞它組裝、不改動。
        </Term>
        <Term word="組員">組內成員，可建專案、生成、加入分鏡。</Term>
        <Term word="組長">
          管理該組的人，可審核分鏡、調整組的「選項」（自訂內容類型／平台／世界觀選項）。
        </Term>
        <Term word="開發者">系統最高權限（原稱「超管」），管理所有團隊與帳號、設定點數額度。</Term>
      </div>

      <p style={{ marginTop: 24 }}>
        <Link href="/">回作業台</Link>
        <span className="hint" style={{ margin: "0 10px" }}>·</span>
        <Link href="/models">看模型指南</Link>
      </p>
    </div>
  );
}
