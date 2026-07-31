# Aios 維基文稿（倉庫內來源）

此目錄是 [GitHub Wiki](https://github.com/aa0968111723-prog/ai_os/wiki) 的**可版本控制來源**。

## 頁面

| 檔案 | Wiki 頁面 |
|------|-----------|
| [Home.md](./Home.md) | [Home](https://github.com/aa0968111723-prog/ai_os/wiki) |
| [世界觀與一句話故事.md](./世界觀與一句話故事.md) | 世界觀與一句話故事 |
| [世界觀如何注入-AI-生成.md](./世界觀如何注入-AI-生成.md) | 世界觀如何注入 AI 生成 |
| [協作與鏡像跟隨.md](./協作與鏡像跟隨.md) | 協作與鏡像跟隨 |

## 同步到 GitHub Wiki

Wiki 需先在網頁建立**第一頁**後，才會出現 `ai_os.wiki.git` 遠端。

```bash
# 1) 若尚無任何頁面，瀏覽器開啟：
#    https://github.com/aa0968111723-prog/ai_os/wiki
#    按 Create the first page → 標題 Home → Save（可先空白）

# 2) 推送本目錄
bash scripts/sync-wiki.sh
```
