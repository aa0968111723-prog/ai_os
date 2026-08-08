import { Component, type ReactNode } from "react";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Meta } from "./ui/Meta";
import { Icon } from "./Icon";
import { buildCrashReport, isChunkLoadError, type CrashReport } from "../lib/crashReport";

/**
 * 區塊級錯誤邊界：把「整頁死亡」降級成「單區失能」。
 *
 * 全站 ErrorBoundary（main.tsx）包住整棵樹，任何單一 feature 的 render 錯誤都會把整頁
 * 變成「畫面出了點狀況」。創作流程核心（故事／分鏡／工作台／交付）全部同一頁，
 * 任一元件爆掉，使用者直接失去整個創作上下文——所以每個 stage 區塊各自包一顆，
 * 一區掛了其餘照常可用，頁面標頭、章節導覽、留言都不受影響。
 *
 * 與全域版相同的精神：錯誤摘要一定要看得見（console 對手機 PWA 使用者形同不存在），
 * 但呈現方式收斂成一張卡片，而不是整頁空狀態。
 */
export class SectionErrorBoundary extends Component<
  {
    /** 區塊名稱，顯示在降級卡上（例如「故事」「分鏡」「製作」「成片」） */
    title: string;
    /** 降級時的補充說明；缺省時用通用文案 */
    description?: string;
    children: ReactNode;
  },
  { error: Error | null; report: CrashReport | null; copied: boolean }
> {
  state: { error: Error | null; report: CrashReport | null; copied: boolean } = {
    error: null,
    report: null,
    copied: false,
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 讓真實 stack 出現在 console，方便診斷是哪一區、哪一層爆掉
    console.error(`[SectionErrorBoundary:${this.props.title}]`, error, info.componentStack);
    this.setState({
      report: buildCrashReport(error, info.componentStack, {
        url: typeof location === "undefined" ? undefined : location.href,
        userAgent: typeof navigator === "undefined" ? undefined : navigator.userAgent,
        at: new Date().toISOString(),
      }),
    });
  }

  /** chunk 載入失敗要繞過快取重載；一般重整可能又拿到同一份壞掉的 index.html。 */
  private reload = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("_r", String(Date.now()));
    window.location.replace(url.toString());
  };

  private copy = () => {
    const text = this.state.report?.detail ?? "";
    void navigator.clipboard?.writeText(text)
      .then(() => this.setState({ copied: true }))
      .catch(() => this.setState({ copied: false }));
  };

  render() {
    if (this.state.error) {
      const report = this.state.report;
      const chunk = isChunkLoadError(this.state.error);
      return (
        <Card
          variant="quiet"
          role="alert"
          data-fb={`${this.props.title}區塊錯誤`}
          style={{ padding: "14px 16px", margin: "8px 0" }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Icon name="TriangleAlert" size={18} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <strong style={{ display: "block", fontSize: 14 }}>
                {this.props.title}區塊暫時無法顯示
              </strong>
              <Meta as="p" style={{ margin: "4px 0 0", fontSize: 13 }}>
                {chunk
                  ? <>這一區的程式檔沒有載入完成——通常是網路不穩或版本剛更新。</>
                  : (this.props.description ?? "這個區塊發生非預期錯誤，其餘區塊不受影響。重新整理通常就能恢復。")}
              </Meta>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                <Button size="sm" variant="primary" onClick={this.reload}>重新整理</Button>
                {report && (
                  <details style={{ fontSize: 13 }}>
                    <summary style={{ cursor: "pointer" }}>錯誤詳情（回報時請附上）</summary>
                    <div style={{ marginTop: 8 }}>
                      <p className="mono" style={{ wordBreak: "break-word", margin: "0 0 8px" }}>{report.headline}</p>
                      <Button size="sm" variant="ghost" onClick={this.copy}>
                        {this.state.copied ? "已複製 ✓" : "複製錯誤詳情"}
                      </Button>
                    </div>
                  </details>
                )}
              </div>
            </div>
          </div>
        </Card>
      );
    }
    return this.props.children;
  }
}
