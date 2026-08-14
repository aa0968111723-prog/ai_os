# Visual Starter Pack — Asset Bible / Production Spec

給 Codex／Grok／Gemini／Adobe／人工設計**直接批量生產**用的規格書。

Base：`70fcbda7`。本文件只定義素材規格與製作條件，**不改任何程式碼**。
現有 49 個 preset 的 id 全部沿用，不重新命名——換圖不需要動 React，也不需要改 preset id。

---

## 1. 目前的技術契約（已在 CURRENT 生效，不要改）

路徑由 `shared/visualChoicePreviewManifest.ts:88-105` 產生：

```
/creative-choice/starter-v1/<family>/<preset-id>.webp
```

| 項目 | 值 | 來源 |
| --- | --- | --- |
| 版本目錄 | `starter-v1` | `VISUAL_CHOICE_STARTER_ASSET_VERSION` |
| 長寬比 | `3:2` | `starterPreviewFor().aspect` |
| alt | `${label}：${description}`（無 description 時為 `label`） | `fallbackPreviewFor()` |
| 缺圖行為 | 渲染 SVG／色票 fallback，**不發生任何生成請求、不扣點** | 同上 |

**fallback 分派**（缺圖時畫什麼）：

| family | fallback |
| --- | --- |
| camera | `composition` SVG（依 `CAMERA_MOTIF` 的 11 種構圖示意） |
| lighting | `swatch` 三色票（`LIGHTING_PALETTE`） |
| style | `swatch` 三色票（`STYLE_PALETTE`） |
| action | `pose` SVG（依 `ACTION_ENERGY`：still／gentle／dynamic） |
| expression | `expression` SVG |
| 其他 | icon |

### 建議規格（本文件新增，尚未寫入程式碼）

| 項目 | 規格 | 理由 |
| --- | --- | --- |
| 解析度 | **900 × 600**（3:2，@2x 為 1800×1200） | 面板實際顯示 76px 高（`.visual-choice-preview__* { height: 76px }`），900×600 足夠 3x 且檔案小 |
| 格式 | WebP，quality 82，無透明 | 路徑已寫死 `.webp` |
| 單檔上限 | **60 KB** | 49 張 ≈ 3 MB；面板一次可能載入十餘張 |
| 色彩 | sRGB | |
| 命名 | 檔名 = preset id + `.webp`，**逐字相同**（含 `.` 分隔） | 例：`action.looking_back.webp` |

> **已知現況**：`starter-v1` 目錄目前沒有任何 `.webp`。每個 preset 都會發出一個回傳 SPA `index.html` 的 404 請求，再落回 SVG fallback。放圖之後即自然消失；若要在放圖前先修，屬 v4/UI 的既有議題，不在本文件範圍。

---

## 2. 控制變因（**最重要的一節**）

Starter Pack 的價值來自「同組之內只有一個變數」。做不到這件事，這批圖就只是裝飾。

每個 family 各有一張 **canonical scene**（基準畫面）。同一 family 的所有圖，
除了該 family 要表達的那一項，其餘全部逐字相同。

| family | 固定條件 | 變動條件 | canonical scene |
| --- | --- | --- | --- |
| **action** | 同一角色、同一服裝、**中景平視固定機位**、同一背景、同一光線 | **只有身體動作** | A |
| **expression** | 同一張臉、**同一 framing（中特寫）**、同一光線、同一背景、頭部角度固定 | **只有表情** | B |
| **camera** | 同一角色、同一 Scene、**同一動作（站立）**、同一光線 | **只有鏡別／機位／運鏡** | C |
| **lighting** | 同一 Scene、**同一構圖與機位**、同一角色姿態 | **只有光線與時間感** | D |
| **composition**（規劃中） | 同一角色、同一 Scene、同一光線 | **只有主體在畫面中的位置與留白** | C |
| **style** | **同一張 canonical image 的同一內容** | **只有畫風** | E |

### Canonical scenes

