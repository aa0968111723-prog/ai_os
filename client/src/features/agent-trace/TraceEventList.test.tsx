import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TraceEventList, type TraceEventLike } from "./TraceEventList";

function event(partial: Partial<TraceEventLike> & Pick<TraceEventLike, "id" | "eventType">): TraceEventLike {
  return { sequence: 1, summary: "摘要", payload: {}, ...partial };
}

/**
 * 這支測試守的是本次改動的核心承諾：**工具結果不再是要使用者自己讀的 JSON**。
 * 若哪天有人把 ToolResultPreview 拆掉、退回 `<pre>{JSON.stringify(...)}</pre>`，
 * 「素材縮圖直接渲染」那條會紅。
 */
describe("TraceEventList", () => {
  it("工具結果直接畫成實際內容，不是一坨 JSON", () => {
    render(
      <TraceEventList
        events={[
          event({
            id: "e1",
            eventType: "tool_result",
            summary: "查了素材庫(1 筆)",
            payload: {
              tool: "list_assets",
              result: "1. 主角定裝照｜image｜AI生成",
              preview: {
                kind: "assets",
                truncated: false,
                items: [
                  {
                    assetId: "44444444-4444-4444-8444-444444444444",
                    title: "主角定裝照",
                    mediaKind: "image",
                    aiGenerated: true,
                    locked: false,
                  },
                ],
              },
            },
          }),
        ]}
      />,
    );

    expect(screen.getByAltText("主角定裝照")).toBeInTheDocument();
    // 工具中文名要看得到，且不該出現原始 JSON
    expect(screen.getByText("素材庫")).toBeInTheDocument();
    expect(screen.queryByText(/"kind":/)).toBeNull();
  });

  it("耗時常駐顯示（這個欄位一直有記錄卻從沒顯示過）", () => {
    render(
      <TraceEventList
        events={[
          event({ id: "e1", eventType: "provider_response", summary: "收到回應", latencyMs: 1234 }),
          event({ id: "e2", eventType: "tool_result", summary: "查了素材庫", latencyMs: 800 }),
        ]}
      />,
    );
    expect(screen.getByText("1.2s")).toBeInTheDocument();
    expect(screen.getByText("800ms")).toBeInTheDocument();
  });

  it("技術事件維持可收合的原始 payload，預設收起", async () => {
    const user = userEvent.setup();
    render(
      <TraceEventList
        events={[
          event({
            id: "e1",
            eventType: "provider_request",
            summary: "送出第 1 輪模型請求",
            payload: { prompt: "你是專案助手" },
          }),
        ]}
      />,
    );
    const toggle = screen.getByRole("button", { name: /技術細節/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/你是專案助手/)).toBeInTheDocument();
  });

  it("工具呼叫的參數攤成 chips，讓使用者看得到 AI 用什麼條件查的", () => {
    render(
      <TraceEventList
        events={[
          event({
            id: "e1",
            eventType: "tool_call",
            summary: "呼叫 query_database",
            payload: { tool: "query_database", args: { dbRef: "db1", keyword: "攝影機" } },
          }),
        ]}
      />,
    );
    expect(screen.getByText("dbRef：db1")).toBeInTheDocument();
    expect(screen.getByText("keyword：攝影機")).toBeInTheDocument();
  });

  it("payload 沒有 preview 時降級成技術細節，不會爆掉", () => {
    render(
      <TraceEventList
        events={[event({ id: "e1", eventType: "tool_result", summary: "查了資料", payload: { tool: "x" } })]}
      />,
    );
    expect(screen.getByRole("button", { name: /技術細節/ })).toBeInTheDocument();
  });

  it("截斷過的欄位要講出來，否則使用者以為看到的是全部", () => {
    render(
      <TraceEventList
        events={[event({ id: "e1", eventType: "provider_request", truncatedFields: ["prompt"] })]}
      />,
    );
    expect(screen.getByText(/過長已截斷：prompt/)).toBeInTheDocument();
  });
});
