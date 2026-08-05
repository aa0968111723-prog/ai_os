import { Link } from "wouter";
import { BrandLogo } from "../components/BrandLogo";
import { Icon } from "../components/Icon";
import { Chip } from "../components/ui";

const CAPABILITIES = [
  { icon: "Lightbulb" as const, title: "先理解，再規劃", body: "AI 先整理目標、缺少資訊、風險與成功條件，再把工作拆成可核准的執行計畫。" },
  { icon: "Sparkles" as const, title: "AI 與團隊一起推進", body: "AI 任務、人類任務、筆記、排程與等待節點，都留在同一份專案脈絡裡。" },
  { icon: "CheckCircle2" as const, title: "每一步都有依據", body: "看得到資料來源、執行活動、成本與成果；高風險動作會先等待你的核准。" },
];

export function LandingPage() {
  return (
    <div className="public-site">
      <header className="public-header">
        <Link href="/" className="brand" aria-label="Aios 首頁">
          <BrandLogo variant="full" size="sm" responsive priority />
        </Link>
        <nav aria-label="公開網站導覽">
          <a href="#how-it-works">運作方式</a>
          <a href="#trust">安全與掌控</a>
          <Link href="/login" className="btn primary">登入工作台</Link>
        </nav>
      </header>

      <main id="main-content">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero__copy">
            <p className="eyebrow">團隊日常的 AI 專案工作台</p>
            <h1 id="landing-title">把想法，變成團隊真正能完成的計畫。</h1>
            <p className="landing-lead">
              Aios 會理解你的資料、規劃下一步，並協調 AI 與團隊工作。
              你隨時看得到進度、來源、成本與需要你決定的地方。
            </p>
            <div className="landing-actions">
              <Link href="/login" className="btn primary landing-primary-cta">
                進入工作台 <Icon name="ArrowRight" size={17} />
              </Link>
              <a href="#how-it-works" className="btn">看看怎麼運作</a>
            </div>
            <p className="landing-assurance"><Icon name="Lock" size={14} /> 重要操作先核准・不同團隊資料彼此隔離</p>
          </div>

          <div className="landing-preview" aria-label="AI 執行計畫範例">
            <div className="landing-preview__head">
              <span className="status-dot running" aria-hidden />
              <span>城市微光・活動準備</span>
              <Chip>執行中</Chip>
            </div>
            <div className="landing-plan-step done">
              <Icon name="Check" size={15} /><span><strong>理解企劃資料</strong><small>已整理目標與 6 項議題</small></span>
            </div>
            <div className="landing-plan-step active">
              <Icon name="Sparkles" size={15} /><span><strong>產生宣傳內容</strong><small>AI 正在整理文案與主視覺方向</small></span>
            </div>
            <div className="landing-plan-step waiting">
              <Icon name="Clock" size={15} /><span><strong>等待團隊確認</strong><small>攝影器材與參與名單</small></span>
            </div>
            <div className="landing-preview__footer"><span>3 / 8 步完成</span><span>預估 42 點</span></div>
          </div>
        </section>

        <section id="how-it-works" className="landing-section" aria-labelledby="capabilities-title">
          <p className="eyebrow">不只是一個生成器</p>
          <h2 id="capabilities-title">從一句目標，到可追蹤的完整執行</h2>
          <div className="landing-capabilities">
            {CAPABILITIES.map((item, index) => (
              <article key={item.title} className="landing-capability">
                <span className="landing-capability__number">0{index + 1}</span>
                <Icon name={item.icon} size={22} />
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="trust" className="landing-trust" aria-labelledby="trust-title">
          <div>
            <p className="eyebrow">人永遠握有方向盤</p>
            <h2 id="trust-title">AI 說明依據與動作，你決定是否前進。</h2>
          </div>
          <ul>
            <li><Icon name="Search" size={16} /> 查得到 AI 使用的專案資料與來源</li>
            <li><Icon name="Bell" size={16} /> 等待核准、阻塞與成果都有清楚提醒</li>
            <li><Icon name="Scale" size={16} /> 執行前看預估成本，執行後看實際結果</li>
          </ul>
        </section>
      </main>

      <footer className="public-footer">
        <BrandLogo variant="mark" size="xs" decorative />
        <span>Aios</span><span className="spacer" /><Link href="/login">登入</Link>
      </footer>
    </div>
  );
}
