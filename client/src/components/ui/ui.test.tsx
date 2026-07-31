import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Badge, Button, Card, Chip, DensityProvider, EmptyState, Hint, Meta, Pill, Skeleton, cx } from ".";
import { useRovingRadio } from "../interactions";

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

  it("接得住 ref —— 站內有數處按鈕要靠 ref 做焦點管理", () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<Button ref={ref}>送出</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current).toHaveTextContent("送出");
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

  it("as=details 收得下 open／onToggle（<details> 專屬屬性）", () => {
    const { container } = render(
      <Card as="details" variant="quiet" open>
        <summary>更多</summary>
      </Card>,
    );
    expect(container.querySelector("details")).toHaveAttribute("open");
  });

  it("as=aside 可用（側欄卡片）", () => {
    const { container } = render(<Card as="aside">側欄</Card>);
    expect(container.querySelector("aside")!.getAttribute("class")).toBe("card");
  });

  it("接得住 ref —— 站內數處把卡片當對話框並用 ref 管焦點", () => {
    const ref = { current: null as HTMLDivElement | null };
    render(
      <Card ref={ref} role="dialog" aria-label="改密碼">
        內容
      </Card>,
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current).toHaveAttribute("role", "dialog");
  });

  it("呼叫端額外的 class 保留在變體之後", () => {
    const { container } = render(
      <Card as="section" variant="primary" className="team-ai-card">
        內容
      </Card>,
    );
    expect(container.querySelector("section")!.getAttribute("class")).toBe("card card--primary team-ai-card");
  });
});

