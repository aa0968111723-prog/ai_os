# Aios 公共 Agent 素材庫（系統層 · 終端機匯入）

> **原則：不佔用任何使用者專案空間。**
> 本目錄供系統管理員／終端機匯入到 **全站／系統層** 儲存，讓所有使用者、AI 助手、MCP 都能使用。

## 快速終端機匯入

```bash
# 1) 在部署機或本機（有 DB / 管理權限）
cd /path/to/ai_os

# 2) 合併本分支後執行匯入腳本（範例）
npx tsx scripts/import-public-agent-fuel.ts
# 或
node scripts/import-public-agent-fuel.mjs
```

匯入目標應為：
- `scope=site`（全站）資料庫，或
- 系統內建 knowledge / prompt catalog，**不是** 使用者專案 `projectId`

## 目錄結構

```
public-agent-fuel/
├── README.md                 ← 本說明
├── knowledge/                ← Agent 知識筆記（Markdown）
├── prompts/                  ← 提示詞與文案配方（JSONL / MD）
├── catalogs/                 ← 角色原型、場景公式、道具、色票
└── IMPORT.md                 ← 詳細匯入規格
```

## 設計目標

| 對象 | 用途 |
|------|------|
| 一般使用者 | 在工作台「做影片／加入資料／整理專案」時被助手引用 |
| AI 助手 | 讀 knowledge + prompt 配方後生成 |
| MCP | `list_knowledge` / `query_database` 可查到公共燃料 |

## 禁止

- 禁止寫入使用者專案的 `assets` / `knowledge` 當成「公共」
- 禁止用使用者配額儲存本包內容
- 禁止未審核的醫療宣稱與侵權商業角色複製

## 維護

- 新增條目請保持「一檔一主題」
- 標題建議前綴：`【公共·Agent】`
- 匯入腳本需冪等（同一 key 不重複插入）