| id | 內容 | 用於 |
| --- | --- | --- |
| **A** | 海邊民宿前的空地，午後日光；成年女性角色，米白外套，全身入鏡，中景平視，背景為木造民宿與海平線 | action |
| **B** | 同一角色的中特寫（胸上），柔和側光，背景虛化為民宿木牆 | expression |
| **C** | 同一角色站立於民宿門廊，正午柔光，背景含門廊、海平線與一張木椅（提供景深參照） | camera、composition |
| **D** | 無人物的民宿門廊空景，固定機位中景，構圖固定 | lighting |
| **E** | 同一角色回頭望向海面的半身畫面（單一 canonical image） | style |

> **製作順序建議**：先把 A–E 五張基準畫面定稿並存檔，其餘 49 張全部從基準畫面延伸。
> 不要每張各自從頭生成——那正是「控制變因」失效的原因。

---

## 3. 提示詞骨架（Gemini／Firefly 通用）

每張圖 = **canonical scene 敘述** + **該 preset 的 `promptFragment`** + **共同尾綴**。

共同尾綴（所有 49 張逐字相同）：

```
consistent character identity and wardrobe across the whole set,
same art direction, 3:2 aspect ratio, clean uncluttered background,
no text, no watermark, no UI elements, no borders
```

依 family 加上鎖定句：

| family | 鎖定句（附加在尾綴前） |
| --- | --- |
| action | `fixed medium shot, eye level, identical framing and lighting across the set; only the body pose changes` |
| expression | `fixed medium close-up, identical head angle and lighting; only the facial expression changes` |
| camera | `identical subject, wardrobe, location and lighting; only the camera framing changes` |
| lighting | `identical empty location and fixed camera framing; only the light and time of day change` |
| style | `identical subject and composition; only the rendering style changes` |

每個 preset 的英文 `promptFragment` 已存在於 `shared/visualChoicePresets.ts`，直接取用（見 §5 表格）。

---

## 4. Adobe 製作指引

**Firefly（批量生成）**
1. 先用 Firefly 生成 canonical scene A–E 並各自存為參考圖。
2. 用 **Structure reference**（camera/composition/lighting）與 **Style reference**（style）鎖住不該變的部分。
3. action／expression 用同一參考圖 + `Generative Fill` 只改人物區域，避免整張重畫造成背景漂移。

**Photoshop（後製一致化）**
1. 全部圖片置入同一份 900×600 範本，套用同一組 Camera Raw 設定，消除批次間色偏。
2. 用 Action 批次匯出 WebP q82；檔名直接取 preset id。
3. lighting family **不要**再套任何調色，否則變因就不只一個。

**Illustrator（fallback 對齊，可選）**
若要把現有 SVG fallback 升級成正式插畫，保持 `CAMERA_MOTIF` 的 11 種構圖示意語彙不變，
否則有圖與無圖兩種狀態會語意不一致。

---

## 5. 逐項清單（49 項，由 `shared/visualChoicePresets.ts` 機器產生）

> `structured 寫入` 欄＝選這張卡實際會寫進 Shot 的欄位，供設計者理解語意；製圖不需要改它。

### action（10 項）