describe("Chip — 展示 vs 可互動", () => {
  it("as='li' 必須是型別錯誤——防線在聯集，不在執行期", () => {
    // Chip 刻意不支援 as="li"：可互動時它會輸出 role="button"，直接掛在 <li>
    // 上會覆蓋 listitem，外層 <ul> 就不再被讀屏當成清單（也不會念出項目數）。
    // 這條防線只存在於 as 的型別聯集（"span" | "div"）。執行期測試守不住它——
    // 元件不可能改到父層 DOM，渲染 <li><Chip/></li> 再斷言 li 沒有 role 是
    // 套套邏輯，永遠綠。真正釘住聯集的是下面那行 ts-expect-error：若有人把
    // "li" 加回聯集，指令會因為「錯誤消失了」而讓 typecheck 轉紅。
    // （這段註解刻意不用 @ 開頭寫出完整指令名——註解開頭的指令字面量
    //   本身就會被 TS 當成第二個指令，然後以「未使用」報錯。）
    const forbidden = (
      // @ts-expect-error -- as="li" 會蓋掉 listitem 語意，聯集刻意不含它
      <Chip as="li" onClick={() => {}}>
        剪輯
      </Chip>
    );
    expect(forbidden).toBeTruthy(); // JSX 物件本身建得出來；擋的是型別層
  });

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
  });

  it("一次性動作（沒給 selected）不輸出 aria-pressed —— 否則讀屏會念成「未按下的切換鈕」", () => {
    const { container } = render(<Chip onClick={() => {}}>複製模型 ID</Chip>);
    expect(container.firstElementChild).not.toHaveAttribute("aria-pressed");
  });

  it("selected 明確給 false 時仍輸出 aria-pressed —— 那是真的切換鈕，只是未按下", () => {
    const { container } = render(
      <Chip selected={false} onClick={() => {}}>
        篩選：全部
      </Chip>,
    );
    expect(container.firstElementChild).toHaveAttribute("aria-pressed", "false");
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

  it.each(["radio", "checkbox", "switch"])(
    "呼叫端指定 role=%s 時不輸出 aria-pressed —— 該屬性只在 role=button 合法，並存等於兩組打架的狀態",
    (role) => {
      const { container } = render(
        <Chip selected onClick={() => {}} role={role} aria-checked>
          篩選
        </Chip>,
      );
      const el = container.firstElementChild!;
      expect(el).toHaveAttribute("role", role);
      expect(el).toHaveAttribute("aria-checked", "true");
      expect(el).not.toHaveAttribute("aria-pressed");
      // 視覺選取態仍在（.on 不受 role 影響）
      expect(el.getAttribute("class")).toBe("chip pick on");
    },
  );

  it("呼叫端明確指定 role=button 時照常輸出 aria-pressed", () => {
    const { container } = render(
      <Chip selected={false} onClick={() => {}} role="button">
        切換
      </Chip>,
    );
    expect(container.firstElementChild).toHaveAttribute("aria-pressed", "false");
  });

  // 站內三處（AssetLibrary／FeedbackWidget／FeedbackPage）把 Chip 當 radiogroup 的選項，
  // 方向鍵漫遊靠 useRovingRadio 的 ref 取得 DOM 節點——而 ref 是透過 Chip 的 `{...rest}`
  // 才落到元素上。若哪天 Chip 改成不再轉發未知 props，focus() 會變成 no-op，
  // 鍵盤使用者會完全動不了那組選項，但畫面看起來一切正常。
  it("轉發 ref 與自訂 role，方向鍵漫遊才真的能動", async () => {
    function Row() {
      const [value, setValue] = useState<number | undefined>(undefined);
      const roving = useRovingRadio(["1", "2", "3"], value ? String(value) : "", (v) => setValue(Number(v)));
      return (
        <div role="radiogroup" aria-label="評分" {...roving.groupProps}>
          {[1, 2, 3].map((n, i) => (
            <Chip
              key={n}
              selected={value === n}
              onClick={() => setValue(n)}
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} 分`}
              {...roving.itemProps(i)}
            >
              {n}
            </Chip>
          ))}
        </div>
      );
    }
    const user = userEvent.setup();
    render(<Row />);
    const first = screen.getByRole("radio", { name: "1 分" });
    expect(first).not.toHaveAttribute("aria-pressed");
    first.focus();
    await user.keyboard("{ArrowRight}");
    const second = screen.getByRole("radio", { name: "2 分" });
    expect(document.activeElement).toBe(second);
    expect(second).toHaveAttribute("aria-checked", "true");
    expect(second).not.toHaveAttribute("aria-pressed");
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
    const toggle = screen.getByRole("button", { name: /^顯示說明：說明文字/ });
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
    expect(screen.getByRole("button", { name: /^顯示說明/ })).toHaveStyle({ minWidth: "44px" });
  });

  it("展開的說明由問號按鈕以 aria-controls 指向", async () => {
    render(
      <DensityProvider value="concise">
        <Hint>說明文字</Hint>
      </DensityProvider>,
    );
    const toggle = screen.getByRole("button", { name: /^顯示說明：說明文字/ });
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-controls")).toBe(screen.getByText("說明文字").id);
  });

  it("同頁多顆收合按鈕的名稱互異（讀屏 rotor 才分得出誰是誰）", () => {
    // AdminPage 一頁就有 9 顆收合 Hint。若全叫「顯示說明」，元件清單聽到的是
    // 一整排同名按鈕，語音控制「點 顯示說明」也無從指定——名稱必須帶內容片段。
    render(
      <DensityProvider value="concise">
        <Hint>選好風格後會自動帶入語氣</Hint>
        <Hint>分鏡助理會先讀知識庫</Hint>
      </DensityProvider>,
    );
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    expect(names[0]).toContain("選好風格");
    expect(names[1]).toContain("分鏡助理");
  });

  it("巢狀元素裡的文字也取得到；取不出文字才退回通稱", () => {
    render(
      <DensityProvider value="concise">
        <Hint>
          <strong>重點</strong>之後是內文
        </Hint>
        <Hint>
          <svg aria-hidden="true" />
        </Hint>
      </DensityProvider>,
    );
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(names[0]).toContain("重點之後是內文");
    expect(names[1]).toBe("顯示說明");
  });

  it("toggleLabel 仍可覆蓋自動推導", () => {
    render(
      <DensityProvider value="concise">
        <Hint toggleLabel="顯示排程說明">用上面的欄位加第一筆</Hint>
      </DensityProvider>,
    );
    expect(screen.getByRole("button", { name: "顯示排程說明" })).toBeInTheDocument();
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

  it("aria-labelledby 也算播報", () => {
    const { container } = render(<Skeleton height={48} aria-labelledby="loading-title" />);
    expect(container.firstElementChild).not.toHaveAttribute("aria-hidden");
  });

  it("aria-label={undefined} 仍要 aria-hidden —— 判斷看值不看鍵", () => {
    // 條件渲染很容易寫成 aria-label={loading ? "載入中" : undefined}。
    // 若用 `"aria-label" in rest` 判斷，這裡的鍵存在但值是空的，會落到
    // 「aria-hidden 被拿掉、又沒有可讀名稱」的最壞情況：讀屏念出一個無名節點。
    const { container } = render(<Skeleton height={48} aria-label={undefined} />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
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
    expect(screen.getByRole("button", { name: /^顯示說明：這裡解釋怎麼用/ })).toBeInTheDocument();
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
