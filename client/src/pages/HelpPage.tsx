import { type ReactNode } from "react";
import { Link } from "wouter";
import { Icon, type IconName } from "../components/Icon";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";

/**
 * 怎麼用 / 常見問題：純靜態白話說明頁（無資料查詢、無新依賴）。
 * 目標——創作者「一看這頁就懂整個網站」：
 *   ① 一句話總覽 ② 六步路線圖（視覺化） ③ 全站地圖（每個看得到的地方在幹嘛、在哪找）
 *   ④ 常見問題（點數/失敗退點/真生成/免費文字/交付/外部 AI） ⑤ 名詞小辭典。
 * 全用既有 tokens 與 class，貼合「黏土療癒」風；<details>/<summary> summary 為 ≥44px 觸控目標。
 */

/** 六步路線圖的一格：大編號＋圖示＋標題＋白話一句。橫向排、窄螢幕自動換行。 */
function Step({ n, icon, title, children }: { n: number; icon: IconName; title: string; children: ReactNode }) {
  return (
    <li
      className="card"
      style={{
        flex: "1 1 150px",
        minWidth: 150,
        margin: 0,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        listStyle: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          aria-hidden
          className="mono"
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "var(--primary-tint)",
            color: "var(--primary-ink)",
            display: "grid",
            placeItems: "center",
            fontSize: 12,
            fontWeight: 700,
            flex: "0 0 auto",
          }}
        >
          {n}
        </span>
        <Icon name={icon} size={15} />
        <b style={{ fontSize: "var(--fs-14)" }}>{title}</b>
      </div>
      <div className="hint" style={{ fontSize: 13, lineHeight: 1.65 }}>
        {children}
      </div>
    </li>
  );
}