| stable id | 中文 | 英文 promptFragment | structured 寫入 | 檔名 | manifest 路徑 |
| --- | --- | --- | --- | --- | --- |
| `action.standing` | 站立（自然站姿） | standing naturally, relaxed posture | `{ action: "站立，自然姿態" }` | `action.standing.webp` | `/creative-choice/starter-v1/action/action.standing.webp` |
| `action.walking` | 行走（向前走） | walking forward at a natural pace | `{ action: "向前行走" }` | `action.walking.webp` | `/creative-choice/starter-v1/action/action.walking.webp` |
| `action.running` | 奔跑（快速跑動） | running quickly, dynamic motion | `{ action: "奔跑" }` | `action.running.webp` | `/creative-choice/starter-v1/action/action.running.webp` |
| `action.looking_back` | 回頭望（身體仍向前、頭部回望） | looking back over the shoulder while body faces forward | `{ action: "回頭望，身體仍朝前" }` | `action.looking_back.webp` | `/creative-choice/starter-v1/action/action.looking_back.webp` |
| `action.pointing` | 指向（伸手指前方） | pointing forward with one hand | `{ action: "伸手指前方" }` | `action.pointing.webp` | `/creative-choice/starter-v1/action/action.pointing.webp` |
| `action.sitting` | 坐下（坐姿） | sitting down, calm posture | `{ action: "坐下" }` | `action.sitting.webp` | `/creative-choice/starter-v1/action/action.sitting.webp` |
| `action.reaching` | 伸手（向前伸手） | reaching out with one hand | `{ action: "向前伸手" }` | `action.reaching.webp` | `/creative-choice/starter-v1/action/action.reaching.webp` |
| `action.thinking` | 思考姿（手托腮或沉思） | in a thoughtful pose, hand near chin | `{ action: "思考姿，略托腮" }` | `action.thinking.webp` | `/creative-choice/starter-v1/action/action.thinking.webp` |
| `action.reacting` | 反應（身體微微後退或驚起） | reacting with a slight body movement | `{ action: "身體微微反應" }` | `action.reacting.webp` | `/creative-choice/starter-v1/action/action.reacting.webp` |
| `action.crouching` | 蹲下（低姿） | crouching low | `{ action: "蹲下" }` | `action.crouching.webp` | `/creative-choice/starter-v1/action/action.crouching.webp` |

### expression（10 項）

| stable id | 中文 | 英文 promptFragment | structured 寫入 | 檔名 | manifest 路徑 |
| --- | --- | --- | --- | --- | --- |
| `expression.neutral` | 平靜 | neutral calm expression | `{ performance: { emotion: "平靜" } }` | `expression.neutral.webp` | `/creative-choice/starter-v1/expression/expression.neutral.webp` |
| `expression.smile` | 微笑 | gentle smile | `{ performance: { emotion: "微笑" } }` | `expression.smile.webp` | `/creative-choice/starter-v1/expression/expression.smile.webp` |
| `expression.happy` | 開心 | happy, bright expression | `{ performance: { emotion: "開心" } }` | `expression.happy.webp` | `/creative-choice/starter-v1/expression/expression.happy.webp` |
| `expression.surprised` | 驚訝 | surprised expression, eyes slightly widened | `{ performance: { emotion: "驚訝" } }` | `expression.surprised.webp` | `/creative-choice/starter-v1/expression/expression.surprised.webp` |
| `expression.worried` | 擔心 | worried, concerned expression | `{ performance: { emotion: "擔心" } }` | `expression.worried.webp` | `/creative-choice/starter-v1/expression/expression.worried.webp` |
| `expression.determined` | 堅定 | determined, resolute expression | `{ performance: { emotion: "堅定" } }` | `expression.determined.webp` | `/creative-choice/starter-v1/expression/expression.determined.webp` |
| `expression.sad` | 悲傷 | sad, downcast expression | `{ performance: { emotion: "悲傷" } }` | `expression.sad.webp` | `/creative-choice/starter-v1/expression/expression.sad.webp` |
| `expression.angry` | 生氣 | angry expression | `{ performance: { emotion: "生氣" } }` | `expression.angry.webp` | `/creative-choice/starter-v1/expression/expression.angry.webp` |
| `expression.focused` | 專注 | focused, attentive expression | `{ performance: { emotion: "專注" } }` | `expression.focused.webp` | `/creative-choice/starter-v1/expression/expression.focused.webp` |
| `expression.shy` | 害羞 | shy, slightly embarrassed expression | `{ performance: { emotion: "害羞" } }` | `expression.shy.webp` | `/creative-choice/starter-v1/expression/expression.shy.webp` |

### camera（11 項）

