import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolResultPreview } from "./ToolResultPreview";

/**
 * 這支測試守的是「使用者看到的是工具真正查到的東西」這條承諾。
 *
 * 最容易悄悄壞掉的兩件事：
 * 1. 縮圖網址組錯（尤其 `?variant=thumb` 誤加在影片上——伺服器沒有影片縮圖，
 *    那會把原始影片整包載進手機）。
 * 2. 「還沒生成」與「素材遺失」被混為一談——前者是待辦，後者是壞掉，
 *    使用者的下一步完全不同。
 */
describe("ToolResultPreview", () => {
  describe("素材庫網格", () => {
    it("圖片素材用縮圖網址，並顯示標題", () => {
      render(
        <ToolResultPreview
          preview={{
            kind: "assets",
            truncated: false,
            items: [
              {
                assetId: "11111111-1111-4111-8111-111111111111",
                title: "主角定裝照",
                mediaKind: "image",
                aiGenerated: true,
                locked: false,
              },
            ],
          }}
        />,
      );
      const img = screen.getByAltText("主角定裝照");
      expect(img).toHaveAttribute(
        "src",
        "/api/assets/11111111-1111-4111-8111-111111111111/file?variant=thumb",
      );
      expect(img).toHaveAttribute("loading", "lazy");
    });

    it("影片素材不渲染 img（伺服器沒有影片縮圖，載原檔等於白吃頻寬）", () => {
      render(
        <ToolResultPreview
          preview={{
            kind: "assets",
            truncated: false,
            items: [
              {
                assetId: "22222222-2222-4222-8222-222222222222",
                title: "空景",
                mediaKind: "video",
                aiGenerated: false,
                locked: false,
              },
            ],
          }}
        />,
      );
      expect(document.querySelector("img")).toBeNull();
      // 仍要看得出這格是影片
      expect(screen.getByLabelText("空景（video）")).toBeInTheDocument();
    });

    it("撈到上限時明說只顯示一部分，且點明 AI 也只看到這些", () => {
      render(
        <ToolResultPreview
          preview={{
            kind: "assets",
            truncated: true,
            items: [
              { assetId: "a", title: "一", mediaKind: "image", aiGenerated: false, locked: false },
            ],
          }}
        />,
      );
      expect(screen.getByText(/AI 這次也只看到這些/)).toBeInTheDocument();
    });
  });

  describe("分鏡", () => {
    it("未填的提示詞顯示「（未填）」而不是留白", () => {
      render(
        <ToolResultPreview
          preview={{
            kind: "scene",
            scene: {
              sceneNo: 3,
              title: "開場",
              durationSec: 5,
              prompt: null,
              voiceover: null,
              visual: { source: "none", reason: "not_generated" },
              narration: { source: "none", reason: "not_generated" },
            },
          }}
        />,
      );
      expect(screen.getByText("提示詞：（未填）")).toBeInTheDocument();
      expect(screen.getByText("旁白：（未填）")).toBeInTheDocument();
    });

    it("素材被刪掉時顯示「素材遺失」，與「尚未生成」分開", () => {
      const { rerender } = render(
        <ToolResultPreview
          preview={{
            kind: "scene",
            scene: {
              sceneNo: 1,
              title: "一",
              durationSec: 3,
              prompt: null,
              voiceover: null,
              visual: { source: "none", reason: "missing" },
              narration: { source: "none", reason: "not_generated" },
            },
          }}
        />,
      );
      expect(screen.getByLabelText("素材遺失")).toBeInTheDocument();

      rerender(
        <ToolResultPreview
          preview={{
            kind: "scene",
            scene: {
              sceneNo: 1,
              title: "一",
              durationSec: 3,
              prompt: null,
              voiceover: null,
              visual: { source: "none", reason: "not_generated" },
              narration: { source: "none", reason: "not_generated" },
            },
          }}
        />,
      );
      expect(screen.queryByLabelText("素材遺失")).toBeNull();
      expect(screen.getAllByLabelText("尚未生成").length).toBeGreaterThan(0);
    });
  });

  describe("生成紀錄", () => {
    it("跑到一半的生成不顯示成品圖，狀態用 Pill 標示", () => {
      render(
        <ToolResultPreview
          preview={{
            kind: "generations",
            truncated: false,
            items: [
              {
                modelLabel: "FLUX",
                status: "running",
                statusLabel: "生成中",
                points: 3,
                prompt: "夕陽下的教室",
                media: { source: "none", reason: "not_generated" },
              },
            ],
          }}
        />,
      );
      expect(document.querySelector("img")).toBeNull();
      expect(screen.getByText("生成中")).toBeInTheDocument();
      expect(screen.getByText(/FLUX・3 點/)).toBeInTheDocument();
    });

    it("已完成且落地的生成顯示成品縮圖", () => {
      render(
        <ToolResultPreview
          preview={{
            kind: "generations",
            truncated: false,
            items: [
              {
                modelLabel: "FLUX",
                status: "done",
                statusLabel: "完成",
                points: 3,
                prompt: "夕陽下的教室",
                media: {
                  source: "asset",
                  assetId: "33333333-3333-4333-8333-333333333333",
                  mediaKind: "image",
                },
              },
            ],
          }}
        />,
      );
      expect(screen.getByAltText("夕陽下的教室")).toHaveAttribute(
        "src",
        "/api/assets/33333333-3333-4333-8333-333333333333/file?variant=thumb",
      );
    });
  });

  describe("資料庫列", () => {
    it("誠實說明 AI 讀了幾列、全表共幾列", () => {
      render(
        <ToolResultPreview
          preview={{
            kind: "rows",
            tableName: "器材清單",
            total: 137,
            rows: [{ cells: [{ label: "名稱", value: "攝影機" }] }],
          }}
        />,
      );
      expect(screen.getByText(/共 137 列，AI 這次讀了 1 列/)).toBeInTheDocument();
      expect(screen.getByText("攝影機")).toBeInTheDocument();
    });
  });

  it("kind:text 是降級出口，原樣顯示文字", () => {
    render(<ToolResultPreview preview={{ kind: "text", text: "（素材庫是空的）" }} />);
    expect(screen.getByText("（素材庫是空的）")).toBeInTheDocument();
  });
});
