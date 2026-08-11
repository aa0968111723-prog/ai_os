export type AssistantComputerIntent = "capability" | "operate" | null;

export interface AssistantComputerRuntimeStatus {
  enabled?: boolean;
  browserEnabled?: boolean;
  browserProvider?: string;
  liveExternalWebEnabled?: boolean;
}

export function classifyAssistantComputerIntent(text: string): AssistantComputerIntent {
  const normalized = text.trim();
  if (!/(?:瀏覽器|browser)/i.test(normalized)) return null;
  const capabilityQuestion =
    /(?:可以|能不能|可不可以|能否|會不會|支援|能用|可以用|有沒有).{0,20}(?:瀏覽器|browser)|(?:瀏覽器|browser).{0,20}(?:可以|能|支援|會)/i.test(normalized);
  if (capabilityQuestion) return "capability";
  const operate =
    /(?:幫我|替我|直接|請|開啟|打開|啟動|操作|前往).{0,24}(?:瀏覽器|browser)|(?:瀏覽器|browser).{0,24}(?:前往|打開|開啟|啟動|操作|查|看)/i.test(normalized);
  return operate ? "operate" : null;
}

export function isRealBrowserReady(status: AssistantComputerRuntimeStatus | null | undefined): boolean {
  return !!status?.enabled
    && !!status.browserEnabled
    && status.liveExternalWebEnabled === true
    && status.browserProvider !== "mock";
}

export function formatComputerCapabilityAnswer(status: AssistantComputerRuntimeStatus | null | undefined): string {
  if (!status) return "我目前無法讀到 Browser Runtime 狀態，所以不會猜測自己能不能操作瀏覽器。";
  if (!status.enabled || !status.browserEnabled) {
    return "目前這個部署的 AI 工作電腦 / Browser Runtime 尚未啟用，所以我現在不能直接操作瀏覽器，也不會假裝已經操作。";
  }
  if (!isRealBrowserReady(status)) {
    return "我有隔離 Browser Runtime 的操作框架，但目前這個部署仍是 mock 測試 provider，尚不能把它當成真實外網瀏覽器。要真正瀏覽網站，需要接上 Browserbase、E2B 或可用的 Playwright provider。";
  }
  return "可以。真實的隔離 Browser Runtime 已啟用；你指定專案與網址後，我可以建立工作階段並回報實際執行結果。";
}
