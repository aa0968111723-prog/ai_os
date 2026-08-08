# 動畫創作室 → Aios Storyboard Studio 重構紀錄（2026-08）

> 目標：把「AI 白板＋繪圖工具＋教學頁」升級成專業分鏡工作台。
> 第一眼要能認出「這是影片分鏡工作台」，而不是「線上畫板」。

## 一句話

桌機改成 **四區工作台**（左 Tools｜中 Stage｜右 Shot Inspector｜底 Storyboard Timeline ＋ 沉浸 Top Bar），
手機輕量版**完整保留**；畫布引擎與資料格式**一行未動**。

## 版面

```
┌──────────────────────────────────────────────────┐
│ ← 返回專案 / 專案 / 場 / Shot 03   ↶↷ 已存 ⛶ 預覽 ⋯│ 48px
├────┬────────┬──────────────────────┬─────────────┤
│Tool│ 工具    │                      │ Shot        │
│Rail│ 設定    │    Stage（畫布）      │ Inspector   │
│52px│ 216px  │  檯面深／紙白／輔助線  │ 320px       │
│    │(選到才 │  縮放貼右下・HUD 貼底  │ 六分頁      │
│    │ 展開)  │                      │             │
├────┴────────┴──────────────────────┴─────────────┤
│ Storyboard Timeline：縮圖卡・拖曳排序・New Shot   │ 148px
└──────────────────────────────────────────────────┘
```

版面**不用 media query 決定**（沿用既有契約）：`studioLayout.resolveStudioLayout()` 算出 `data-mode`，
CSS 只吃屬性。桌機 `.studio.is-workspace`，手機維持既有 `[data-mode="lite"]` 的單欄。

## 各區設計決定

| 區 | 做了什麼 | 為什麼 |
|---|---|---|
| **Top Bar** | 麵包屑（返回專案／專案／場／Shot）＋Undo/Redo＋已存狀態＋協作者＋預覽＋⋯ | 創作時畫面上該有的是這支片，不是「換一件事做」的入口 |
| | 進站即掛 `body.studio-workspace`，全站導航（topbar/mobile-nav/DM 球/回饋浮標）讓開 | 與既有 `body.studio-immersive` 平行：**沉浸是版面，全螢幕是視窗** |
| | 手機**不掛** | 底部分頁列是手機唯一的返回路徑 |
| **ToolRail** | 選取／畫筆／橡皮擦／底稿／AI 五個工具，52px 窄軌 | 舊版把六種筆刷永久攤在 200px 左欄，「換筆」佔掉了「換工作方式」的位置 |
| | 二級設定只在選到有選項的工具才展開（Contextual Tool Options） | 選取工具時左欄收成一條軌，畫布拿回 216px |
| | 文字／圖形／標註 **列出但停用**，tooltip 明說「還沒做」 | 白板只存筆畫（`boardDoc.Stroke`），放上去點不動比沒有更糟 |
| **Stage** | 檯面壓深（`--ws-desk`）／白紙加重影子／白板去圓角外框 | 「哪裡是工作區、哪裡是影片畫面」要一眼分得出來——舊版整片白，畫到框外會被裁沒人知道 |
| | 安全區（90%/93% 產業慣例）／三分法／中心線／格線可個別開關 | 分鏡是給拍片用的，「字幕會不會被切掉」是判準不是裝飾 |
| | 輔助線與紙面共用 `paperStyle` | 縮放平移自動跟上，不在外層重算同樣的數學（重算＝遲早對不齊） |
| | 縮放貼右下、HUD 貼底（Shot／秒數／比例／景別／焦段／筆數） | 控制項貼邊，畫布是主角 |
| **Inspector** | 六分頁：畫面／角色／攝影／聲音／AI／備註 | 這些欄位屬於不同工序——寫旁白時不需要看焦段 |
| | 全部接**既有欄位**（`camera`/`performance`/`lookIds`/`storySceneId` 是 Story-first 既有欄位） | 零 schema 變更 |
| | 存檔一律帶 `expectedRev`＋`baseline`，撞版本顯示衝突卡 | 夥伴同時編輯不會靜默吃字 |
| | AI 分頁＝動作卡＋上下文列（「AI 看得到：Shot…白板 N 筆…前後鏡…」） | AI 是懂這一鏡的協作者，不是要你重新解釋背景的聊天框 |
| **Timeline** | 縮圖／編號／秒數／景別／未存草稿點＋明確選取態 | 這是時間軸不是清單：掃過去就知道片長分布 |
| | 拖曳排序 **＋每格永遠有前／後按鈕** | 沿用 ShotStrip 的既有決定：拖曳對鍵盤與讀屏不成立，那是加速捷徑不是唯一的路 |
| | New Shot 四選項（空白／延續上一鏡／AI 推薦／AI 依腳本） | 每一項都對到既有後端動作（`addDraft`／`insertAfter`／`director.*`），不新開 API |