/** 全站地圖的一列：圖示＋名稱＋「在哪找」小標＋白話一句。where 讓創作者知道去哪點。 */
function Spot({ icon, name, where, children }: { icon: IconName; name: string; where: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "10px 0", borderTop: "1px solid var(--border-soft)" }}>
      <div
        aria-hidden
        style={{
          width: 30,
          height: 30,
          borderRadius: "var(--r-8)",
          background: "var(--surface-sunken)",
          display: "grid",
          placeItems: "center",
          flex: "0 0 auto",
          marginTop: 1,
        }}
      >
        <Icon name={icon} size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <b style={{ fontSize: "var(--fs-14)" }}>{name}</b>
          <span className="chip" style={{ fontSize: 11 }}>{where}</span>
        </div>
        <div className="hint" style={{ fontSize: 13, lineHeight: 1.7, marginTop: 2 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** 全站地圖的一組：小標題＋若干 Spot。 */
function MapGroup({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  return (
    <div className="card" style={{ padding: "6px 16px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0 2px" }}>
        <Icon name={icon} size={16} />
        <b style={{ fontSize: "var(--fs-15)" }}>{title}</b>
      </div>
      {children}
    </div>
  );
}

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

/** 區塊小標：圖示＋文字，統一 h2 樣式。 */
function H2({ icon, children, id }: { icon: IconName; children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="secondary-section-heading">
      <Icon name={icon} size={18} />
      {children}
    </h2>
  );
}

export function HelpPage() {
  return (
    <div className="page-shell secondary-page secondary-page--reading help-page" data-fb="怎麼用頁">
      <SecondaryPageHeader
        eyebrow="快速上手"
        title="一頁看懂整個網站"
        icon="HelpCircle"
        badge="6 步完成一份作品"
        description={<>從第一份腳本到交付素材，先看完整路線，再依你卡住的地方往下找答案。</>}
      />
      <nav className="support-topic-nav" aria-label="說明主題">
        <a href="#help-route"><Icon name="Clapperboard" size={14} />六步路線</a>
        <a href="#help-map"><Icon name="MousePointer2" size={14} />功能地圖</a>
        <a href="#help-faq"><Icon name="Gem" size={14} />常見問題</a>
        <a href="#help-terms"><Icon name="FileText" size={14} />名詞辭典</a>
      </nav>

      {/* ── 一句話總覽：先給最大的那張圖，之後的一切都掛在這句上 ── */}
      <div className="card card--primary help-summary-card">
        <p style={{ margin: 0, fontSize: "var(--fs-16)", lineHeight: 1.85 }}>
          <b>一句話：</b>這個網站把「一份腳本」變成「一包可以直接拖進剪映或 Premiere 的素材」。
          你不用自己找圖、配音、對字幕；AI 會記住這支片的<b>世界觀</b>（背景、語氣、畫風），每次生成自動帶入。
          你主要做的事只有三件：<b>設定世界觀 → 逐格生成畫面／配音 → 排好順序送審、打包下載</b>。
        </p>
      </div>

      {/* ── 六步路線圖：把主線流程視覺化，一眼看見全貌 ── */}
      <H2 id="help-route" icon="Clapperboard">整條路線（六步）</H2>
      <p className="hint" style={{ marginTop: 0, fontSize: 13 }}>
        每個專案都走這條路。專案頁上方有「從這裡開始」清單，做到哪一步會自動打勾。
      </p>
      <ol style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: 0, margin: 0 }}>
        <Step n={1} icon="Palette" title="設世界觀">
          一句話故事、關鍵訊息、調性、畫風。填一次，之後每次生成自動帶入。
        </Step>
        <Step n={2} icon="Sparkles" title="AI 拆分鏡">
          在「AI 創作工作台」的問 AI 模式貼腳本，自動切成一格一格的分鏡草稿。
        </Step>
        <Step n={3} icon="Image" title="逐格生成">
          同一工作台切到「直接生成」：挑模型、寫提示詞，做出畫面（圖或影片）與旁白配音。
        </Step>
        <Step n={4} icon="SlidersHorizontal" title="排順序">
          把滿意的成品加入分鏡，用 ▲▼ 排成正確的鏡號順序。
        </Step>
        <Step n={5} icon="CheckCircle2" title="送審">
          送組長審核；通過後版本才算定案。
        </Step>
        <Step n={6} icon="Package" title="打包 zip">
          一鍵打包，分好資料夾、依鏡號排好，拖進剪輯軟體就能剪。
        </Step>
      </ol>

      {/* ── 全站地圖：這頁的重點——把每個看得到的地方講白話 ── */}
      <H2 id="help-map" icon="MousePointer2">這個網站有哪些地方？</H2>
      <p className="hint" style={{ marginTop: 0, fontSize: 13 }}>
        照你會遇到的順序列出來。<b>不是每個人都看得到全部</b>——管理相關的地方只有組長／管理員會出現。
      </p>
      <div className="stack">
        <MapGroup title="最上面那一排（頂欄・隨時都在）" icon="MousePointer2">
          <Spot icon="Gem" name="剩餘點數" where="頂欄">
            這顆鑽石徽章隨時顯示你還能生多少。滑上去看週／日上限與是哪一層額度最緊。
          </Spot>
          <Spot icon="Bell" name="待辦鈴鐺" where="頂欄・有待辦才出現">
            有幾筆分鏡等你審、幾格生成待核准。點開直接跳到那個專案。沒待辦就不出現。
          </Spot>
          <Spot icon="Clock" name="筆記排程" where="頂欄">
            週會、腳本審稿、待辦排進行事曆，也能寫會議紀錄。標題打 @人 可通知對方。
          </Spot>
          <Spot icon="Package" name="資料庫" where="頂欄">
            你自己的表格與資料集（例：器材借用表、拍攝清單）。可上傳文件給 AI 讀。
          </Spot>
          <Spot icon="User" name="你的名字（選單）" where="頂欄右上">
            點開有：模型指南、接上外部 AI、資料下載、我的回報、通知設定、改密碼、登出。
            組長／管理員還會多出<b>管理</b>那一組。多個組的話，左邊還有切換組別的選單。
          </Spot>
          <Spot icon="Bell" name="通知設定" where="你的名字選單裡">
            把手機和電腦連結進來，分鏡審批、私訊、@提及、生成完成會直接推到裝置上——
            <b>關掉網頁也收得到</b>。手機（iPhone 要先「加入主畫面」）和電腦各啟用一次，兩邊就都會響。
          </Spot>
        </MapGroup>

        <MapGroup title="作業台（登入後的首頁）" icon="Clapperboard">
          <Spot icon="Clapperboard" name="專案列表" where="作業台">
            你所有的片都在這。點「新專案」開一支，點卡片進去做。可搜尋、看狀態。
          </Spot>
          <Spot icon="Sparkles" name="團隊助手" where="作業台下方">
            用問的了解整組狀況——「哪個案子卡住了？這週花了多少點？」不用自己一頁頁翻。
          </Spot>
        </MapGroup>

        <MapGroup title="一個專案裡面（做片的地方，最常待）" icon="Image">
          <Spot icon="CheckCircle2" name="從這裡開始" where="專案頁最上方">
            四步清單，做到哪一步自動打勾；點某一步直接捲到對應區塊。第一次用照它走就對了。
          </Spot>
          <Spot icon="Palette" name="世界觀" where="專案頁">
            這支片的固定設定。填一次，之後每次生成 AI 都記得，不用一直重講背景。
          </Spot>
          <Spot icon="User" name="角色・場景" where="專案頁">
            常用的人物與場景先存起來，生成時一鍵勾選帶入，不必每次重打。
          </Spot>
          <Spot icon="FileText" name="知識庫" where="專案頁">
            貼上參考語料（文字），讓 AI 生成時有依據。放不宜外流的個資請留意。
          </Spot>
          <Spot icon="Image" name="素材庫" where="專案頁">
            你上傳或生成出來的圖片、影片、音檔都收在這。生成需要來源檔時從這裡挑。
          </Spot>
          <Spot icon="Sparkles" name="AI 創作工作台" where="專案頁② AI 創作中心">
            專案頁唯一的 AI 創作入口。四個模式在同一工作台切換：
            <b>問 AI</b>（發想、拆分鏡、查專案資料）、
            <b>直接生成</b>（挑模型、寫提示詞；世界觀自動帶入；送出前確認預估點數）、
            <b>製作範本</b>（固定步驟一次串起）、
            <b>執行計畫</b>（多步目標估點與核准，背景執行）。
            提示詞庫、生成紀錄與執行軌跡收在工作台底部的資源抽屜，不必再往下找好幾張平行長卡。
          </Spot>
          <Spot icon="Package" name="分鏡・交付" where="專案頁③">
            把成品加入分鏡、▲▼ 排順序、送審；通過後一鍵打包成 zip 下載。也可從工作台資源抽屜的生成紀錄直接「＋加入分鏡」。
          </Spot>
          <Spot icon="MessageCircle" name="專案留言" where="專案頁">
            專案內討論，可 @人。送審、通過、退回等事件也會自動貼進來，進度一目了然。
          </Spot>
        </MapGroup>

        <MapGroup title="給組長／管理員（一般組員不會看到）" icon="SlidersHorizontal">
          <Spot icon="Ellipsis" name="選項" where="選單・管理（組長）">
            自訂這一組能選的內容類型、平台、世界觀選項，讓下拉選單貼合你們的做法。
          </Spot>
          <Spot icon="User" name="通訊錄" where="選單・管理">
            團隊 → 組別 → 成員一層層攤開，邀請新夥伴（連結用 LINE 傳）、看誰在哪一組。
          </Spot>
          <Spot icon="FileText" name="監控與紀錄" where="選單・管理">
            點數消耗監控＋操作紀錄，看點花在哪、誰做了什麼；範圍自動收斂到你帶的組。
          </Spot>
          <Spot icon="SlidersHorizontal" name="團隊管理" where="選單・管理（管理員）">
            帳號、點數與額度（總預算／週上限／個人覆寫）、一鍵系統自檢七大子系統。
          </Spot>
        </MapGroup>

        <MapGroup title="其他好用的" icon="Info">
          <Spot icon="Info" name="模型指南" where="選單・說明">
            70+ 個模型分 11 類、旗艦／經濟／最省，可搜「中文、對嘴、金句」找對模型；含一鍵串鏈的製作範本。
          </Spot>
          <Spot icon="Sparkles" name="接上外部 AI" where="選單・工作">
            建金鑰讓 Claude 等外部 AI 用<b>你的身分</b>直接操作專案（MCP）。可設唯讀、會到期的金鑰。
          </Spot>
          <Spot icon="Download" name="資料下載" where="選單・工作">
            交付過的 zip 都留在這，隨時回頭重新下載。
          </Spot>
          <Spot icon="MessageCircle" name="我的回報／回饋" where="選單・帳號＋右下浮標">
            右下角浮標隨時能提意見或回報問題；「我的回報」看管理員的回覆。
          </Spot>
        </MapGroup>
      </div>

      {/* ── 常見問題：保留原本準確的答覆，聚焦錢/失敗/真假/免費 ── */}
      <H2 id="help-faq" icon="Gem">常見問題</H2>
      <div className="stack">
        <Faq q="「點數」是什麼？大概要生多久？" defaultOpen>
          <ul style={{ margin: 0, paddingLeft: 22 }}>
            <li>
              點數＝每次生成要花的額度（1 點 ≈ NT$1）。每個模型旁邊都標「X 點／次」，
              <b>送出前會先跳確認框</b>讓你看預估點數，點頭才真的扣。
            </li>
            <li>
              額度由<b>管理員</b>設定（可設週上限、日上限，或不限）。頂欄的{" "}
              <Icon name="Gem" size={13} style={{ verticalAlign: "-2px" }} /> 徽章隨時看得到目前剩多少。
            </li>
            <li>
              生成需要一點時間（圖較快、影片較久）。送出後那一格會顯示「排隊中／生成中」，
              好了自動變「完成」，不用一直守著。
            </li>
          </ul>
        </Faq>

        <Faq q="生成失敗會不會白白扣點？">
          <p style={{ margin: 0 }}>
            <b>不會，失敗自動全額退點。</b>不論是送出失敗、還是生成中途失敗，系統都會退回那一次的點數，
            並在該格標「失敗（已退點）」。你只會為真正做出來的成品付費。
          </p>
        </Faq>

        <Faq q="生成是真的在呼叫 AI 嗎？">
          <ul style={{ margin: 0, paddingLeft: 22 }}>
            <li>是。系統一律以<b>正式模式</b>運作：每次生成都實際呼叫 AI 供應商產出成品，並依模型標示扣點。</li>
            <li>
              若管理員尚未設定 AI 供應商金鑰（FAL_KEY），生成會直接顯示明確的失敗訊息並<b>自動退點</b>——
              不會偷偷回傳示範素材。
            </li>
            <li>金鑰狀態可由管理員在「團隊管理→跑系統自檢」的「生成模式」項目確認。</li>
          </ul>
        </Faq>

        <Faq q="AI 文字功能為什麼免費？有什麼限制？">
          <ul style={{ margin: 0, paddingLeft: 22 }}>
            <li>
              <b>AI 創作工作台「問 AI／執行計畫」模式的文字能力（問答、發想、拆分鏡、排計畫）、團隊彙總、留言 @助手</b>走 NVIDIA NIM 的免費開發者方案，
              <b>不扣站內點數</b>；圖片／影片／音訊生成（工作台「直接生成／製作範本」）仍走付費供應商、照模型標示扣點。
            </li>
            <li>
              NIM 免費方案的限制：<b>試用點數制</b>（註冊約 1,000 次呼叫，商用信箱可申請至 5,000 次）、
              流量約<b>每分鐘 40 次</b>（全站共用一把金鑰），且屬評估用途、無正式服務保證。
            </li>
            <li>
              打到限制時畫面會直接告訴你原因：「流量達上限」等一分鐘就好；「試用點數用完」請管理員到
              build.nvidia.com 檢查帳號、換新金鑰或申請加值——不影響圖片／影片生成與已有的成品。
            </li>
            <li className="hint" style={{ fontSize: 12 }}>
              提醒：這些功能會把世界觀與知識庫節錄送到 NVIDIA 雲端運算——請避免在知識庫放不宜外流的個資。
            </li>
          </ul>
        </Faq>

        <Faq q="做好後怎麼交付？zip 裡面長怎樣？">
          <p style={{ marginTop: 0 }}>
            分鏡送審通過後，在<b>「分鏡・交付」</b>區一鍵打包下載一包 zip。資料夾用業界通用的編號命名、
            依鏡號排好（有內容的資料夾才會出現）：
          </p>
          <ul style={{ margin: "0 0 8px", paddingLeft: 22 }}>
            <li><b>01_視頻素材</b>——影片類成品，依鏡號排序</li>
            <li><b>02_旁白音檔</b>——逐鏡旁白配音，檔名鏡號對應畫面與字幕</li>
            <li><b>03_圖像</b>——圖片類成品</li>
            <li><b>04_字幕</b>——字幕.srt，可直接匯入剪映／Premiere／YouTube</li>
            <li><b>05_文件</b>——腳本與鏡頭表.md（每鏡的秒數、檔名、提示詞、模型一覽）</li>
            <li><b>交付</b>——時間軸與字幕檔：時間軸.fcpxml（Final Cut Pro／DaVinci Resolve／剪映專業版）、
              Premiere時間軸.xml、字幕.srt、剪輯表.edl</li>
          </ul>
          <p className="hint" style={{ margin: "0 0 8px", fontSize: 13 }}>
            若專案有<b>鎖定素材</b>，會多一個 00_鎖定原素材（原封不動的原音／開示／配樂）；
            另附 README.txt 說明資料夾結構與各軟體匯入步驟。
          </p>
          <p style={{ margin: "0 0 8px" }}>
            <b>最快的組片方式</b>：解壓後直接把「交付/」裡對應你剪輯軟體的時間軸檔匯入
            （Premiere 用 .xml、Final Cut Pro／Resolve／剪映專業版用 .fcpxml）——
            分鏡順序、每鏡秒數與旁白音軌會自動排上時間軸，媒體以相對路徑自動掛上，離線時 relink 一次即可。
          </p>
          <p style={{ margin: 0 }}>
            用剪映／CapCut 的話，另有<b>「剪映草稿包（實驗）」</b>：解壓到剪映草稿目錄，打開剪映就是排好的專案
            （含畫面、旁白、字幕三軌；目錄位置見包內安裝說明）。也可以照舊把媒體檔拖進剪映，配合字幕.srt 逐鏡對位。
          </p>
        </Faq>

        <Faq q="想讓 Claude 等外部 AI 直接操作我的專案？">
          <p style={{ marginTop: 0 }}>
            系統提供 <b>MCP</b>（Model Context Protocol）介面，讓外部 AI 客戶端連進來，替你查專案、挑模型、送生成、貼留言。關鍵是：
            <b>連進來的身分就是「你」</b>——只碰得到你有份的組與專案，扣的是你的點數額度，一樣受審批門檻限制。
            每個人用<b>自己的金鑰</b>，不共用、可隨時撤銷。
          </p>
          <p style={{ margin: 0 }}>
            到 <Link href="/mcp"><b>「接上外部 AI」專區</b></Link> 建立金鑰、複製客戶端設定、測試連線，
            並看可用工具與近期活動。也能建「唯讀」或「會到期」的金鑰交給自動化。
          </p>
        </Faq>
      </div>

      {/* ── 名詞小辭典 ── */}
      <H2 id="help-terms" icon="FileText">名詞小辭典</H2>
      <div className="card">
        <Term word="世界觀">
          這支片的固定設定（一句話故事、關鍵訊息、調性、視覺風格、禁忌）。填一次，之後每次生成自動帶入，不用重講背景。
        </Term>
        <Term word="分鏡">把片子切成一格一格的鏡頭；每一格有秒數、畫面，可配旁白與字幕。</Term>
        <Term word="逐鏡配音">
          一格一格分開生成的旁白音檔，檔名鏡號對應該鏡畫面，剪輯時把同鏡號的旁白對齊該鏡即可。
        </Term>
        <Term word="製作範本">一鍵把多個步驟串起來（例如 文字→圖→影→音），每一步各自扣點。底層仍是固定工作流，但使用者介面統一稱製作範本。</Term>
        <Term word="來源素材">
          某些模型需要一個輸入檔（例如對嘴需要人臉圖、轉錄需要音檔）；可從素材庫選，或貼上網址。
        </Term>
        <Term word="鎖定素材">
          不可更動的原素材（師父原音、開示、配樂）。打包時原封放進 00_鎖定原素材，剪輯時圍繞它組裝、不改動。
        </Term>
        <Term word="知識庫">
          貼給 AI 參考的文字語料，讓生成有依據（也就是 RAG）。內容會送到雲端運算，別放不宜外流的個資。
        </Term>
        <Term word="MCP">
          讓外部 AI（如 Claude）用你的身分連進來操作專案的介面。用自己的金鑰，受同樣的組隔離與審批限制。
        </Term>
        <Term word="組員">組內成員，可建專案、生成、加入分鏡。</Term>
        <Term word="組長">
          管理該組的人，可審核分鏡、調整組的「選項」（自訂內容類型／平台／世界觀選項）。
        </Term>
        <Term word="開發者／管理員">系統最高權限，管理所有團隊與帳號、設定點數額度。</Term>
      </div>

      <p style={{ marginTop: 24 }}>
        <Link href="/dashboard">回今日工作台</Link>
        <span className="hint" style={{ margin: "0 10px" }}>·</span>
        <Link href="/models">看模型指南</Link>
        <span className="hint" style={{ margin: "0 10px" }}>·</span>
        <Link href="/mcp">接上外部 AI</Link>
      </p>
    </div>
  );
}
