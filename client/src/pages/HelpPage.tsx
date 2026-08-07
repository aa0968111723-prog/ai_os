import { type ReactNode } from "react";
import { Link } from "wouter";
import { Icon, type IconName } from "../components/Icon";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";
import { Card, Chip, Hint, Meta } from "../components/ui";

/**
 * 怎麼用 / 常見問題：純靜態白話說明頁（無資料查詢、無新依賴）。
 * 目標——創作者「一看這頁就懂整個網站」：
 *   ① 一句話總覽 ② 六步路線圖 ③ 全站地圖 ④ 進階能力 ⑤ FAQ ⑥ 安裝 ⑦ 名詞辭典
 * 進階含：知識優先、世界觀 chips、代理職能、母版系列、回收桶、素材落地／備份、誰在線、成本審核。
 * 全用既有 tokens 與 class；<details>/<summary> summary 為 ≥44px 觸控目標。
 */

/** 六步路線圖的一格：大編號＋圖示＋標題＋白話一句。橫向排、窄螢幕自動換行。 */
function Step({ n, icon, title, children }: { n: number; icon: IconName; title: string; children: ReactNode }) {
  return (
    <Card
      as="li"
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
      <Meta as="div" style={{ fontSize: 13, lineHeight: 1.65 }}>
        {children}
      </Meta>
    </Card>
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
          <Chip style={{ fontSize: 11 }}>{where}</Chip>
        </div>
        <Meta as="div" style={{ fontSize: 13, lineHeight: 1.7, marginTop: 2 }}>
          {children}
        </Meta>
      </div>
    </div>
  );
}

