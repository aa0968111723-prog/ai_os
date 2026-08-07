import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssistantTrace, LiveAssistantTrace } from "./AssistantTrace";

describe("AssistantTrace", () => {
  it("does not render an empty completed trace", () => {
    const { container } = render(<AssistantTrace events={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("summarises safe activity and keeps details collapsed by default", async () => {
    const user = userEvent.setup();
    render(
      <AssistantTrace
        events={[
          { phase: "lookup", text: "查詢素材庫" },
          { phase: "step", text: "整理完成" },
        ]}
        elapsedMs={1250}
        fallback
      />,
    );

    const details = screen.getByText("執行軌跡").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText(/查詢 1 次/)).toHaveTextContent("完成 1 步");
    expect(screen.getByText(/查詢 1 次/)).toHaveTextContent("1.3 秒");
    expect(screen.getByText(/查詢 1 次/)).toHaveTextContent("備援回應");

    await user.click(screen.getByText("執行軌跡"));
    expect(details).toHaveAttribute("open");
    expect(screen.getByText("查詢素材庫")).toBeVisible();
    expect(screen.getByText("整理完成")).toBeVisible();
  });
});

describe("LiveAssistantTrace", () => {
  it("supports collapsing and cancelling without exposing private reasoning", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <LiveAssistantTrace events={[]} open onToggle={onToggle} onCancel={onCancel} />,
    );

    expect(screen.getByText("連線中…")).toBeVisible();
    expect(screen.getByText(/不含模型私密推理/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: /執行軌跡/ }));
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(
      <LiveAssistantTrace
        events={[{ phase: "lookup", text: "讀取專案資料" }]}
        open={false}
        onToggle={onToggle}
        onCancel={onCancel}
      />,
    );
    expect(screen.queryByText("讀取專案資料")).not.toBeInTheDocument();
    expect(screen.getByText("1 個事件")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

/**
 * 即時軌跡的工具結果預覽。
 *
 * 這批改動之前，問答進行中使用者只看得到「正在查素材庫…」一行字，要等到事後打開
 * 「實際運作紀錄」才知道查到了什麼——而那正是他當下最想知道的事。
 */
describe("工具結果預覽", () => {
  it("串流中的工具步驟直接顯示查到的素材縮圖", () => {
    render(
      <LiveAssistantTrace
        open
        onToggle={() => {}}
        onCancel={() => {}}
        events={[
          {
            phase: "step",
            text: "查了素材庫(1 筆)",
            tool: "list_assets",
            preview: {
              kind: "assets",
              truncated: false,
              items: [
                {
                  assetId: "55555555-5555-4555-8555-555555555555",
                  title: "開場空景",
                  mediaKind: "image",
                  aiGenerated: true,
                  locked: false,
                },
              ],
            },
          },
        ]}
      />,
    );
    expect(screen.getByAltText("開場空景")).toHaveAttribute(
      "src",
      "/api/assets/55555555-5555-4555-8555-555555555555/file?variant=thumb",
    );
  });

  it("回答完成後預覽仍保留在該則的軌跡裡", async () => {
    const user = userEvent.setup();
    render(
      <AssistantTrace
        events={[
          {
            phase: "step",
            text: "讀了第 2 鏡",
            tool: "read_scene",
            preview: {
              kind: "scene",
              scene: {
                sceneNo: 2,
                title: "走廊",
                durationSec: 4,
                prompt: "長鏡頭推進",
                voiceover: null,
                visual: { source: "none", reason: "not_generated" },
                narration: { source: "none", reason: "not_generated" },
              },
            },
          },
        ]}
      />,
    );
    await user.click(screen.getByText("執行軌跡"));
    expect(screen.getByText("提示詞：長鏡頭推進")).toBeVisible();
  });

  it("沒有 preview 的事件照舊只顯示一行字（不需前後端同步部署）", () => {
    render(
      <LiveAssistantTrace
        open
        onToggle={() => {}}
        onCancel={() => {}}
        events={[{ phase: "lookup", text: "正在查素材庫…" }]}
      />,
    );
    expect(screen.getByText("正在查素材庫…")).toBeVisible();
    expect(document.querySelector("img")).toBeNull();
  });

  it("未知的 preview kind 安靜略過，不讓整條軌跡爆掉", () => {
    render(
      <LiveAssistantTrace
        open
        onToggle={() => {}}
        onCancel={() => {}}
        events={[
          {
            phase: "step",
            text: "查了某個新工具",
            // 舊資料或未來新增的 kind：執行期真的會出現，型別擋不住
            preview: { kind: "future_kind_not_yet_known" } as never,
          },
        ]}
      />,
    );
    expect(screen.getByText("查了某個新工具")).toBeVisible();
  });
});