| stable id | 中文 | 英文 promptFragment | structured 寫入 | 檔名 | manifest 路徑 |
| --- | --- | --- | --- | --- | --- |
| `camera.wide` | 遠景（環境與人物同框） | wide shot, environment visible | `{ camera: { shotSize: "遠景" } }` | `camera.wide.webp` | `/creative-choice/starter-v1/camera/camera.wide.webp` |
| `camera.full` | 全景（全身） | full shot, full body visible | `{ camera: { shotSize: "全景" } }` | `camera.full.webp` | `/creative-choice/starter-v1/camera/camera.full.webp` |
| `camera.medium` | 中景（腰部以上） | medium shot | `{ camera: { shotSize: "中景" } }` | `camera.medium.webp` | `/creative-choice/starter-v1/camera/camera.medium.webp` |
| `camera.close` | 特寫（臉部與情緒） | close-up shot, focus on face | `{ camera: { shotSize: "特寫" } }` | `camera.close.webp` | `/creative-choice/starter-v1/camera/camera.close.webp` |
| `camera.extreme_close` | 大特寫（眼睛或細節） | extreme close-up | `{ camera: { shotSize: "大特寫" } }` | `camera.extreme_close.webp` | `/creative-choice/starter-v1/camera/camera.extreme_close.webp` |
| `camera.low_angle` | 低角度（仰拍，顯得高大） | low angle shot, looking up | `{ camera: { angle: "低角度" } }` | `camera.low_angle.webp` | `/creative-choice/starter-v1/camera/camera.low_angle.webp` |
| `camera.high_angle` | 高角度（俯拍） | high angle shot, looking down | `{ camera: { angle: "高角度" } }` | `camera.high_angle.webp` | `/creative-choice/starter-v1/camera/camera.high_angle.webp` |
| `camera.eye_level` | 平視（與視線齊平） | eye-level shot | `{ camera: { angle: "平視" } }` | `camera.eye_level.webp` | `/creative-choice/starter-v1/camera/camera.eye_level.webp` |
| `camera.over_shoulder` | 過肩（從角色肩後看） | over-the-shoulder shot | `{ camera: { angle: "過肩" } }` | `camera.over_shoulder.webp` | `/creative-choice/starter-v1/camera/camera.over_shoulder.webp` |
| `camera.slow_push` | 緩推（鏡頭緩慢靠近） | slow push-in camera movement | `{ camera: { movement: "緩推" } }` | `camera.slow_push.webp` | `/creative-choice/starter-v1/camera/camera.slow_push.webp` |
| `camera.static` | 固定（鏡頭不動） | static locked-off camera | `{ camera: { movement: "固定" } }` | `camera.static.webp` | `/creative-choice/starter-v1/camera/camera.static.webp` |

### lighting（10 項）

| stable id | 中文 | 英文 promptFragment | structured 寫入 | 檔名 | manifest 路徑 |
| --- | --- | --- | --- | --- | --- |
| `lighting.morning_soft` | 清晨柔光（溫柔晨光） | soft morning light, gentle warmth | `{ camera: { lighting: "清晨柔光" } }` | `lighting.morning_soft.webp` | `/creative-choice/starter-v1/lighting/lighting.morning_soft.webp` |
| `lighting.daylight` | 日間（自然日光） | natural daylight | `{ camera: { lighting: "日間自然光" } }` | `lighting.daylight.webp` | `/creative-choice/starter-v1/lighting/lighting.daylight.webp` |
| `lighting.overcast` | 陰天（柔和漫射） | overcast soft diffused light | `{ camera: { lighting: "陰天柔光" } }` | `lighting.overcast.webp` | `/creative-choice/starter-v1/lighting/lighting.overcast.webp` |
| `lighting.golden_hour` | 黃昏逆光（金色邊緣光） | golden hour backlight, warm rim light | `{ camera: { lighting: "黃昏逆光" } }` | `lighting.golden_hour.webp` | `/creative-choice/starter-v1/lighting/lighting.golden_hour.webp` |
| `lighting.blue_hour` | 藍調時刻（暮色藍光） | blue hour cool twilight light | `{ camera: { lighting: "藍調時刻" } }` | `lighting.blue_hour.webp` | `/creative-choice/starter-v1/lighting/lighting.blue_hour.webp` |
| `lighting.night` | 夜晚（夜景或月光） | night lighting, moonlit or city lights | `{ camera: { lighting: "夜晚" } }` | `lighting.night.webp` | `/creative-choice/starter-v1/lighting/lighting.night.webp` |
| `lighting.rainy` | 雨天（濕潤反射） | rainy atmosphere, wet reflections | `{ camera: { lighting: "雨天" } }` | `lighting.rainy.webp` | `/creative-choice/starter-v1/lighting/lighting.rainy.webp` |
| `lighting.warm_indoor` | 室內暖光（燈火溫暖） | warm indoor practical lighting | `{ camera: { lighting: "室內暖光" } }` | `lighting.warm_indoor.webp` | `/creative-choice/starter-v1/lighting/lighting.warm_indoor.webp` |
| `lighting.cool_indoor` | 室內冷光（偏冷人工光） | cool indoor lighting | `{ camera: { lighting: "室內冷光" } }` | `lighting.cool_indoor.webp` | `/creative-choice/starter-v1/lighting/lighting.cool_indoor.webp` |
| `lighting.foggy` | 霧氣（朦朧大氣） | foggy soft atmospheric light | `{ camera: { lighting: "霧氣" } }` | `lighting.foggy.webp` | `/creative-choice/starter-v1/lighting/lighting.foggy.webp` |

