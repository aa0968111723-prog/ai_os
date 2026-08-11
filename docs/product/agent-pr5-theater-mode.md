# PR-5：Theater Mode（reveal / flash / goTo + synthetic cursor）

> 優先級：P2  
> 對應：TRUE_AGENT_ROADMAP C、最高「看得見 AI 在操作」衝擊

## 目標

讓代理執行時，前端做出**頁面操演**：自動導航、高亮目標、（可選）合成 AI 游標，使用者真正感覺「AI 正在操作畫面」；但操演層永遠不能搶走真人控制權、不能偽造成功、不能繞過確認與 ACL。

## 終端機指令

```bash
git fetch origin
git checkout -b feat/agent-theater-mode origin/main
```

## 範圍

**要做：**
- 每步 observable progress / completion 可帶安全的 navigation hint：`path` / `anchor` / `reveal`。
- 前端：`goTo(path, { reveal })` → ensureAnchorExpanded → flashAnchor。
- 全域 HUD 常駐「停止」，並能取消 pending navigation / reveal / synthetic cursor animation。
- （可選）合成 AI 游標，與真人協作游標視覺明確區分，且清楚標示「AI 操作提示」。
- 寫入類步驟：Theater 只展示／帶入，不自行模擬 submit；實際 side effect 仍走既有 approval / CreationAction / runner contract。
- 建立真人互動保護：使用者正在輸入、拖曳、選取、開 modal 時，自動操演暫停或降級為「提示前往」。

**不做：**
- 模擬 DOM click / pointer event 去觸發真實寫入（脆弱、可繞過產品守門）
- 用 synthetic cursor 假裝真人在線
- 原生殼特化（web 做好三端共享）
- Theater 自己建立第二套 agent execution state

## Navigation hint contract

Navigation hint 必須是 presentation hint，不是 execution command：

```ts
interface AgentNavigationHint {
  schemaVersion: 1;
  runId: string;
  stepId: string;
  projectId: string;
  path?: string;
  anchor?: string;
  reveal?: boolean;
  mode?: "suggest" | "auto_if_idle";
}
```

規則：
- path 必須走既有 safePath / app route whitelist，不接受任意外部 URL。
- anchor 必須是產品註冊的 semantic anchor，不接受任意 CSS selector / 任意 DOM query。
- hint 缺失或失效時不影響真正 agent execution；只顯示「找不到對應畫面」的安全 fallback。
- event out-of-order 時不得跳回上一個 step；沿用 PR-2 ordering / authoritative state。

## Human Override / Focus Safety

Theater 必須偵測「真人正在操作」：
- input / textarea / contenteditable 有 focus 且已輸入
- pointer drag / resize / drawing session active
- modal / confirm / picker 已開啟
- 使用者最近主動導航或手動捲動

此時：
1. 不自動 `goTo`。
2. 不呼叫 `focus()` 搶焦點。
3. 不強制 scrollIntoView 把真人目前位置拉走。
4. HUD 改顯示「AI 已做到 X・前往查看」按鈕，由真人決定是否跳轉。

建議設短暫 idle window（例如 2–5 秒，實際值以 UX 測試決定）；不要靠高頻 timer 造成效能負擔。

## Stop semantics

使用者按「停」後：
- 立即取消尚未執行的 auto navigation timeout / animation。
- synthetic cursor 停止並淡出。
- 不再消費該 run 後續 Theater hint。
- authoritative runner stop 仍走既有 server API；UI 顯示 `停止中…` 直到 server terminal status。
- 即使 stop API 暫時失敗，前端也不得繼續自動帶著使用者跳頁；操演層先停止，execution failure 另行提示。

## Accessibility / Motion

- `prefers-reduced-motion: reduce`：flash 改成靜態 outline / badge，不做長距離平移或 synthetic cursor animation。
- 不只靠 flash 顏色表示目前 step；要有文字 / aria-live 摘要。
- 自動導航不應把 screen reader focus 瞬間搬走；以 status announcement + 明確 CTA 為優先。
- keyboard 使用者可停、可前往、可返回原位置。
- 手機 390px 不因 HUD / tooltip 擋住主要 CTA 或底部導覽。

## Synthetic cursor 規則（可選）

若啟用：
- 外觀必須與真人 presence cursor 明確不同。
- label 必須是 AI / agent，不用真人姓名、頭像、presence 色。
- 只能指示 anchor / region，不產生 click / keypress。
- reduced-motion / low-performance device 可完全關閉。
- 多 run 同時存在時不要同時畫多個游標；只顯示 lead run 或使用者指定 run。

## 建議修改檔案

- realtime / agent observable event contract：只新增 navigation hint 欄位，不另造通道
- `agentRunner` / event producer：只廣播 safe path / semantic anchor hint
- 導航工具（goTo、跨頁 reveal 匯流排、safe path）
- `AgentActivityHud` + 全域急停
- 既有 `flashAnchor` / mirror 引擎複用
- human interaction / idle detector（若已有協作 focus 狀態則優先複用）
- client tests：focus safety / stop / reduced motion / stale hint

## 紅線

- 操演是 presentation；真正 side effect 仍走 server authoritative execution / confirmation。
- 隨時可停，stop 優先於動畫完整播放。
- 不假裝「有真人在線上」。
- 不搶 focus、不覆蓋使用者輸入、不模擬 DOM click。
- stale / invalid hint fail-safe，不亂跳頁。
- path / anchor 必須 whitelist / semantic registry。

## Rollout / rollback

- Theater 預設 feature flag off，先 internal / small cohort。
- navigation hint 為 additive event data；舊 client 可忽略。
- 關 flag 後 agent execution 完全不受影響，只是不做頁面操演。
- synthetic cursor 可獨立 flag，便於只推出 reveal/flash 而不推出游標。
- 量測 auto navigation cancel rate；若真人頻繁取消，代表功能干擾性過高，應降級為 suggest mode。

## Telemetry

至少量：
- hint emitted / delivered / stale dropped
- auto navigation executed / suppressed_by_human_activity
- user clicked「前往查看」
- stop during theater
- invalid path / missing anchor
- reveal success latency
- theater disabled by reduced-motion / capability

不得把使用者輸入內容本身寫進 theater telemetry。

## 驗收標準

- [ ] step hint 能導向正確頁面並高亮 semantic anchor。
- [ ] stale hint 不會把畫面跳回舊 step。
- [ ] 使用者正在輸入 / drag / modal 時不搶頁面；改顯示「前往查看」。
- [ ] stop 後所有 pending navigation / reveal / cursor animation 立即取消。
- [ ] 寫入步驟不透過 DOM click / synthetic cursor 直接送出。
- [ ] invalid path / missing anchor 有安全 fallback，不影響 execution。
- [ ] reduced-motion 友善。
- [ ] keyboard / screen reader 可知道 AI 做到哪並操作 Stop / Go To。
- [ ] 手機 390px 可用。
- [ ] feature flag 關閉時 agent 執行行為完全不變。
- [ ] typecheck / test / client coverage / build 通過。

## 建議 PR 標題

```text
feat(agent): theater mode with safe reveal, human override, and emergency stop
```

## 可選高衝擊延伸

白板繪圖 DSL + 逐筆重播（TRUE_AGENT_ROADMAP B）可作為獨立 demo PR，視覺衝擊最大，建議與本 PR 分開；同樣必須遵守 human override、reduced-motion、stop semantics 與 observable-only 原則。
