/**
 * 模型事實區的密度分層：匯率換算式在精簡模式預設收起、引導模式預設展開，
 * 且無論收合與否，金額（幾點）都看得到。
 *
 * 這一段之所以要測：它是「AI 創作中心」在手機上最大的密度來源，
 * 但同時是點數透明度的依據——只要有人把它改成永遠常駐或永遠隱藏，都會退回原本的問題。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelPicker } from "./ModelPicker";
import { DensityProvider } from "./ui";

const CATEGORY = { id: "text-to-image", label: "文生圖", hint: "從文字直接生圖" };
const MODEL = {
  id: "fal-ai/wan-2.2",
  label: "Wan 2.2(開源)",
  points: 1,
  needs: null,
  sourceHint: null,
  kind: "image",
  tier: "economy",
  tierLabel: "經濟",
  strengths: "開源 14B;性價比首選、已在站內驗證",
  bestFor: "日常分鏡影片、預算有限時的主力",
  cost: "$0.03/image（Fal 即時價）",
  estTwd: 1,
  usdToTwdRate: 32.308,
  verified: true,
  recommended: true,
  category: "text-to-image",
};

vi.mock("../api", () => ({
  trpc: {
    models: {
      categories: { useQuery: () => ({ data: [CATEGORY], isLoading: false, error: null, refetch: vi.fn() }) },
      byCategory: { useQuery: () => ({ data: [MODEL], isLoading: false, error: null, refetch: vi.fn() }) },
      get: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

function renderAt(density: "guide" | "concise") {
  return render(
    <DensityProvider value={density}>
      <ModelPicker onChange={() => {}} />
    </DensityProvider>,
  );
}

/** jsdom 裡 <details> 收合仍留在 DOM，所以「看不看得到」只能靠 open 屬性判定。 */
function costDetails(): HTMLDetailsElement {
  const summary = screen.getByText(/點數怎麼算/).closest("summary");
  const details = summary?.parentElement as HTMLDetailsElement | null;
  if (!details) throw new Error("找不到「點數怎麼算」的收合區");
  return details;
}

describe("ModelPicker 模型事實區", () => {
  it("精簡模式收起匯率換算式，但金額仍留在收合列上", () => {
    renderAt("concise");
    expect(costDetails().open).toBe(false);
    expect(screen.getByText("約 1 點")).toBeInTheDocument();
  });

  it("引導模式預設展開換算式", () => {
    renderAt("guide");
    expect(costDetails().open).toBe(true);
    expect(screen.getByText(/US\$1＝NT\$32.308/)).toBeInTheDocument();
  });

  it("精簡模式下仍可自行展開換算式", async () => {
    renderAt("concise");
    await userEvent.click(screen.getByText(/點數怎麼算/));
    expect(costDetails().open).toBe(true);
  });

  it("能力／適用情境不因密度收起——那是選型依據，不是介面說明", () => {
    renderAt("concise");
    expect(screen.getByText(/開源 14B/)).toBeInTheDocument();
    expect(screen.getByText(/日常分鏡影片/)).toBeInTheDocument();
  });
});
