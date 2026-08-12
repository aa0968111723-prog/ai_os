# AIOS Public Agent Fuel Library

**目的：** 提供系統級公共素材，供所有使用者、AI 助手、MCP 代理使用。

**重要：** 此包不占用任何使用者專案空間。必須經由終端機 / 管理員腳本匯入到系統共享儲存（全站或內部資料庫）。

## 目錄結構

```
public-agent-fuel/
├── README.md                 # 本檔
├── IMPORT.md                 # 終端機匯入說明
├── knowledge/                # 結構化知識筆記（Markdown）
├── prompts/                  # 提示詞庫（分類 JSON/MD）
├── schemas/                  # 資料庫 schema 建議
├── characters/               # 公共角色原型
├── scenes/                   # 場景公式
└── scripts/                  # 匯入腳本示例
```

## 終端機匯入原則

1. `git pull` 此分支
2. 執行 `scripts/import-to-system.sh`（或對應管理員命令）
3. 內容寫入 **全站 / 系統共享** 資料庫與知識庫
4. **絕不** 寫入任何使用者專案

## 內容摘要

- 畫風聖經（手繪插畫、溫暖活潑簡約等）
- 角色一致性方法（2026 Flux / Reference Sheet）
- 提示詞配方庫
- 場景公式庫
- 短影片故事結構
- 台風巴威 2026 摘要
- 工作台 SOP（做影片 / 加入資料 / 整理專案）
- 大量公共 Prompt 模板

請參閱 `IMPORT.md` 進行實際匯入。
