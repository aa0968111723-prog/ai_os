import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AskSources, type AskSourcesData } from "./AskSources";

vi.mock("./Icon", () => ({ Icon: () => null }));

/**
 * 「本次依據」的產品契約（P5 / §30）：
 * 誠實優先於好看。被截斷、完全沒讀到的都要說出來——使用者若以為 AI 看過全部，
 * 會把一個「只看了一半」的回答當成完整判斷。
 */

function sources(over: Partial<AskSourcesData> = {}): AskSourcesData {
  return {
    items: [
      { id: "k1", title: "影片腳本", kind: "script", status: "full", chars: 1200, includedChars: 1200 },
    ],
    truncated: false,
    budgetChars: 8000,
    includedChars: 1200,
    totalContentChars: 1200,
    ...over,
  };
}

describe("AskSources", () => {
  it("沒有依據資料時什麼都不算繪（空的「本次依據」只是噪音）", () => {
    const { container } = render(<AskSources sources={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("專案完全沒有知識資料時也不出現", () => {
    const { container } = render(<AskSources sources={sources({ items: [] })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("列出讀了哪幾份與各自完整度", () => {
    render(<AskSources sources={sources()} />);
    expect(screen.getByText("影片腳本")).toBeInTheDocument();
    expect(screen.getByText("全部讀取")).toBeInTheDocument();
    expect(screen.getByText(/讀了 1 份/)).toBeInTheDocument();
  });

  it("★ 被上限截斷時一定要說出來，並說明可以怎麼辦", () => {
    render(<AskSources sources={sources({
      items: [
        { id: "k1", title: "長逐字稿", kind: "transcript", status: "partial", chars: 40000, includedChars: 8000 },
      ],
      truncated: true,
    })} />);
    expect(screen.getByText(/有內容未完整使用/)).toBeInTheDocument();
    expect(screen.getByText(/部分資料因內容過長未完整使用/)).toBeInTheDocument();
    expect(screen.getByText("只讀了一部分")).toBeInTheDocument();
  });

  it("部分讀取的篇目要看得到「全文多少字／這次讀了多少」", () => {
    render(<AskSources sources={sources({
      items: [
        { id: "k1", title: "長逐字稿", kind: "transcript", status: "partial", chars: 40000, includedChars: 8000 },
      ],
      truncated: true,
    })} />);
    const badge = screen.getByText("只讀了一部分");
    expect(badge.getAttribute("title")).toContain("40,000 字");
    expect(badge.getAttribute("title")).toContain("8,000 字");
  });

  it("★ 完全沒讀到的篇目也要列出來——不能假裝它不存在", () => {
    render(<AskSources sources={sources({
      items: [
        { id: "k1", title: "腳本", kind: "script", status: "full", chars: 100, includedChars: 100 },
        { id: "k2", title: "會議紀錄", kind: "note", status: "skipped", chars: 5000, includedChars: 0 },
      ],
    })} />);
    expect(screen.getByText("會議紀錄")).toBeInTheDocument();
    expect(screen.getByText("這次沒讀到")).toBeInTheDocument();
    expect(screen.getByText(/有 1 份這次沒有讀到/)).toBeInTheDocument();
  });

  it("一份都沒讀到時，摘要不能說「讀了 0 份」而要講人話", () => {
    render(<AskSources sources={sources({
      items: [
        { id: "k1", title: "腳本", kind: "script", status: "skipped", chars: 100, includedChars: 0 },
      ],
    })} />);
    expect(screen.getByText(/這次沒有讀到任何資料/)).toBeInTheDocument();
  });

  it("預設收合，不跟回答本身搶版面", () => {
    const { container } = render(<AskSources sources={sources()} />);
    expect(container.querySelector("details")).not.toHaveAttribute("open");
  });

  it("展開後分辨 EMPTY、TIMEOUT 與 retrieval timing", () => {
    render(<AskSources sources={sources({
      items: [
        { id: "r1", title: "知識", kind: "resource", status: "skipped", chars: 0, includedChars: 0, outcome: "EMPTY", retrieval: "hybrid", durationMs: 12, attempts: 1 },
        { id: "r2", title: "資料庫", kind: "resource", status: "skipped", chars: 0, includedChars: 0, outcome: "TIMEOUT", retrieval: "hybrid", durationMs: 4000, attempts: 1 },
      ],
    })} />);
    expect(screen.getByText("沒有符合資料")).toBeInTheDocument();
    expect(screen.getByText("逾時，已略過")).toBeInTheDocument();
    expect(screen.getByText("hybrid（關鍵字＋中繼資料）・12 ms")).toBeInTheDocument();
  });
});
