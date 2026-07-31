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
import { Icon } from "./components/Icon";

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

createRoot(document.getElementById("gallery-root")!).render(
  <StrictMode>
    <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap", padding: "0 16px" }}>
      <DensityColumn density="guide" label="引導模式 guide（新手預設）" />
      <DensityColumn density="concise" label="精簡模式 concise（熟手）" />
    </div>
  </StrictMode>,
);
