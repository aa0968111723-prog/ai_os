import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AdobeConnectionView } from "@shared/adobe";
import { AdobeConnectionStatus } from "./AdobeConnectionStatus";

/** #224 PR2：狀態卡的四種局面（未設定／未連結／已連結／授權失效）各自要說對話。 */
const base: AdobeConnectionView = {
  mode: "mock",
  configured: true,
  connected: false,
  email: null,
  status: null,
  lastError: null,
  scopes: ["openid", "AdobeID"],
  capabilities: { photoEdit: true, timelineRender: true, assetBrowse: true },
  connectedAt: null,
  lastUsedAt: null,
};

describe("AdobeConnectionStatus", () => {
  it("站方未設定正式憑證時，引導到模擬模式而不是死路", () => {
    render(<AdobeConnectionStatus data={{ ...base, configured: false }} />);
    expect(screen.getByText(/ADOBE_CLIENT_ID/)).toBeInTheDocument();
  });

  it("未連結時明說尚未連結，並標示目前是模擬模式", () => {
    render(<AdobeConnectionStatus data={base} />);
    expect(screen.getByText("尚未連結 Adobe 帳號")).toBeInTheDocument();
    expect(screen.getByText("模擬模式")).toBeInTheDocument();
  });

  it("已連結時顯示連的是哪個帳號與授權範圍", () => {
    render(<AdobeConnectionStatus data={{ ...base, connected: true, email: "me@adobe.example", status: "active" }} />);
    expect(screen.getByText(/me@adobe.example/)).toBeInTheDocument();
    expect(screen.getByText(/授權範圍：openid、AdobeID/)).toBeInTheDocument();
  });

  it("授權失效時直說要重新連結（不是靜靜顯示已連結）", () => {
    render(<AdobeConnectionStatus data={{ ...base, connected: true, status: "error", lastError: "token 過期" }} />);
    expect(screen.getByText(/請重新連結/)).toBeInTheDocument();
  });

  it("目前模式做不到的能力誠實標示，不讓 UI 給出做不到的承諾", () => {
    render(<AdobeConnectionStatus data={{
      ...base,
      mode: "real",
      connected: true,
      status: "active",
      capabilities: { photoEdit: true, timelineRender: false, assetBrowse: false },
    }} />);
    expect(screen.getByText("✓ 修圖")).toBeInTheDocument();
    expect(screen.getByText("— 時間軸算圖")).toBeInTheDocument();
    expect(screen.getByText("正式模式")).toBeInTheDocument();
  });
});