### style（8 項）

| stable id | 中文 | 英文 promptFragment | structured 寫入 | 檔名 | manifest 路徑 |
| --- | --- | --- | --- | --- | --- |
| `style.healing_picturebook` | 治癒繪本風（柔和插畫、溫暖色調） | healing picture-book illustration style, soft colors, gentle lines | `{ styleHint: "治癒繪本風" }` | `style.healing_picturebook.webp` | `/creative-choice/starter-v1/style/style.healing_picturebook.webp` |
| `style.cinematic_anime` | 電影感動畫（有電影感的動畫質感） | cinematic anime style, filmic lighting and composition | `{ styleHint: "電影感動畫" }` | `style.cinematic_anime.webp` | `/creative-choice/starter-v1/style/style.cinematic_anime.webp` |
| `style.soft_watercolor` | 柔和水彩（水彩暈染） | soft watercolor style, gentle washes | `{ styleHint: "柔和水彩" }` | `style.soft_watercolor.webp` | `/creative-choice/starter-v1/style/style.soft_watercolor.webp` |
| `style.graphic_manga` | 圖像漫畫（清晰線條、漫畫分鏡感） | graphic manga style, clean lines | `{ styleHint: "圖像漫畫" }` | `style.graphic_manga.webp` | `/creative-choice/starter-v1/style/style.graphic_manga.webp` |
| `style.realistic_film` | 寫實電影（偏寫實的電影畫面） | realistic cinematic film look | `{ styleHint: "寫實電影" }` | `style.realistic_film.webp` | `/creative-choice/starter-v1/style/style.realistic_film.webp` |
| `style.rough_storyboard` | 粗略分鏡（快速示意、不求精緻） | rough storyboard sketch style, quick indication | `{ styleHint: "粗略分鏡" }` | `style.rough_storyboard.webp` | `/creative-choice/starter-v1/style/style.rough_storyboard.webp` |
| `style.dreamy_softfocus` | 柔焦夢境（柔焦、夢幻） | dreamy soft-focus atmosphere | `{ styleHint: "柔焦夢境" }` | `style.dreamy_softfocus.webp` | `/creative-choice/starter-v1/style/style.dreamy_softfocus.webp` |
| `style.high_contrast` | 高對比（明暗對比強烈） | high contrast dramatic lighting | `{ styleHint: "高對比" }` | `style.high_contrast.webp` | `/creative-choice/starter-v1/style/style.high_contrast.webp` |


---

## 6. 尚未涵蓋（明確標示）

- **composition family 目前不存在。** CURRENT 只有 action / expression / camera / lighting / style 五族（49 項）。
  §2 已先寫好它的控制變因與 canonical scene，但**新增 family 需要 v4 主工程確認 semantic 對應**
  （對映到 `ShotCamera.composition`），本文件不自行新增 preset id。
- 本輪**不產出任何 binary**，只定義規格與製作條件，符合「先把 manifest / path / fallback 做穩」。
- 解析度、檔案大小上限、共同尾綴為本文件**新提案**，尚未寫入程式碼；
  若要強制，建議加進 `client/public/creative-choice/README.md` 與 manifest 驗證。