## 順手修掉的既有 bug

`styles.css:152-166` 給全站 `button` 設了 `min-width/min-height: 44px`，而 **`min-width` 的優先權高過 `width`**
——`studio.css:68` 那句 `width: 34px` 從來沒生效過，桌機工具鈕一直是 44×44。
新工作台的 40px 工具軌與 Timeline 小操作鈕都會被撐爆。

解法沿用 studio.css 既有手法而不是拿掉下限：**視覺尺寸縮小，命中圈用透明 `::after` 外擴回 44px**。
WCAG 2.5.8 看的是可點區域，不是邊框大小。實測工具軌 52px、按鈕 40×40 ✓

同場加映：`button { border-radius: 999px }` 會把 Inspector 的底線分頁切成六顆膠囊，明寫 `border-radius: 0` 壓過。

## 一行未動的東西

畫布引擎（`WhiteboardCanvas` 的指標事件／三層光柵化／座標數學）、`boardDoc` 資料格式、
`useBoardSession`（切鏡存檔）、`studioStorage`（本機草稿）、`brushes`／`brushCollection`、
`sketchReplay`（AI 逐筆重播）、`studioLayout`、`useImmersive`、`BrushShelf`／`ShotStrip`／`StudioAiPanel`。

`WhiteboardCanvas` 只加了一個 **optional** prop `guides`（省略＝全關，既有呼叫端行為不變）。
`scenes.listByProject` 只**補回** `rev` 欄位（Inspector 要它才能帶 `expectedRev`）。

## 驗證

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 通過 |
| `check:ui-primitives` / `check:boundaries` / `check:hooks` | 全通過（裸 class 0） |
| animation-studio 測試 | **18 檔 252 個全通過**（既有 229 ＋ 新增 23） |
| `npm run build` | 通過 |
| `npm run test:client` | 1552 passed / 8 failed —— 8 個失敗在 base 上就是紅的（PlannerPage、StoryboardScript），失敗集未增加 |
| 瀏覽器實測（1280px，E2E_MOCK） | 見下 |

瀏覽器實測（真的起服點過一輪）：
- 四區到位、全站導航確實隱藏（topbar/mobile-nav/DM/回饋浮標 `display:none`）
- 工具軌 52px、工具鈕 40×40（min-width 修正生效）
- 點 Timeline 第 1 鏡 → 麵包屑／HUD／Inspector 同步切換（Shot 01・4s・9:16・中景・35mm）
- 攝影分頁正確顯示既有 `camera` 資料；角色分頁列出角色與造型且勾選態正確
- **畫 2 筆 → Undo 2→1 → Redo 1→2 → Ctrl+Z 2→1**，自動儲存顯示「手稿已存本機 ✓」
- 縮放 31%→37%→31%→Fit→100%，四顆控制項都對
- Inspector 收合：320px→40px，畫布 691→971px（真的拿回空間）
- New Shot 四選項、Shot 更多選單（複製／刪除）都開得出來
- console 零錯誤

## 還沒做（下一步建議，依價值排序）

1. **Timeline 高度可拖曳調整**（`clampTimelineHeight` 純函式與 token 已備好，只差拖曳把手與持久化）。
2. **面板偏好持久化**（Inspector 收合狀態、輔助線組合目前重整就回預設；`studioStorage` 已有現成的 per-project 存取模式可沿用）。
3. **文字／圖形／標註工具**：要先擴充 `boardDoc.Stroke` 成 discriminated union（`{kind:'stroke'|'text'|'shape'}`），
   並讓 `boardRender`／`sketchReplay`／`boardExport` 一起認得。這是資料格式變更，需要 `parseBoard` 的向後相容分支。
4. **協作者頭像接 realtime**：Top Bar 的 `peerCount` 目前留了介面但沒接（專案頁的 `useCollab` 可以共用）。
5. **AI 動作再往前一步**：「分析目前草圖」「完善構圖」需要把白板 PNG 餵給視覺模型，
   `boardSummary` 目前只給數字摘要（幾筆、分布），要做得先決定用哪個 vision model 與計價。
