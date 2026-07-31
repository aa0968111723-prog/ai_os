import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  Badge,
  Button,
  Card,
  Chip,
  DensityProvider,
  EmptyState,
  Hint,
  Pill,
  Skeleton,
  type Density,
} from "./components/ui";
import "./styles.css";
import { Icon, ICON_NAMES } from "./components/Icon";

/**
 * Primitives 展示頁（**開發用，不進正式包**）。
 *
 * vite 的 build input 是 `client/index.html`，`gallery.html` 只在 dev server 出現：
 *   npm run dev  →  http://localhost:5173/gallery.html
 *
 * 用途有二：
 * 1. 在真實 styles.css 底下逐一檢視 primitives，作為每階段的瀏覽器驗證基準。
 * 2. 作為 Figma Library 的視覺依據——Figma 端的元件要對著這頁做，而不是對著想像做。
 *
 * 兩種密度並排呈現，讓「引導／精簡」的差異一眼可見。
 */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
      <code
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          color: "var(--fg-secondary)",
          minWidth: 190,
          flexShrink: 0,
        }}
      >
        {label}
      </code>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <div className="group-head">
        <span className="eyebrow cjk">{title}</span>
      </div>
      {children}
    </section>
  );
}

function Gallery() {
  return (
    <div className="app" style={{ paddingTop: 32, paddingBottom: 80 }}>
      <h1 style={{ fontFamily: "var(--serif)", fontSize: "var(--fs-32)", margin: "0 0 8px" }}>
        Primitives Gallery
      </h1>
      <Hint layer="always">
        client/src/components/ui 的全部元件。輸出的 class 與遷移前逐字相同，故換上元件不改變任何畫面。
      </Hint>

      <Group title="Button — 三級權重">
        <Row label='variant="primary"'>
          <Button variant="primary">建立專案</Button>
          <Button variant="primary" size="sm">
            送出
          </Button>
          <Button variant="primary" disabled>
            執行中
          </Button>
        </Row>
        <Row label='variant="tonal"'>
          <Button variant="tonal">套用範本</Button>
          <Button variant="tonal" size="sm">
            套用
          </Button>
        </Row>
        <Row label='variant="ghost"'>
          <Button variant="ghost">取消</Button>
          <Button variant="ghost" size="sm">
            複製
          </Button>
        </Row>
        <Row label='variant="neutral"'>
          <Button>次要動作</Button>
          <Button size="sm">次要</Button>
          <Button disabled>不可用</Button>
        </Row>
        <Row label='as="a"'>
          <Button as="a" href="#" variant="primary">
            前往作業台
          </Button>
          <Button as="a" href="#">
            說明
          </Button>
        </Row>
      </Group>

      <Group title="Card — 四種表面">
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
          <Card variant="primary">
            <h2>主卡 card--primary</h2>
            <Hint layer="always">左緣主色條、較寬內距。用於一頁的主角區塊。</Hint>
          </Card>
          <Card>
            <h3 style={{ margin: "0 0 6px" }}>一般卡 card</h3>
            <Hint layer="always">象牙紙表面，兩層暖陰影。</Hint>
          </Card>
          <Card variant="std">
            <h3 style={{ margin: "0 0 6px" }}>次要卡 card--std</h3>
            <Hint layer="always">低一階陰影，用於列表項。</Hint>
          </Card>
          <Card as="details" variant="quiet">
            <summary>可收合區 card--quiet</summary>
            <Hint layer="always">透明底髮絲框；展開後才浮起成卡面。</Hint>
          </Card>
        </div>
      </Group>

      <Group title="Chip — 展示 vs 可互動">
        <Row label="純展示">
          <Chip>AI</Chip>
          <Chip>人員</Chip>
          <Chip>總用量 12,480 tokens</Chip>
        </Row>
        <Row label="可互動（自動補鍵盤無障礙）">
          <Chip onClick={() => {}}>分鏡助理</Chip>
          <Chip onClick={() => {}} selected>
            生成員
          </Chip>
          <Chip onClick={() => {}}>配音統籌</Chip>
        </Row>
      </Group>

      <Group title="Pill / Badge — 狀態語意">
        <Row label="Pill status">
          <Pill status="queued">queued</Pill>
          <Pill status="running">running</Pill>
          <Pill status="done">done</Pill>
          <Pill status="failed">failed</Pill>
          <Pill>neutral</Pill>
        </Row>
        <Row label="Badge tone">
          <Badge>一般徽章</Badge>
          <Badge tone="mock">假資料模式</Badge>
        </Row>
      </Group>

      <Group title="Skeleton — 載入骨架">
        <Row label="width / height">
          <Skeleton width={84} height={52} radius={8} />
          <div style={{ display: "grid", gap: 8 }}>
            <Skeleton width={220} height={12} />
            <Skeleton width={160} height={12} />
          </div>
        </Row>
      </Group>

      <Group title="Hint — 新手／專家分層（本頁的重點）">
        <Row label='layer="guide"（預設）'>
          <div style={{ maxWidth: 420 }}>
            <Hint>選好風格後，之後每次生成都會自動帶入這個語氣與畫風。</Hint>
            <Hint>分鏡助理會先讀知識庫，再把腳本拆成一鏡一鏡。</Hint>
          </div>
        </Row>
        <Row label='layer="always"'>
          <div style={{ maxWidth: 420 }}>
            <Hint layer="always">本次將扣 12 點，執行後不退。</Hint>
            <Hint layer="always">Email 格式不對，請確認是否少了 @。</Hint>
          </div>
        </Row>
      </Group>

      <Group title="EmptyState — 必須有下一步">
        <EmptyState icon={<Icon name="Package" />}
          title="還沒有專案"
          description="建立第一個專案，或請組長邀請你加入既有專案。"
          action={<Button variant="primary">建立專案</Button>}
        />
      </Group>
    </div>
  );
}

