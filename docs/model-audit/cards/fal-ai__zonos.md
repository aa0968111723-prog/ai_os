# fal-ai/zonos

> 審計：R5 · index **#228** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__zonos`  
> OpenAPI **200**（本輪直拉 queue openapi）；`needs=audio` → L2 不進經濟探活。  
> **未**改 verified／points；零 live。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **228** |
| 站內 id | `fal-ai/zonos` |
| endpoint | **同 id** |
| label | Zonos 語音克隆 |
| category / kind | **text-to-speech** · audio |
| tier | **economy** |
| points（目錄） | **1** |
| cost | `按字/秒計費(fal 頁未明列)` |
| verified | **false** |
| needs | **audio**（參考樣音） |
| recommended | false |
| strengths | 開源克隆任意人聲;支援 mp3/wav/m4a 多格式 |
| bestFor | 低成本克隆試驗(中文中等) |
| sourceHint | 參考樣音網址(mp3/wav/m4a) |
| 姊妹 | F5-TTS、MiniMax voice-clone、Qwen-3 clone-voice、Dia voice-clone（#225 **非真克隆**） |
| 情境 | sc-voice-clone **未**列入（pick＝MiniMax／Qwen 1.7b） |

**一句話**：**Zonos** 經濟檔 **真 zero-shot 克隆**——`reference_audio_url`+`prompt` 契約綠；價未明列、中文中等、points=1 試驗向。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **1** |
| cost | 按字/秒計費；**無 parseable $** |
| 校準 | 無 $ → 無法機械 realPrice；扁平 **1** ＝最低試驗檔 |
| 長音／長稿 | 若官方真按秒／字計 → flat 1 可能 **低估**（**P2**） |
| `estimatePointsFor` | 扁平 **1**（cost 無千字／秒可 parse 時不進動態） |

**結論：** **維持 points=1**；不自動改。價目補齊後再校準。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **200** `ZonosInput` / `ZonosOutput` |
| required | **`reference_audio_url`**, **`prompt`** |
| props | 僅上述兩欄（無 seed／language／emotion 旋鈕） |
| output | **`audio`**（File） |
| L2 | 未跑（needs=audio；無 KEY） |
| 結論 | **ready-static-only**（契約對齊；待帶樣音 live） |

### 站內 input

```ts
input: (p, _f, s) => ({ prompt: p, reference_audio_url: s }),
```

| 檢查 | 結果 |
|------|------|
| `prompt` | **綠** required |
| `reference_audio_url` | **綠** required ← `sourceUrl`／s |
| needs=audio | **綠** 生成台強制樣音 |
| 幽靈欄 | 無 text／audio_url 別名誤送 |
| vs F5／MiniMax clone | 欄名各異；Zonos 用 **reference_audio_url**（非 audio_url） |

### OpenAPI 對照（本輪 200）

| 官方 | 站內 | 備註 |
|------|------|------|
| `reference_audio_url` required | ✅ `s` | 「The reference audio.」 |
| `prompt` required | ✅ `p` | 「The content generated using cloned voice.」 |
| output `audio` | extract 認 audio* | ✅ |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 開源 **voice clone TTS**；economy 試驗向 |
| vs MiniMax clone | MiniMax flagship 永久聲線＋高價／次；Zonos 便宜試聽 |
| vs Qwen-3 clone | Qwen 中文 zero-shot 更強候選；Zonos「中文中等」 |
| vs #225 Dia clone path | Dia path **無樣音欄**＝假克隆；Zonos **真**需 reference |
| 格式 | 文案稱 mp3/wav/m4a；OpenAPI 僅 string URL（格式約束在上游） |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ reserveQuota(1)
→ falSubmit("fal-ai/zonos", { prompt, reference_audio_url })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| flat 1 vs 可能按秒/字 | **P2** 長輸出低估風險 |
| verified false | **正確**（無 live） |
| needs=audio | 不進 !needs 經濟 live 佇列 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 TTS | ✅ | needs 音訊源 |
| sc-voice-clone | ❌ | 未入 pickIds |
| recommended | ❌ | |
| 專屬聲線 showdown | ❌ | winner=MiniMax；runner=Qwen 1.7b |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 低成本試克隆任意人聲 | ✅ | bestFor |
| 會方正式固定旁白 | △ | 中文中等；正式 → MiniMax／Qwen |
| 英文克隆草稿 | ✅ | 開源表現通常英文較穩 |
| 無樣音純 TTS | ❌ | 缺 reference → 422 |
| 長稿／長音量產 | △ | 價未明＋flat1 **P2** |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #228 · needs=audio · input prompt+reference_audio_url |
| OpenAPI 本輪 | `ZonosInput` required 雙欄；`ZonosOutput.audio` |
| fal 模型頁 | https://fal.ai/models/fal-ai/zonos |
| `docs/fal生態研究.md` | Zonos 在 fal 確認 |
| 姊妹 | F5-TTS、#225（假克隆對照） |

---

## 9. 建議動作

- [x] 升 stub→完整九章；OpenAPI 直核 required  
- [x] 確認 input 與 OpenAPI **綠**（無缺欄／幽靈欄）  
- [x] 維持 points=1；verified=false；needs=audio  
- [ ] **P2**：補齊 fal 明碼價後重校 points／動態估點  
- [ ] 可選：sc-voice-clone 加 economy runner（Zonos）— 產品決策  
- [ ] **L2**（有 KEY＋樣音）：短 prompt 探活後再談 verified  

**L0 結論：** 真克隆契約綠；經濟試驗定位清楚；價與長音估點待補。  
**未做：** live、改 points、改 verified、改 input。