/** 全站地圖的一組：小標題＋若干 Spot。 */
function MapGroup({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  return (
    <Card style={{ padding: "6px 16px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0 2px" }}>
        <Icon name={icon} size={16} />
        <b style={{ fontSize: "var(--fs-15)" }}>{title}</b>
      </div>
      {children}
    </Card>
  );
}

/** 單則問答：折疊卡片，標題即 summary（可鍵盤展開）；defaultOpen 讓第一則預設展開。 */
function Faq({ q, defaultOpen = false, children }: { q: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <Card as="details" open={defaultOpen} style={{ padding: 0, overflow: "hidden" }}>
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
    </Card>
  );
}

/** 名詞小辭典的一列：粗體詞＋白話解釋。 */
function Term({ word, children }: { word: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <b>{word}</b>
      <Meta as="div" style={{ fontSize: "var(--fs-14)", lineHeight: 1.75, marginTop: 2 }}>
        {children}
      </Meta>
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
        badge="6 步＋進階能力"
        description={<>從第一份腳本到交付素材的完整路線，加上知識庫、代理、母版系列、素材保全等新能力——卡住就往下找答案。</>}
      />
      <nav className="support-topic-nav" aria-label="說明主題">
        <a href="#help-route"><Icon name="Clapperboard" size={14} />六步路線</a>
        <a href="#help-map"><Icon name="MousePointer2" size={14} />功能地圖</a>
        <a href="#help-advanced"><Icon name="Sparkles" size={14} />進階能力</a>
        <a href="#help-faq"><Icon name="Gem" size={14} />常見問題</a>
        <a href="#help-install"><Icon name="Download" size={14} />安裝 App</a>
        <a href="#help-terms"><Icon name="FileText" size={14} />名詞辭典</a>
      </nav>

      {/* ── 一句話總覽：先給最大的那張圖，之後的一切都掛在這句上 ── */}
      <Card variant="primary" className="help-summary-card">
        <p style={{ margin: 0, fontSize: "var(--fs-16)", lineHeight: 1.85 }}>
          <b>一句話：</b>這個網站把「一份腳本」變成「一包可以直接拖進剪映或 Premiere 的素材」。
          AI 會記住這支片的<b>世界觀</b>（背景、語氣、畫風）與你勾選的<b>知識／角色／場景</b>，每次生成自動帶入。
          主線只有三件事：<b>設定世界觀 → 逐格生成畫面／配音 → 排好順序送審、打包下載</b>。
          需要多步自動化時，改用工作台的<b>執行計畫</b>（AI 職能排程，核准後背景跑）；
          週更同規格內容可用<b>母版系列</b>一鍵開集。
        </p>
      </Card>

      {/* ── 六步路線圖：把主線流程視覺化，一眼看見全貌 ── */}
      <H2 id="help-route" icon="Clapperboard">整條路線（六步）</H2>
      <Meta as="p" style={{ marginTop: 0, fontSize: 13 }}>
        每個專案都走這條路。專案頁上方有「從這裡開始」清單，做到哪一步會自動打勾。
      </Meta>
      <ol style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: 0, margin: 0 }}>
        <Step n={1} icon="Palette" title="設世界觀">
          一句話故事（或關鍵訊息）＋調性／畫風 chips（可多選、有優先序）。填一次，生成與助手自動帶入；進階觀眾／三幕／人物給導演用。
        </Step>
        <Step n={2} icon="Sparkles" title="AI 拆分鏡">
          工作台「問 AI」貼腳本；可勾<b>本次知識優先</b>，先吃你指定的知識庫再拆成一格一格草稿。
        </Step>
        <Step n={3} icon="Image" title="逐格生成">
          「直接生成」挑模型、寫提示詞；勾角色定裝／場景設定讓跨鏡一致。送出前看預估點數。
        </Step>
        <Step n={4} icon="SlidersHorizontal" title="排順序">
          滿意的成品加入分鏡，▲▼ 排鏡號；單格可開「單格工作室」改提示詞、配音、版本。
        </Step>
        <Step n={5} icon="CheckCircle2" title="送審">
          送組長審核；通過才算定案。高額生成可能還要組長「成本核准」才真正送出。
        </Step>
        <Step n={6} icon="Package" title="打包 zip">
          一鍵打包，資料夾依鏡號排好；含字幕／時間軸，拖進剪映或 Premiere 就能剪。
        </Step>
      </ol>

      {/* ── 全站地圖：這頁的重點——把每個看得到的地方講白話 ── */}
      <H2 id="help-map" icon="MousePointer2">這個網站有哪些地方？</H2>
      <Hint layer="always" style={{ marginTop: 0, fontSize: 13 }}>
        照你會遇到的順序列出來。<b>不是每個人都看得到全部</b>——管理相關的地方只有組長／管理員會出現。
      </Hint>
      <div className="stack">
        <MapGroup title="最上面那一排（頂欄・隨時都在）" icon="MousePointer2">
          <Spot icon="Ellipsis" name="手機底部分頁列" where="手機・螢幕最下面">
            手機沒有頂欄那排連結，改成貼底五顆：<b>今日、專案、AI 工作、筆記排程、更多</b>。
            「更多」點開就是<b>全站頁面總表</b>（靈感頻道、資料庫、私訊、怎麼用、模型指南、
            接上外部 AI、連接的資料來源、共用下載）——手機上要換頁面一律從這裡走，
            右上角頭像只管「我與團隊」。
          </Spot>
          <Spot icon="Gem" name="剩餘點數" where="頂欄">
            這顆鑽石徽章隨時顯示你還能生多少。滑上去看週／日上限與是哪一層額度最緊；帳號選單裡有更完整的個人用量條。
          </Spot>
          <Spot icon="Bell" name="待辦鈴鐺" where="頂欄・有待辦才出現">
            有幾筆分鏡等你審、幾格生成待核准（含成本門檻待核）。點開直接跳到那個專案。沒待辦就不出現。
          </Spot>
          <Spot icon="User" name="誰在線" where="頂欄（有協作時）">
            同組目前在線的夥伴，不必進私訊就看得到——方便找人對稿、請審。
          </Spot>
          <Spot icon="Clock" name="筆記排程" where="電腦頂欄／手機分頁列">
            週會、腳本審稿、待辦排進行事曆，也能寫會議紀錄。標題打 @人 可通知對方；可串 Google 日曆（整合連接）。
          </Spot>
          <Spot icon="Package" name="資料庫" where="電腦頂欄／手機「更多」">
            你自己的表格與資料集（例：器材借用表、拍攝清單）。可上傳文件、匯入 Google／Notion，給 AI 讀。
          </Spot>
          <Spot icon="MessageCircle" name="私訊" where="電腦頂欄／手機「更多」">
            一對一討論；可附圖檔。與專案留言分開——私訊只有雙方看得到。
          </Spot>
          <Spot icon="User" name="你的名字（選單）" where="頂欄右上・手機為貼底選單">
            <b>手機</b>這裡放的是「我與團隊」：點數用量、我的回報、通知設定、<b>安裝成 App</b>、
            改密碼、登出；要去別的頁面請按最底下的<b>「更多」</b>。<b>電腦</b>沒有底部分頁列，
            所以同一個選單多列了說明／工作兩組（模型指南、接上外部 AI、靈感頻道、
            連接的資料來源、共用下載、桌面 Companion）。組長／管理員還會多出<b>管理</b>那一組。多個組可切換作用組。
          </Spot>
          <Spot icon="Download" name="安裝成 App" where="橫幅或帳號選單">
            加到主畫面／桌面，像真正 App 一樣開。完整步驟見
            <a href="#help-install">「把 Aios 裝到手機或電腦」</a>。
          </Spot>
          <Spot icon="Bell" name="通知設定" where="你的名字選單裡">
            把手機和電腦連結進來，成本核准、私訊、@提及、生成完成會直接推到裝置——
            <b>關掉網頁也收得到</b>。手機（iPhone 要先「加入主畫面」）和電腦各啟用一次。
          </Spot>
        </MapGroup>

        <MapGroup title="作業台（登入後的首頁）" icon="Clapperboard">
          <Spot icon="Clapperboard" name="專案列表" where="作業台">
            你所有的片都在這。點「新專案」開一支，點卡片進去做。可搜尋、篩類型、看狀態；勾「顯示已封存」可找回封存案。
          </Spot>
          <Spot icon="FileText" name="母版系列" where="作業台（有開啟時）">
            週更同規格內容：組長建一次母版，每集只要填 4 格變數（主題／原句／禁忌／日期）就開出新專案，規格跟母版走。
          </Spot>
          <Spot icon="Sparkles" name="團隊助手／組代理總指揮" where="作業台下方">
            用問的了解整組狀況——「哪個案子卡住了？這週花了多少點？」；組長可看多專案代理進度與阻塞。
          </Spot>
        </MapGroup>

        <MapGroup title="一個專案裡面（做片的地方，最常待）" icon="Image">
          <Spot icon="CheckCircle2" name="從這裡開始" where="專案頁最上方">
            四步清單，做到哪一步自動打勾；點某一步直接捲到對應區塊。第一次用照它走就對了。
          </Spot>
          <Spot icon="Palette" name="世界觀" where="專案頁">
            這支片的固定設定：一句話故事、關鍵訊息、調性／畫風 chips（可多選、有主副優先序）。
            填一次，之後生成與助手自動帶入；進階欄位（觀眾、三幕、敘事人物）主要餵給導演／拆分鏡。
          </Spot>
          <Spot icon="User" name="角色・場景" where="專案頁">
            角色定裝卡鎖定外觀、場景設定卡鎖定色板／光線；生成時勾選注入，跨鏡較一致（最多角色 6、場景 4）。
          </Spot>
          <Spot icon="FileText" name="知識庫" where="專案頁">
            貼上參考語料（文字／從素材轉入），讓 AI 有依據。可<b>置頂</b>優先注入；工作台可勾
            <b>本次知識優先</b>只餵你點名的幾筆。不宜外流的個資請別放。
          </Spot>
          <Spot icon="Image" name="素材庫" where="專案頁">
            上傳或生成的圖／影／音都收在這。刪除先進<b>回收桶</b>（可還原）；需要來源檔的模型從這裡挑。
            鎖定素材（原音／開示）打包時原封保留。
          </Spot>
          <Spot icon="Sparkles" name="AI 創作工作台" where="專案頁② AI 創作中心">
            專案頁唯一的 AI 創作入口。四個模式同一工作台切換：
            <b>問 AI</b>（發想、拆分鏡、查資料；可帶本次知識優先）、
            <b>直接生成</b>（挑模型、寫提示詞；世界觀／定裝／場景自動帶入；送出前確認預估點數）、
            <b>製作範本</b>（固定步驟一次串起）、
            <b>執行計畫</b>（AI 職能排多步；估點核准後背景執行——關頁也繼續跑）。
            提示詞庫、生成紀錄與執行軌跡在底部資源抽屜。
          </Spot>
          <Spot icon="Package" name="分鏡・交付" where="專案頁③">
            把成品排成一支片：流程條（排分鏡→補畫面→配音→送審→打包）告訴你下一步。
            點縮圖開<b>單格工作室</b>改提示詞、換模型、配音、版本。全部通過後下方打包 zip。
          </Spot>
          <Spot icon="MessageCircle" name="專案留言" where="專案頁">
            專案內討論，可 @人、釘選重要決議。送審／通過／退回會自動貼進來。
          </Spot>
          <Spot icon="Trash2" name="回收桶" where="專案頁（素材／分鏡／知識）">
            軟刪除的項目可還原；永久刪除才真的拿不回。回收桶裡的內容不會再被 AI 注入，也不能當生成來源。
          </Spot>
        </MapGroup>

        <MapGroup title="給組長／管理員（一般組員不會看到）" icon="SlidersHorizontal">
          <Spot icon="Ellipsis" name="自訂選項" where="就在需要它的地方（組長）">
            內容類型、發布平台在「建立新專案」表單裡直接加；調性／主軸／視覺風格在專案的世界觀 chips 旁邊加。
            加完全組立即可用。要改名、停用或排序，從那些「＋新增」旁的「整理全部選項」進去。
          </Spot>
          <Spot icon="User" name="通訊錄" where="選單・管理">
            團隊 → 組別 → 成員一層層攤開，邀請新夥伴（連結用 LINE 傳）、看誰在哪一組。
          </Spot>
          <Spot icon="FileText" name="監控與紀錄" where="選單・管理">
            點數消耗監控＋操作紀錄，看點花在哪、誰做了什麼；範圍自動收斂到你帶的組。
            組長的「成本審核門檻」與「點數分配」也在這一頁。
          </Spot>
          <Spot icon="SlidersHorizontal" name="團隊管理" where="選單・管理（管理員）">
            帳號、點數與額度（總預算／週上限／個人覆寫）、系統自檢、
            <b>素材儲存健康</b>（Volume 是否持久、缺檔對帳、立即下載素材備份）。
          </Spot>
        </MapGroup>

        <MapGroup title="其他好用的" icon="Info">
          <Spot icon="Info" name="模型指南" where="電腦：選單・說明／手機：更多・說明">
            大量模型分 11 類、旗艦／經濟／最省，可搜「中文、對嘴、金句」找對模型；含製作範本。
          </Spot>
          <Spot icon="Sparkles" name="接上外部 AI" where="電腦：選單・工作／手機：更多・連接與下載">
            建金鑰讓 Claude 等外部 AI 用<b>你的身分</b>操作專案（MCP）。可設唯讀、會到期。
          </Spot>
          <Spot icon="Download" name="共用下載／匯出我的資料" where="共用下載在電腦選單・工作或手機「更多」；匯出我的個人資料一律在帳號選單">
            交付過的 zip 可再下；帳號選單「匯出我的個人資料」含帳號、組別、
            <b>相關專案</b>（世界觀／分鏡／知識／角色／場景摘要）、生成、留言、筆記、排程（不含密碼與媒體檔）。
          </Spot>
          <Spot icon="Monitor" name="桌面 Companion" where="電腦：選單・工作">
            給本機剪輯／桌面橋接用：交接進度、外部編輯器開啟素材（需桌面端）。
          </Spot>
          <Spot icon="MessageCircle" name="我的回報／回饋" where="選單・帳號＋右下浮標">
            右下角浮標隨時提意見或回報問題；「我的回報」看管理員回覆。
          </Spot>
          <Spot icon="Share2" name="連接的資料來源" where="電腦：選單・工作／手機：更多・連接與下載">
            連結 Google 日曆／雲端、Notion、Adobe 等，方便匯入文件與同步行程。
          </Spot>
        </MapGroup>
      </div>

      {/* ── 進階能力：新知識濃縮 ── */}
      <H2 id="help-advanced" icon="Sparkles">進階能力（一看就懂）</H2>
      <Hint layer="always" style={{ marginTop: 0, fontSize: 13 }}>
        主線六步夠做完整支片；下面這些能讓「更穩、更快、更敢放心用」。
      </Hint>
      <div className="stack">
        <Card style={{ padding: "14px 16px" }}>
          <b style={{ fontSize: "var(--fs-14)" }}>本次知識優先</b>
          <Meta as="p" style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.75 }}>
            在工作台「問 AI／執行計畫」可勾你這次要優先餵給模型的知識庫條目（可搭配置頂知識）。
            適合：這集只用某段開示、不想整庫知識搶上下文預算。沒勾＝照預設排序（置頂優先）注入。
          </Meta>
        </Card>
        <Card style={{ padding: "14px 16px" }}>
          <b style={{ fontSize: "var(--fs-14)" }}>世界觀 chips 與注入</b>
          <Meta as="p" style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.75 }}>
            調性／風格可多選，有主副優先序；圖／影生成會把故事錨點與風格寫進提示詞（禁忌走負向）。
            觀眾、三幕、敘事人物較完整餵給拆分鏡與文字類 AI。細節見名詞辭典「世界觀」。
          </Meta>
        </Card>
        <Card style={{ padding: "14px 16px" }}>
          <b style={{ fontSize: "var(--fs-14)" }}>執行計畫與 AI 職能</b>
          <Meta as="p" style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.75 }}>
            「分鏡助理／生成員」等是<b>AI 職能標籤</b>，不是真人組員。你核准估點後，伺服器背景逐步執行——
            關瀏覽器也繼續。一支失敗不會讓其他已送出的生成永遠卡住；權限被降成檢視者會停止新寫入。
          </Meta>
        </Card>
        <Card style={{ padding: "14px 16px" }}>
          <b style={{ fontSize: "var(--fs-14)" }}>成本審核門檻</b>
          <Meta as="p" style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.75 }}>
            組長若設了「單筆達 X 點要核准」，組員送高價生成會先變「待核」——不扣點、不送 AI，
            組長在生成紀錄按准後才扣點送出。待核也會進頂欄鈴鐺。
          </Meta>
        </Card>
        <Card style={{ padding: "14px 16px" }}>
          <b style={{ fontSize: "var(--fs-14)" }}>素材落地與備份（別讓成品變死連結）</b>
          <Meta as="p" style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.75 }}>
            生成完成後系統會把檔案抓回自家 Volume 永久保存（不只留外部 CDN）。
            若出現「素材儲存警示」橫幅，請先下載備份、通知部署負責人掛好持久磁碟。
            管理員可在團隊管理下載全站素材 tar.gz；排程可用備份權杖 curl 拉取。
          </Meta>
        </Card>
        <Card style={{ padding: "14px 16px" }}>
          <b style={{ fontSize: "var(--fs-14)" }}>專案權限：檢視者</b>
          <Meta as="p" style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.75 }}>
            組長可把某人設成此專案的「檢視者」：能看、留言、下載，但不能生成、改分鏡／知識／世界觀。
            需要編輯請找組長改權限。
          </Meta>
        </Card>
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
              <b>AI 創作工作台「問 AI」的問答、發想、拆分鏡、團隊彙總、留言 @助手</b>走 NVIDIA NIM 的免費開發者方案，
              <b>不扣站內點數</b>；圖片／影片／音訊生成（工作台「直接生成／製作範本」）仍走付費供應商、照模型標示扣點。
            </li>
            <li>
              <b>例外：代理排計畫（多步計畫、組代理調度計畫）預設用高品質付費模型</b>——規劃品質決定後面要花多少執行點數，
              所以這一步不省。它<b>依實際 token 扣點</b>（一次約數點，送出前的確認框會寫明），想省的人可在規劃卡改成均衡、省點數或免費檔。
            </li>
            <li>
              NIM 免費方案的限制：<b>試用點數制</b>（註冊約 1,000 次呼叫，商用信箱可申請至 5,000 次）、
              流量約<b>每分鐘 40 次</b>（全站共用一把金鑰），且屬評估用途、無正式服務保證。
            </li>
            <li>
              打到限制時畫面會直接告訴你原因：「流量達上限」等一分鐘就好；「試用點數用完」請管理員到
              build.nvidia.com 檢查帳號、換新金鑰或申請加值——不影響圖片／影片生成與已有的成品。
            </li>
            <Meta as="li" style={{ fontSize: 12 }}>
              提醒：這些功能會把世界觀與知識庫節錄送到 NVIDIA 雲端運算——請避免在知識庫放不宜外流的個資。
            </Meta>
          </ul>
        </Faq>

        <Faq q="做好後怎麼交付？zip 裡面長怎樣？">
          <p style={{ marginTop: 0 }}>
            分鏡送審通過後，在<b>「分鏡・交付」最下方的「交付」區</b>一鍵打包下載一包 zip。資料夾用業界通用的編號命名、
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
          <Meta as="p" style={{ margin: "0 0 8px", fontSize: 13 }}>
            若專案有<b>鎖定素材</b>，會多一個 00_鎖定原素材（原封不動的原音／開示／配樂）；
            另附 README.txt 說明資料夾結構與各軟體匯入步驟。
          </Meta>
          <p style={{ margin: "0 0 8px" }}>
            <b>最快的組片方式</b>：解壓後直接把「交付/」裡對應你剪輯軟體的時間軸檔匯入
            （Premiere 用 .xml、Final Cut Pro／Resolve／剪映專業版用 .fcpxml）——
            分鏡順序、每鏡秒數與旁白音軌會自動排上時間軸，媒體以相對路徑自動掛上，離線時 relink 一次即可。
          </p>
          <p style={{ margin: 0 }}>
            用剪映／CapCut 的話，交付區的<b>「進階：只要單檔」</b>摺疊裡另有<b>「剪映草稿包（實驗）」</b>：解壓到剪映草稿目錄，打開剪映就是排好的專案
            （含畫面、旁白、字幕三軌；目錄位置見包內安裝說明）。也可以照舊把媒體檔拖進剪映，配合字幕.srt 逐鏡對位。
            只要對位參考、不要媒體的骨架版時間軸單檔（.fcpxml／.xml／.srt／.edl）也收在同一個摺疊區。
          </p>
        </Faq>

        <Faq q="想讓 Claude 等外部 AI 直接操作我的專案？">
          <p style={{ marginTop: 0 }}>
            系統提供 <b>MCP</b>（Model Context Protocol）介面，讓外部 AI 客戶端連進來，替你查專案、挑模型、送生成、貼留言。關鍵是：
            <b>連進來的身分就是「你」</b>——只碰得到你有份的組與專案，扣的是你的點數額度，一樣受成本門檻限制。
            每個人用<b>自己的金鑰</b>，不共用、可隨時撤銷。
          </p>
          <p style={{ margin: 0 }}>
            到 <Link href="/mcp"><b>「接上外部 AI」專區</b></Link> 建立金鑰、複製客戶端設定、測試連線，
            並看可用工具與近期活動。也能建「唯讀」或「會到期」的金鑰交給自動化。
          </p>
        </Faq>

        <Faq q="「本次知識優先」是什麼？跟置頂有何不同？">
          <ul style={{ margin: 0, paddingLeft: 22 }}>
            <li>
              <b>置頂</b>：知識庫裡長期優先注入的條目（適合常備開示／規格）。
            </li>
            <li>
              <b>本次知識優先</b>：只在這一次「問 AI／執行計畫」勾選，強制這幾筆先進上下文，
              避免整庫長文搶光預算。兩者可並用。
            </li>
          </ul>
        </Faq>

        <Faq q="刪掉的素材／分鏡／知識還在嗎？">
          <p style={{ marginTop: 0 }}>
            一般刪除＝丟進<b>回收桶</b>（軟刪除）：可還原；期間不會再被 AI 注入，也不能當生成來源。
            在回收桶再按「永久刪除」才真的拿不回（且素材永久刪才會清 Volume 檔）。
            <b>刪除不會退點</b>——點數是真金，已完成的生成不因刪檔退費。
          </p>
        </Faq>

        <Faq q="為什麼送出生成後變成「待核准」？">
          <p style={{ marginTop: 0 }}>
            組長設了成本審核門檻時，組員單筆估點達到門檻會先排隊等組長按准——
            <b>這時還沒扣點、也還沒送 AI</b>。核准後才扣點送出；駁回則不扣點。
            可在生成紀錄或頂欄待辦鈴鐺處理。
          </p>
        </Faq>

        <Faq q="成品會不會過幾天就打不開？">
          <p style={{ marginTop: 0 }}>
            正常情況不會：生成完成後系統會把檔案「落地」存進自家磁碟（Volume），網址改成站內永久路徑。
            若畫面出現黃色<b>素材儲存警示</b>，代表持久磁碟可能沒掛好——請立刻備份並通知管理員，
            並暫時不要刪本機原始檔。管理員可在團隊管理下載全站素材備份包。
          </p>
        </Faq>

        <Faq q="母版系列怎麼用？">
          <ol style={{ margin: 0, paddingLeft: 22 }}>
            <li>組長在作業台建立一次母版（規格＋分鏡空殼，不花點數）。</li>
            <li>之後開集：填主題、原句／出處、禁忌、截止日期四格（沒有就填「無」）。</li>
            <li>專案名會自動變成「系列｜日期｜主題」，其餘規格跟母版，不要每集重設世界觀。</li>
          </ol>
        </Faq>

        <Faq q="專案被設成「檢視者」還能做什麼？">
          <p style={{ marginTop: 0 }}>
            能看內容、留言、下載交付；不能生成、改分鏡／知識／世界觀／上傳素材。
            若你本來是編輯者卻突然不能寫，可能是組長改了專案權限——請對方在專案權限卡調整。
          </p>
        </Faq>
      </div>

      {/* ── 安裝成 App（橫幅／帳號選單／深鏈 #help-install 同源；Mobile-First M0-3／M4） ── */}
      <H2 id="help-install" icon="Download">把 Aios 裝到手機或電腦</H2>
      <Hint layer="always" style={{ marginTop: 0, fontSize: 13 }}>
        裝成 App 後可從主畫面一鍵開啟、推播較穩、全螢幕較好用。
        頂欄橫幅按「稍後」只是暫時不煩你——<b>帳號選單裡的「安裝成 App」隨時都在</b>。
      </Hint>
      <div className="stack">
        <Faq q="Android／Chrome：怎麼安裝？" defaultOpen>
          <ol style={{ margin: 0, paddingLeft: 22 }}>
            <li>用 <b>Chrome</b> 打開本站並登入。</li>
            <li>若出現「安裝 Aios」橫幅，按 <b>安裝</b>。</li>
            <li>沒看到橫幅：點瀏覽器選單 <b>⋮</b> → <b>安裝應用程式</b>／「加到主畫面」。</li>
            <li>或打開頂欄右上<b>你的名字</b> → <b>安裝成 App</b>。</li>
          </ol>
          <Meta as="p" style={{ margin: "10px 0 0", fontSize: 13 }}>
            安裝後主畫面會有圖示；之後建議從圖示開啟（standalone），推播與全螢幕體驗較完整。
          </Meta>
        </Faq>
        <Faq q="iPhone／iPad（Safari）：怎麼加入主畫面？">
          <ol style={{ margin: 0, paddingLeft: 22 }}>
            <li>必須用 <b>Safari</b>（Chrome 在 iOS 無法完整安裝 PWA）。</li>
            <li>打開本站並登入。</li>
            <li>點底部分享鈕 <b>□↑</b> → 往下捲 → <b>加入主畫面</b> → 新增。</li>
            <li>之後從主畫面圖示開啟；再進帳號選單開「通知設定」才能收推播。</li>
          </ol>
          <Meta as="p" style={{ margin: "10px 0 0", fontSize: 13 }}>
            iOS 不支援程式直接跳出「安裝」提示，所以橫幅會導來本段說明；帳號選單同一入口。
          </Meta>
        </Faq>
        <Faq q="電腦（Chrome／Edge）怎麼裝？">
          <ol style={{ margin: 0, paddingLeft: 22 }}>
            <li>用 Chrome 或 Edge 打開本站。</li>
            <li>網址列右側若有安裝圖示，點它；或選單 → 安裝 Aios。</li>
            <li>也可從帳號選單「安裝成 App」。</li>
          </ol>
        </Faq>
        <Faq q="按了「稍後」還找得到安裝入口嗎？">
          <p style={{ marginTop: 0 }}>
            找得到。<b>「稍後」只隱藏頂部橫幅約 14 天</b>，不會關掉安裝能力。
            要裝時：頂欄右上你的名字 → <b>安裝成 App</b>，或回到本段照步驟做。
          </p>
        </Faq>
        <Faq q="裝好後要怎麼開推播？">
          <p style={{ marginTop: 0 }}>
            帳號選單 → <b>通知設定</b> → 在這台裝置啟用。
            手機與電腦要各啟用一次；成本核准、私訊、生成完成才會推到裝置（關掉分頁也收得到）。
          </p>
        </Faq>
      </div>

      {/* ── 名詞小辭典 ── */}
      <H2 id="help-terms" icon="FileText">名詞小辭典</H2>
      <Card>
        <Term word="世界觀">
          這支片的固定設定。調性／風格 chips（可多選、有優先序）、訊息／禁忌會在生成時帶入；
          目標觀眾、三幕、敘事人物主要給導演／拆分鏡。畫面人物一致請另建「角色定裝卡」。
        </Term>
        <Term word="角色定裝卡／場景設定卡">
          鎖人物外觀或場景色板／光線；生成時勾選注入，讓多鏡看起來像同一支片。
        </Term>
        <Term word="分鏡">把片子切成一格一格的鏡頭；每一格有秒數、畫面，可配旁白與字幕。</Term>
        <Term word="單格工作室">點分鏡縮圖打開：只改這一格的提示詞、模型、配音、版本，不牽動其他格。</Term>
        <Term word="逐鏡配音">
          一格一格分開生成的旁白音檔，檔名鏡號對應該鏡畫面，剪輯時把同鏡號的旁白對齊該鏡即可。
        </Term>
        <Term word="製作範本">一鍵把多個步驟串起來（例如 文字→圖→影→音），每一步各自扣點。</Term>
        <Term word="執行計畫／AI 職能">
          把多步目標排成可核准的計畫；「分鏡助理」等是 AI 職能標籤不是真人。核准後背景執行。
        </Term>
        <Term word="母版系列">
          組長建一次規格母版；每集填 4 格變數就開新專案，週更同規格超省事。
        </Term>
        <Term word="來源素材">
          某些模型需要輸入檔（對嘴要人臉圖、轉錄要音檔）；從素材庫選或貼網址。回收桶裡的不能當來源。
        </Term>
        <Term word="鎖定素材">
          不可更動的原素材（原音／開示／配樂）。打包時原封放進 00_鎖定原素材。
        </Term>
        <Term word="落地">
          把 AI 供應商的暫存網址抓回自家磁碟永久保存，避免幾天後 CDN 過期變死連結。
        </Term>
        <Term word="知識庫／置頂／本次知識優先">
          貼給 AI 的文字依據。置頂＝長期優先；本次知識優先＝這一次勾選才強制優先。別放個資。
        </Term>
        <Term word="回收桶">
          軟刪除暫存區，可還原；永久刪除才清掉。回收中內容不進 AI、不進交付包。
        </Term>
        <Term word="成本審核門檻">
          組員單筆估點達門檻時先等組長核准，才扣點送 AI。
        </Term>
        <Term word="專案檢視者">
          此專案唯讀角色：能看與留言，不能改內容或生成。與「組員」身份可並存。
        </Term>
        <Term word="MCP">
          讓外部 AI（如 Claude）用你的身分連進來操作專案。自己的金鑰、同樣組隔離與成本門檻。
        </Term>
        <Term word="組員">組內成員，可建專案、生成、加入分鏡（除非某專案被設成檢視者）。</Term>
        <Term word="組長">
          管理該組：審核分鏡、成本核准、調整選項、邀請成員。
        </Term>
        <Term word="開發者／管理員">系統最高權限：團隊與帳號、點數額度、系統自檢、素材全站備份。</Term>
      </Card>

      <p style={{ marginTop: 24 }}>
        <Link href="/dashboard">回今日工作台</Link>
        <Meta style={{ margin: "0 10px" }}>·</Meta>
        <Link href="/models">看模型指南</Link>
        <Meta style={{ margin: "0 10px" }}>·</Meta>
        <Link href="/mcp">接上外部 AI</Link>
        <Meta style={{ margin: "0 10px" }}>·</Meta>
        <Link href="/help#help-advanced">進階能力</Link>
      </p>
    </div>
  );
}