function DensityColumn({ density, label }: { density: Density; label: string }) {
  return (
    <div style={{ flex: "1 1 480px", minWidth: 0 }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          background: "var(--popover)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-8)",
          padding: "8px 14px",
          marginBottom: 8,
        }}
      >
        <strong style={{ fontSize: "var(--fs-13)" }}>{label}</strong>
      </div>
      <DensityProvider value={density}>
        <Gallery />
      </DensityProvider>
    </div>
  );
}

/**
 * 圖示目錄。放在密度雙欄**之外**只渲染一次——圖示不隨密度變化，
 * 並排兩份只是雜訊。
 *
 * 存在理由：58 個圖示原本埋在一個 480 行的 Icon.tsx 裡，要用的人不知道
 * 有哪些可選，於是不是重複內嵌 SVG，就是退回用 emoji。名單由 ICON_NAMES
 * 執行期推導，新增圖示會自動出現在這裡，不需要有人記得回來補。
 */
function IconCatalogue() {
  const names = [...ICON_NAMES].sort((a, b) => a.localeCompare(b));
  return (
    <div className="app" style={{ paddingTop: 8, paddingBottom: 80 }}>
      <div className="group-head">
        <span className="eyebrow cjk">Icon — 可用圖示 {names.length} 個</span>
      </div>
      <Hint layer="always">
        寫 <code style={{ fontFamily: "var(--mono)" }}>&lt;Icon name="Search" /&gt;</code>。
        要新增請跑 <code style={{ fontFamily: "var(--mono)" }}>npm run icons:add -- Waypoints</code>，
        不要手抄 SVG 路徑——抄錯不會有測試抓得到。
      </Hint>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 4,
          marginTop: 12,
        }}
      >
        {names.map((name) => (
          <div
            key={name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              borderRadius: "var(--r-8)",
              border: "1px solid var(--border)",
              minWidth: 0,
            }}
          >
            <Icon name={name} size={18} />
            <code
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--fg-secondary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {name}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 讓這個模組重複執行也安全。
 *
 * 目前 Vite 對本檔的更新是整頁重載（本檔沒有匯出元件，Fast Refresh 會放棄），
 * 所以現況不會踩到——**這是防禦，不是在修一個正在發生的 bug**。但只要有人替
 * 本檔加上 `import.meta.hot.accept`，或 Fast Refresh 的判定改變，模組就會在
 * 同一個 window 裡重跑；那時對同一容器再 createRoot 會被 React 判為錯誤，
 * 而 console 正是這頁用來抓問題的地方，被洗版就等於沒有。
 */
const container = document.getElementById("gallery-root")!;
const holder = window as unknown as { __aiosGalleryRoot?: ReturnType<typeof createRoot> };
holder.__aiosGalleryRoot ??= createRoot(container);

holder.__aiosGalleryRoot.render(
  <StrictMode>
    <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap", padding: "0 16px" }}>
      <DensityColumn density="guide" label="引導模式 guide（新手預設）" />
      <DensityColumn density="concise" label="精簡模式 concise（熟手）" />
    </div>
    <div style={{ padding: "0 16px" }}>
      <IconCatalogue />
    </div>
  </StrictMode>,
);
