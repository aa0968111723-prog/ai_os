import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Badge, Button, Card, Chip, DensityProvider, EmptyState, Hint, Meta, Pill, Skeleton, cx } from ".";

/**
 * 這批測試的重點不是「元件會渲染」，而是 **class 輸出與遷移前逐字相同**。
 * 只要這些斷言綠燈，把裸 class 換成 primitives 就不會有任何視覺變化——
 * 這是整個漸進遷移計畫的安全保證。
 */

describe("cx", () => {
  it("丟掉 falsy 並保留順序", () => {
    expect(cx("a", false, undefined, "b", null, "c")).toBe("a b c");
  });
});

describe("Button — class 契約", () => {
  it.each([
    [{}, null],
    [{ variant: "primary" as const }, "primary"],
    [{ variant: "tonal" as const }, "tonal"],
    [{ variant: "ghost" as const }, "btn-ghost"],
    [{ variant: "primary" as const, size: "sm" as const }, "primary btn-sm"],
    [{ size: "sm" as const }, "btn-sm"],
  ])("%o → class %s", (props, expected) => {
    const { container } = render(<Button {...props}>送出</Button>);
    const el = container.querySelector("button")!;
    expect(el.getAttribute("class")).toBe(expected);
  });

  it("預設 type=button，避免誤觸表單送出", () => {
    const { container } = render(<Button>送出</Button>);
    expect(container.querySelector("button")).toHaveAttribute("type", "button");
  });

  it("呼叫端 className 疊加在變體之後", () => {
    const { container } = render(
      <Button variant="primary" size="sm" className="wide">
        送出
      </Button>,
    );
    expect(container.querySelector("button")!.getAttribute("class")).toBe("primary btn-sm wide");
  });

  it("as=a 需要 btn 基底（全域 button 選擇器吃不到錨點）", () => {
    const { container } = render(
      <Button as="a" href="/x" variant="primary">
        前往
      </Button>,
    );
    expect(container.querySelector("a")!.getAttribute("class")).toBe("btn primary");
  });

  it("as=a 的 ghost 不疊 btn，免得雙重 padding", () => {
    const { container } = render(
      <Button as="a" href="/x" variant="ghost">
        取消
      </Button>,
    );
    expect(container.querySelector("a")!.getAttribute("class")).toBe("btn-ghost");
  });

  it("點擊會觸發 onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>送出</Button>);
    await userEvent.click(screen.getByRole("button", { name: "送出" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("Card — class 契約", () => {
  it.each([
    [{}, "card"],
    [{ variant: "primary" as const }, "card card--primary"],
    [{ variant: "std" as const }, "card card--std"],
    [{ variant: "quiet" as const }, "card card--quiet"],
  ])("%o → class %s", (props, expected) => {
    const { container } = render(<Card {...props}>內容</Card>);
    expect(container.firstElementChild!.getAttribute("class")).toBe(expected);
  });

  it("as=details 可做可收合區", () => {
    const { container } = render(
      <Card as="details" variant="quiet">
        <summary>更多</summary>
      </Card>,
    );
    expect(container.querySelector("details")!.getAttribute("class")).toBe("card card--quiet");
  });
});

describe("Chip — 展示 vs 可互動", () => {
  it("沒有 onClick 就是純展示，不該有 role", () => {
    const { container } = render(<Chip>AI</Chip>);
    const el = container.firstElementChild!;
    expect(el.getAttribute("class")).toBe("chip");
    expect(el).not.toHaveAttribute("role");
    expect(el).not.toHaveAttribute("tabindex");
  });

  it("有 onClick 就補上 pick 與鍵盤無障礙", () => {
    const { container } = render(<Chip onClick={() => {}}>可選</Chip>);
    const el = container.firstElementChild!;
    expect(el.getAttribute("class")).toBe("chip pick");
    expect(el).toHaveAttribute("role", "button");
    expect(el).toHaveAttribute("tabindex", "0");
    expect(el).toHaveAttribute("aria-pressed", "false");
  });

  it("selected 加上 on 並反映在 aria-pressed", () => {
    const { container } = render(
      <Chip selected onClick={() => {}}>
        已選
      </Chip>,
    );
    const el = container.firstElementChild!;
    expect(el.getAttribute("class")).toBe("chip pick on");
    expect(el).toHaveAttribute("aria-pressed", "true");
  });

  it("selected 但無 onClick 時不假裝可互動", () => {
    const { container } = render(<Chip selected>唯讀</Chip>);
    expect(container.firstElementChild!.getAttribute("class")).toBe("chip on");
  });

  it("Enter 與空白鍵都能啟動（修好裸 span 的鍵盤缺陷）", async () => {
    const onClick = vi.fn();
    render(<Chip onClick={onClick}>可選</Chip>);
    const el = screen.getByRole("button", { name: "可選" });
    el.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});

describe("Pill / Badge — 狀態色只能從語意取值", () => {
  it.each([
    ["queued", "pill queued"],
    ["running", "pill running"],
    ["done", "pill done"],
    ["failed", "pill failed"],
    ["neutral", "pill"],
  ] as const)("status=%s → %s", (status, expected) => {
    const { container } = render(<Pill status={status}>x</Pill>);
    expect(container.firstElementChild!.getAttribute("class")).toBe(expected);
  });

  it("Badge 預設與 mock 兩態", () => {
    const { container: a } = render(<Badge>一般</Badge>);
    expect(a.firstElementChild!.getAttribute("class")).toBe("badge");
    const { container: b } = render(<Badge tone="mock">假資料</Badge>);
    expect(b.firstElementChild!.getAttribute("class")).toBe("badge mock");
  });
});

describe("Skeleton", () => {
  it("帶 aria-hidden，不讓讀屏念裝飾方塊", () => {
    const { container } = render(<Skeleton width={80} height={12} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute("class")).toBe("skeleton");
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el.style.width).toBe("80px");
    expect(el.style.height).toBe("12px");
  });
});

describe("Hint — 新手／專家分層", () => {
  it("預設密度是 guide，輸出與遷移前相同的 <p class=\"hint\">", () => {
    const { container } = render(<Hint>說明文字</Hint>);
    const el = container.firstElementChild!;
    expect(el.tagName).toBe("P");
    expect(el.getAttribute("class")).toBe("hint");
    expect(el).toHaveTextContent("說明文字");
  });

  it("引導模式下常駐顯示", () => {
    render(
      <DensityProvider value="guide">
        <Hint>說明文字</Hint>
      </DensityProvider>,
    );
    expect(screen.getByText("說明文字")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("精簡模式收成可展開的問號", async () => {
    render(
      <DensityProvider value="concise">
        <Hint>說明文字</Hint>
      </DensityProvider>,
    );
    expect(screen.queryByText("說明文字")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "顯示說明" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);
    expect(screen.getByText("說明文字")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(toggle);
    expect(screen.queryByText("說明文字")).not.toBeInTheDocument();
  });

  it("layer=always 在精簡模式仍常駐（扣點、錯誤修法這類不能藏）", () => {
    render(
      <DensityProvider value="concise">
        <Hint layer="always">本次將扣 12 點</Hint>
      </DensityProvider>,
    );
    expect(screen.getByText("本次將扣 12 點")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("問號按鈕的觸控目標達 44px（btn-sm 只撐到 38px 寬）", () => {
    render(
      <DensityProvider value="concise">
        <Hint>說明文字</Hint>
      </DensityProvider>,
    );
    expect(screen.getByRole("button", { name: "顯示說明" })).toHaveStyle({ minWidth: "44px" });
  });

  it("展開的說明由問號按鈕以 aria-controls 指向", async () => {
    render(
      <DensityProvider value="concise">
        <Hint>說明文字</Hint>
      </DensityProvider>,
    );
    const toggle = screen.getByRole("button", { name: "顯示說明" });
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-controls")).toBe(screen.getByText("說明文字").id);
  });
});

describe("Skeleton — 播報用骨架不能被 aria-hidden 蓋掉", () => {
  it("預設帶 aria-hidden（純裝飾方塊不該被念出來）", () => {
    const { container } = render(<Skeleton height={48} />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("給了 role 就不強加 aria-hidden —— 兩者矛盾會讓讀屏收不到「正在載入」", () => {
    const { container } = render(<Skeleton height={48} role="status" aria-label="載入中" />);
    const el = container.firstElementChild!;
    expect(el).not.toHaveAttribute("aria-hidden");
    expect(el).toHaveAttribute("role", "status");
    expect(el).toHaveAttribute("aria-label", "載入中");
  });

  it("只給 aria-label 也視為要播報", () => {
    const { container } = render(<Skeleton height={48} aria-label="訊息載入中" />);
    expect(container.firstElementChild).not.toHaveAttribute("aria-hidden");
  });
});

describe("Meta — 內容 vs 說明的分界", () => {
  it("視覺輸出與 hint 完全相同（遷移零變化）", () => {
    const { container } = render(<Meta>步驟 3/7</Meta>);
    const el = container.firstElementChild!;
    expect(el.tagName).toBe("SPAN");
    expect(el.getAttribute("class")).toBe("hint");
  });

  it("精簡模式下**不會**被收起 —— 藏內容會讓人以為資料不見了", () => {
    render(
      <DensityProvider value="concise">
        <Meta>約 12 分</Meta>
        <Hint>這裡解釋怎麼用</Hint>
      </DensityProvider>,
    );
    expect(screen.getByText("約 12 分")).toBeInTheDocument();
    // 對照組：同一個密度下，說明被收成問號
    expect(screen.queryByText("這裡解釋怎麼用")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "顯示說明" })).toBeInTheDocument();
  });

  it("支援清單與段落等內容常見的標籤", () => {
    const { container } = render(
      <Meta as="ul">
        <li>成功條件一</li>
      </Meta>,
    );
    expect(container.querySelector("ul")!.getAttribute("class")).toBe("hint");
  });

  it("呼叫端 className 疊加", () => {
    const { container } = render(<Meta className="mono">US$0.0042</Meta>);
    expect(container.firstElementChild!.getAttribute("class")).toBe("hint mono");
  });
});

describe("EmptyState", () => {
  it("標題與說明都在，精簡模式也不會消失（空狀態的說明是唯一內容）", () => {
    render(
      <DensityProvider value="concise">
        <EmptyState
          title="還沒有專案"
          description="建立第一個專案，開始你的創作。"
          action={<Button variant="primary">建立專案</Button>}
        />
      </DensityProvider>,
    );
    expect(screen.getByRole("heading", { name: "還沒有專案" })).toBeInTheDocument();
    expect(screen.getByText("建立第一個專案，開始你的創作。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "建立專案" })).toBeInTheDocument();
  });

  it("class 契約不變", () => {
    const { container } = render(<EmptyState title="空" description="說明" />);
    expect(container.firstElementChild!.getAttribute("class")).toBe("empty-state");
  });

  it("說明用純 <p> 而非 hint —— 空狀態的唯一內容不該縮成 12px", () => {
    const { container } = render(<EmptyState title="空" description="說明" />);
    const p = container.querySelector("p")!;
    expect(p.tagName).toBe("P");
    expect(p).not.toHaveClass("hint");
    expect(p.getAttribute("class")).toBeNull();
  });
});
