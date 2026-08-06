/**
 * 資料下載區（需求 #11）：docs/ 與 README 的白名單清單＋檔案解析。
 * 只服務「明確列名」的檔案——不掃目錄、不拼使用者輸入的路徑，杜絕 path traversal；
 * 檔案缺席（例如部署映像沒帶 docs/）時清單自動略過該項，前端以「待補」呈現空分類。
 */
import { stat } from "node:fs/promises";
import path from "node:path";

export type DownloadCategory = "dev" | "model" | "design" | "legal";

export const DOWNLOAD_CATEGORIES: Array<{ id: DownloadCategory; label: string; hint: string }> = [
  { id: "dev", label: "開發筆記", hint: "架構、交接、登入權限設計等技術文件" },
  { id: "model", label: "模型資料", hint: "模型目錄與點數成本對照" },
  { id: "design", label: "UIUX 設計", hint: "設計稿與介面規範" },
  { id: "legal", label: "隱私與法律", hint: "隱私權、使用條款等文件" },
];

interface DownloadEntry {
  /** 相對 repo 根的檔案路徑（同時是對外的識別鍵） */
  file: string;
  title: string;
  category: DownloadCategory;
  /** 受限文件：只有「組長／管理員／開發者」可看／下載（內部工程、維運、安全、部署細節）。
   *  這些文件會揭露認證/權限設計、環境變數、備援/應變流程、甚至已知缺陷清單——一般組員不該取得。 */
  restricted?: boolean;
}

/** 白名單（新文件放進 docs/ 後在此加一行即可上架；design 內容備齊前分類先空著） */
const ENTRIES: DownloadEntry[] = [
  { file: "README.md", title: "專案說明（README）", category: "dev", restricted: true },
  { file: "docs/交接報告.md", title: "交接報告（部署／日常使用／API）", category: "dev", restricted: true },
  { file: "docs/auth-design.md", title: "登入與權限設計", category: "dev", restricted: true },
  { file: "docs/優化評估報告.md", title: "網站優化評估報告（12 點需求）", category: "dev", restricted: true },
  { file: "docs/研究總報告.md", title: "全面研究總報告（缺陷×UX×fal 生態＋優先級背包）", category: "dev", restricted: true },
  { file: "docs/核心缺陷審查報告.md", title: "核心缺陷深度審查（16 維度對抗驗證）", category: "dev", restricted: true },
  { file: "docs/UX審查報告.md", title: "UX 缺陷專項審查（10 維度）", category: "dev", restricted: true },
  { file: "docs/fal生態研究.md", title: "fal.ai 全生態模型研究（15 類 371 模型）", category: "model" },
  { file: "docs/維運手冊.md", title: "維運手冊（部署／備份／應變）", category: "dev", restricted: true },
  { file: "docs/AI代理架構與維運.md", title: "AI 代理架構與維運（Issue #133）", category: "dev", restricted: true },
  { file: "docs/AI代理成熟度與測試報告.md", title: "AI 代理成熟度與測試報告", category: "dev", restricted: true },
  { file: "docs/Zeabur部署.md", title: "Zeabur 部署指南（環境變數／搬遷／驗收）", category: "dev", restricted: true },
  { file: "docs/Google日曆同步.md", title: "Google 日曆直連同步（設定與運作）", category: "dev", restricted: true },
  { file: "docs/模型目錄.md", title: "模型目錄（全模型與點數）", category: "model" },
  { file: "docs/點數校準報告.md", title: "點數 × 官方成本校準報告", category: "model" },
  { file: "docs/隱私權政策.md", title: "隱私權政策（草稿）", category: "legal" },
  { file: "docs/使用條款.md", title: "使用條款（草稿）", category: "legal" },
  { file: "docs/物件儲存與Redis.md", title: "物件儲存（MinIO／S3）與 Redis 設定", category: "dev", restricted: true },
];

const ROOT = process.cwd();

export interface DownloadItem extends DownloadEntry {
  sizeBytes: number;
  updatedAt: string;
}

/** 清單：逐一 stat 白名單檔案，只回實際存在者（映像沒帶的檔自動消失而非 500）。
 *  privileged=false（一般組員）時略過 restricted 文件——清單不列、resolveDownload 也擋。 */
export async function listDownloads(privileged: boolean): Promise<DownloadItem[]> {
  const out: DownloadItem[] = [];
  for (const e of ENTRIES) {
    if (e.restricted && !privileged) continue; // 一般組員看不到受限的內部工程/維運/安全文件
    try {
      const s = await stat(path.join(ROOT, e.file));
      if (s.isFile()) out.push({ ...e, sizeBytes: s.size, updatedAt: s.mtime.toISOString() });
    } catch {
      /* 檔案不存在：略過（部署映像未含、或文件尚未產出） */
    }
  }
  return out;
}

/** 把對外識別鍵解析成絕對路徑：非白名單、或受限文件但呼叫者無權限，一律 null（無任何路徑拼接）。 */
export function resolveDownload(file: string, privileged: boolean): { absPath: string; filename: string } | null {
  const entry = ENTRIES.find((e) => e.file === file);
  if (!entry) return null;
  if (entry.restricted && !privileged) return null; // 受限文件：後端硬擋（前端不列只是第一道）
  return { absPath: path.join(ROOT, entry.file), filename: path.basename(entry.file) };
}
