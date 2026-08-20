import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CutosVideoPanel } from "./CutosVideoPanel";

/**
 * 面板的驗收重點只有兩個：一律繁中、只講真的發生過的事。
 * 這裡刻意用「原始 messageKey」餵進去，確認畫面顯示的是中文而不是 key。
 */

const connected = {
  reachable: true,
  compatible: true,
  messageKey: "cutos.status.connected",
  protocolVersion: "cutos.agent.v2",
  latencyMs: 42,
};

const project = {
  cutosProjectId: "cutos-1",
  cutosProjectName: "訪談原檔",
  timelineRevision: 7,
};

const activity = [
  {
    id: "a1",
    kind: "analyze",
    status: "started",
    messageKey: "activity.analyze.started",
    occurredAt: "2026-08-19T10:05:00.000Z",
  },
  {
    id: "a2",
    kind: "transcript",
    status: "completed",
    messageKey: "activity.transcript.completed",
    occurredAt: "2026-08-19T10:06:00.000Z",
  },
  {
    id: "a3",
    kind: "semantic_search",
    status: "completed",
    messageKey: "activity.semantic_search.completed",
    metadata: { count: 8 },
    occurredAt: "2026-08-19T10:07:00.000Z",
  },
  {
    id: "a4",
    kind: "apply",
    status: "failed",
    messageKey: "activity.apply.failed",
    occurredAt: "2026-08-19T10:08:00.000Z",
  },
];

describe("CutosVideoPanel", () => {
  it("顯示連線狀態與協定版本", () => {
    render(<CutosVideoPanel connection={connected} project={project} />);
    expect(screen.getByText("CUTOS 已連線")).toBeInTheDocument();
    expect(screen.getByText(/cutos\.agent\.v2/)).toBeInTheDocument();
    expect(screen.getByText(/延遲 42 毫秒/)).toBeInTheDocument();
  });

  it("未連線時顯示未連線，不顯示原始例外", () => {
    render(
      <CutosVideoPanel
        connection={{ reachable: false, compatible: false, messageKey: "cutos.status.disconnected" }}
      />,
    );
    expect(screen.getByText("CUTOS 未連線")).toBeInTheDocument();
    expect(screen.queryByText(/Error|ECONNREFUSED|stack/)).toBeNull();
  });

  it("版本不相容時明講版本不相容", () => {
    render(
      <CutosVideoPanel
        connection={{ reachable: true, compatible: false, messageKey: "aios.protocol.mismatch" }}
        project={project}
      />,
    );
    expect(screen.getByText("CUTOS 版本不相容")).toBeInTheDocument();
  });

  it("顯示已連結的影片專案與時間軸版本", () => {
    render(<CutosVideoPanel connection={connected} project={project} />);
    expect(screen.getByText(/已連結 CUTOS 專案：訪談原檔/)).toBeInTheDocument();
    expect(screen.getByText(/時間軸版本 7/)).toBeInTheDocument();
  });

  it("尚未連結時引導使用者去連結", () => {
    render(<CutosVideoPanel connection={connected} />);
    expect(screen.getByText("尚未連結 CUTOS 影片專案")).toBeInTheDocument();
  });

  it("把事件 key 轉成繁中進度，不顯示原始 key", () => {
    render(<CutosVideoPanel connection={connected} project={project} activity={activity} />);
    expect(screen.getByText("正在分析影片")).toBeInTheDocument();
    expect(screen.getByText("逐字稿已完成")).toBeInTheDocument();
    expect(screen.getByText("已找到相關片段（8）")).toBeInTheDocument();
    expect(screen.getByText("套用修改失敗")).toBeInTheDocument();
    expect(screen.queryByText(/activity\./)).toBeNull();
  });

  it("等待確認時說明會刪掉多少內容", () => {
    render(
      <CutosVideoPanel
        connection={connected}
        project={project}
        approval={{
          reasonCode: "removes_more_than_30_percent",
          messageKey: "aios.approval.removesMost",
          removedRatio: 0.62,
          keptRatio: 0.38,
        }}
      />,
    );
    expect(screen.getByText("等待你的確認")).toBeInTheDocument();
    expect(screen.getByText("這次修改會刪掉超過三成的影片內容")).toBeInTheDocument();
    expect(screen.getByText(/預計刪除 62%，保留 38%/)).toBeInTheDocument();
  });

  it("錯誤顯示可行動的中文", () => {
    render(
      <CutosVideoPanel connection={connected} project={project} error="aios.error.staleRevision" />,
    );
    expect(screen.getByText("時間軸已被更動，這份剪輯計畫需要重新產生")).toBeInTheDocument();
  });

  it("未知的事件鍵回中文預設值而不是英文", () => {
    render(
      <CutosVideoPanel
        connection={connected}
        project={project}
        activity={[{
          id: "x",
          kind: "mystery",
          status: "started",
          messageKey: "activity.mystery.started",
          occurredAt: "2026-08-19T10:00:00.000Z",
        }]}
      />,
    );
    expect(screen.getByText("處理中")).toBeInTheDocument();
  });

  it("整個面板沒有英文回退字串", () => {
    const { container } = render(
      <CutosVideoPanel connection={connected} project={project} activity={activity} />,
    );
    const text = container.textContent ?? "";
    // 允許專有名詞與協定版本字串，其餘不得出現英文句子。
    const stripped = text.replace(/CUTOS|AI-OS|cutos\.agent\.v2/g, "");
    expect(stripped).not.toMatch(/[a-zA-Z]{4,}/);
  });

  it("沒有活動時也不顯示假的進度", () => {
    render(<CutosVideoPanel connection={connected} project={project} />);
    expect(screen.getByText("還沒有影片處理紀錄。")).toBeInTheDocument();
    expect(screen.queryByText("正在分析影片")).toBeNull();
  });
});
