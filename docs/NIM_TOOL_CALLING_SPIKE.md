# Spike：NIM 原生 tool calling（GLOBAL_ASSISTANT_PLAN §6-3 的解封條件）

> 2026-08-08。結論先講：**協定支援存在、逐模型而異、上線前需以真金鑰做三項實測**。
> 遷移面已收斂到單點——assistantCore 的呼叫端只需換注入的 llm/prompt 策略，三個助手迴圈零改動。

## 查證結果（官方文件）

- NIM 的 LLM 端點（`integrate.api.nvidia.com/v1/chat/completions`，即站內 `nvidia-nim.ts` 用的那個）
  **支援 OpenAI 相容 tool calling**：`tools`／`tool_choice`／`parallel_tool_calls` 參數，由 vLLM 的
  tool-calling 引擎實作；`tool_choice` 只能與 `tools` 同時給。
- **僅部分模型支援** function calling，支援 parallel tool calls 的又是其中子集——「哪個模型」是
  第一個要實測的問題（文件未對每個託管模型逐一列表；社群亦有「託管端 tool calling 不穩」的回報，
  例如 zed-industries/zed#55884）。
- 來源：
  - [Tool Calling and MCP Integration — NIM for LLMs](https://docs.nvidia.com/nim/large-language-models/latest/advanced-use-cases/tool-calling-and-mcp.html)
  - [Function (Tool) Calling with NVIDIA NIM for LLMs](https://docs.nvidia.com/nim/large-language-models/1.13.0/function-calling.html)
  - [zed-industries/zed#55884（託管端實測問題回報）](https://github.com/zed-industries/zed/issues/55884)

## 上線前必做的三項實測（需 NVIDIA_NIM_API_KEY，本機無金鑰無法代驗）

1. **模型支援矩陣**：對現行 `NVIDIA_NIM_MODEL`（預設 llama3 70B 系）發帶 `tools` 的請求——
   回 `tool_calls` 還是 400／忽略參數？若不支援，候選換援模型要同時過「繁中品質」與「免費額度」兩關。
2. **schema 忠實度**：把 `teamToolSchema`／`toolCallSchema` 轉成 OpenAI function declarations 後，
   模型是否穩定回合法參數（特別是中文 enum 值與選填欄位）？連續 20 次呼叫的合法率要 ≥ 現行
   提示詞式 JSON 的實測水準，否則換了反而多燒 fallback。
3. **混合輸出行為**：最終回答（answer＋提議陣列）仍是我們的 JSON 契約——模型在「不呼叫工具」
   的輪次會不會被 `tools` 參數帶偏（例如硬選一個工具）？`tool_choice:"auto"` 與 `"none"` 收尾輪的
   行為要分別驗。

## 落地方案（已預留的接縫，屆時的 diff 面）

現行三個迴圈（assistant.ts／teamAssistant／globalAssistant）都已遷入 `assistantCore.runToolLoop`，
供應商細節在呼叫端注入的 `llm` 閉包與 `buildPrompt`。原生 tool calling 的切換＝新增一個 strategy：

1. `nvidia-nim.ts` 的 `chatCompletion` 加選填 `tools`／`toolChoice` 參數，回傳值帶出 `tool_calls`。
2. assistantCore 增加一個**可選**的 `nativeToolStrategy`：有給時，`llm` 回傳結構化
   `{ text?, toolCall? }`，迴圈跳過 `extractJsonObject`／`tryToolCall` 直接吃 `toolCall`；
   沒給時走現行提示詞式路徑——**兩條路共存**，per-model 開關（環境變數白名單），
   不支援的模型自動退回提示詞式。
3. 工具說明從 `buildPrompt` 的文字區塊改為 declarations 產生器（單一來源：現有 zod schema →
   `zod-to-json-schema` 已在依賴樹內，零新增依賴）。
4. 收尾輪（forceFinal）送 `tool_choice:"none"`，取代「這一輪不得再呼叫工具」的提示詞句。

**明確不做**（沿計畫 §6-3）：在三項實測給出綠燈前，不把任何迴圈預設切到原生路徑；
提示詞式 JSON 是已在生產驗證的路徑，原生化的動機是「工具面從 ≤10 支常駐擴到按需檢索全 72 支」，
不是為換而換。
