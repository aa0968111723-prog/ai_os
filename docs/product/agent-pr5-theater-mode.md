# PR-5：Theater Mode（reveal / flash / goTo + synthetic cursor）

> 優先級：P2  
> 對應：TRUE_AGENT_ROADMAP C、最高「看得見 AI 在操作」衝擊

## 目標

讓代理執行時，前端做出**頁面操演**：自動導航、高亮目標、（可選）合成 AI 游標，使用者真正感覺「AI 正在操作畫面」。

## 終端機指令

```bash
git checkout -b feat/agent-theater-mode origin/claude/healing-migration-ai-os-erewp2
```

## 範圍

**要做：**
- 每步完成 → realtime 訊息帶 anchor / path
- 前端：`goTo(path, {reveal})` → ensureAnchorExpanded → flashAnchor
- 全域 HUD 常駐「停止」
- （可選）合成 AI 游標，與真人協作游標視覺區分
- 寫入類步驟：只填表不送出（沿用 CreationAction 契約）

**不做：**
- 模擬 DOM 點擊（脆弱、繞過 ACL）
- 原生殼特化（web 做好三端共享）

## 建議修改檔案

- realtime 協定擴充
- `agentRunner` 廣播附帶導航／錨點資訊
- 導航工具（goTo、跨頁 reveal 匯流排）
- `AgentActivityHud` + 全域急停
- 既有 `flashAnchor` / mirror 引擎複用

## 紅線

- 操演是唯讀演出；寫入仍走確認流
- 隨時可停
- 不假裝「有真人在線上」

## 驗收標準

- [ ] 步驟完成後能導向正確頁面並高亮
- [ ] 跨頁 HUD 可見且可停
- [ ] reduced-motion 友善
- [ ] 手機可用
- [ ] typecheck / test / build 通過

## 建議 PR 標題

```
feat(agent): theater mode with reveal/flash/goTo and emergency HUD stop
```

## 可選高衝擊延伸

白板繪圖 DSL + 逐筆重播（TRUE_AGENT_ROADMAP B）可作為獨立 demo PR，視覺衝擊最大，建議與本 PR 分開。
