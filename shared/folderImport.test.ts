import { describe, expect, it } from "vitest";
import {
  buildFolderManifest,
  diffFolderManifest,
  folderImportOutcome,
  folderImportProgress,
  folderRootName,
  folderTreeFromPaths,
  looksLikeAbsoluteLocalPath,
  normalizeRelativePath,
  parentPathOf,
  uploadRetryDelayMs,
  uploadableEntries,
  clampUploadConcurrency,
  type FolderManifestEntry,
} from "./folderImport";

/**
 * Folder Import 2.0 的行為契約。
 *
 * 這裡釘死的三件事都是「壞掉了也不會噴錯，只會靜靜地做錯」的那種：
 *   1. 原始資料夾結構有沒有被保留（舊版就是在這裡把整條路徑丟成檔名）。
 *   2. 本機絕對路徑會不會外流。
 *   3. 「上傳」與「AI 理解」的進度有沒有被混成同一條假進度。
 */

describe("normalizeRelativePath", () => {
  it("保留完整資料夾結構——不是只剩檔名", () => {
    expect(normalizeRelativePath("北藝專案/人物/安倢/2025/IMG001.jpg"))
      .toBe("北藝專案/人物/安倢/2025/IMG001.jpg");
  });

  it("Windows 反斜線統一成 /", () => {
    expect(normalizeRelativePath("北藝專案\\人物\\IMG001.jpg")).toBe("北藝專案/人物/IMG001.jpg");
  });

  it("★ 拒收本機絕對路徑——它永遠不該離開使用者的電腦", () => {
    expect(normalizeRelativePath("C:\\Users\\Bruce\\Desktop\\a.jpg")).toBeNull();
    expect(normalizeRelativePath("/Users/bruce/Desktop/a.jpg")).toBeNull();
    expect(normalizeRelativePath("\\\\server\\share\\a.jpg")).toBeNull();
    expect(looksLikeAbsoluteLocalPath("C:/Users/Bruce")).toBe(true);
    expect(looksLikeAbsoluteLocalPath("北藝專案/人物")).toBe(false);
  });

  it("拒收跳脫路徑與控制字元", () => {
    expect(normalizeRelativePath("a/../../etc/passwd")).toBeNull();
    expect(normalizeRelativePath("a/\u0000b.jpg")).toBeNull();
  });

  it("忽略多餘的分隔符與 ./", () => {
    expect(normalizeRelativePath("./a//b/c.jpg")).toBe("a/b/c.jpg");
  });

  it("parentPath 與 root 取得正確", () => {
    expect(parentPathOf("北藝專案/人物/安倢/IMG001.jpg")).toBe("北藝專案/人物/安倢");
    expect(parentPathOf("IMG001.jpg")).toBe("");
    expect(folderRootName("北藝專案/人物/IMG001.jpg")).toBe("北藝專案");
    // 沒有資料夾層級時沒有 root 可談——不要硬編一個出來
    expect(folderRootName("IMG001.jpg")).toBeNull();
  });
});

describe("buildFolderManifest", () => {
  const files = [
    { name: "IMG001.jpg", size: 120, lastModified: 1_000, type: "image/jpeg", webkitRelativePath: "北藝專案/人物/安倢/IMG001.jpg" },
    { name: "IMG002.jpg", size: 240, lastModified: 2_000, type: "image/jpeg", webkitRelativePath: "北藝專案/活動/IMG002.jpg" },
    { name: "bad.jpg", size: 10, type: "image/jpeg", webkitRelativePath: "/etc/bad.jpg" },
    { name: "empty.txt", size: 0, type: "text/plain", webkitRelativePath: "北藝專案/empty.txt" },
  ];

  it("以最常見的第一層資料夾當顯示名", () => {
    expect(buildFolderManifest(files).rootDisplayName).toBe("北藝專案");
  });

  it("每一筆都帶完整相對路徑與 parentPath", () => {
    const manifest = buildFolderManifest(files);
    const entry = manifest.entries.find((item) => item.filename === "IMG001.jpg");
    expect(entry?.relativePath).toBe("北藝專案/人物/安倢/IMG001.jpg");
    expect(entry?.parentPath).toBe("北藝專案/人物/安倢");
  });

  it("★ 被跳過的檔案要列出原因，不 silent drop", () => {
    const manifest = buildFolderManifest(files);
    expect(manifest.skipped).toContainEqual({ name: "bad.jpg", reason: "unsafe_path" });
    expect(manifest.skipped).toContainEqual({ name: "北藝專案/empty.txt", reason: "empty" });
    // 0 byte 的不排進上傳佇列
    expect(manifest.entries.some((entry) => entry.size === 0)).toBe(false);
  });

  it("完全沒有資料夾資訊時才用 fallback 名稱", () => {
    const manifest = buildFolderManifest([{ name: "a.jpg", size: 1, type: "image/jpeg" }], "匯入資料夾");
    expect(manifest.rootDisplayName).toBe("匯入資料夾");
  });
});

describe("folderTreeFromPaths", () => {
  it("重建原始資料夾樹，計數包含所有子層", () => {
    const tree = folderTreeFromPaths([
      "北藝專案/人物/安倢/a.jpg",
      "北藝專案/人物/安倢/b.jpg",
      "北藝專案/活動/c.jpg",
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.name).toBe("北藝專案");
    expect(tree[0]!.fileCount).toBe(3);
    const people = tree[0]!.children.find((node) => node.name === "人物");
    expect(people?.fileCount).toBe(2);
    expect(people?.children[0]?.name).toBe("安倢");
  });

  it("根目錄下的檔案不會長出假資料夾", () => {
    expect(folderTreeFromPaths(["a.jpg"])).toEqual([]);
  });
});

describe("diffFolderManifest", () => {
  const entry = (relativePath: string, size: number, lastModified: number | null): FolderManifestEntry => ({
    relativePath,
    filename: relativePath.split("/").at(-1)!,
    parentPath: parentPathOf(relativePath),
    size,
    lastModified,
    mime: null,
  });

  const known = [
    { relativePath: "北藝/a.jpg", size: 100, lastModified: 1_000, uploadStatus: "uploaded" as const },
    { relativePath: "北藝/b.jpg", size: 200, lastModified: 2_000, uploadStatus: "uploaded" as const },
    { relativePath: "北藝/gone.jpg", size: 300, lastModified: 3_000, uploadStatus: "uploaded" as const },
  ];

  it("分類成 UNCHANGED / NEW / MODIFIED / MISSING", () => {
    const diff = diffFolderManifest(known, [
      entry("北藝/a.jpg", 100, 1_000),   // 完全沒變
      entry("北藝/b.jpg", 999, 2_000),   // 大小變了
      entry("北藝/new.jpg", 10, 4_000),  // 新增
    ]);
    expect(diff.counts).toEqual({ UNCHANGED: 1, NEW: 1, MODIFIED: 1, MISSING: 1 });
  });

  it("★ 沒有變動的檔案不會排進上傳佇列——不重傳、不重跑 AI", () => {
    const diff = diffFolderManifest(known, [entry("北藝/a.jpg", 100, 1_000), entry("北藝/new.jpg", 10, 4_000)]);
    expect(uploadableEntries(diff).map((item) => item.relativePath)).toEqual(["北藝/new.jpg"]);
  });

  it("★ MISSING 只被標記出來——這支永遠不會刪除任何東西", () => {
    const diff = diffFolderManifest(known, []);
    expect(diff.counts.MISSING).toBe(3);
    expect(diff.items.every((item) => item.state === "MISSING")).toBe(true);
    // 沒有任何「要刪除」的輸出——刪不刪是使用者的決定
    expect(uploadableEntries(diff)).toEqual([]);
  });

  it("上次沒傳完的，這次要重新排進佇列（不能因為路徑一樣就說沒變動）", () => {
    const diff = diffFolderManifest(
      [{ relativePath: "北藝/a.jpg", size: 100, lastModified: 1_000, uploadStatus: "failed" }],
      [entry("北藝/a.jpg", 100, 1_000)],
    );
    expect(diff.counts.NEW).toBe(1);
    expect(diff.counts.UNCHANGED).toBe(0);
  });

  it("讀不到 lastModified 時只比大小——不會憑空判成已修改", () => {
    const diff = diffFolderManifest(
      [{ relativePath: "北藝/a.jpg", size: 100, lastModified: null, uploadStatus: "uploaded" }],
      [entry("北藝/a.jpg", 100, 9_999)],
    );
    expect(diff.counts.UNCHANGED).toBe(1);
  });
});

describe("folderImportProgress", () => {
  it("★ 上傳與 AI 理解是兩條線，不合成一條假進度", () => {
    const stages = folderImportProgress({
      totalFiles: 1_284,
      uploadedFiles: 827,
      failedFiles: 0,
      skippedFiles: 0,
      analyzedFiles: 512,
      reviewFiles: 18,
      status: "uploading",
    });
    const byKey = new Map(stages.map((stage) => [stage.key, stage]));
    expect(byKey.get("scan")!.detail).toContain("1,284");
    expect(byKey.get("upload")!.detail).toContain("827 / 1,284");
    // AI 的分母是「已上傳」而不是「總數」——否則會宣稱一個還沒傳的檔案已經被理解
    expect(byKey.get("understand")!.total).toBe(827);
    expect(byKey.get("understand")!.detail).toContain("512 / 827");
    expect(byKey.get("review")!.detail).toBe("18 項");
    // 沒有任何「整體百分比」欄位
    expect(stages.map((stage) => stage.key)).toEqual(["scan", "upload", "understand", "review"]);
  });

  it("AI 理解數不會超過已上傳數", () => {
    const stages = folderImportProgress({
      totalFiles: 10, uploadedFiles: 3, failedFiles: 0, skippedFiles: 0,
      analyzedFiles: 99, reviewFiles: 0, status: "uploading",
    });
    expect(stages.find((stage) => stage.key === "understand")!.done).toBe(3);
  });

  it("沒有東西可算時 percent 是 null，不顯示 0%", () => {
    const stages = folderImportProgress({
      totalFiles: 0, uploadedFiles: 0, failedFiles: 0, skippedFiles: 0,
      analyzedFiles: 0, reviewFiles: 0, status: "scanning",
    });
    expect(stages.find((stage) => stage.key === "upload")!.percent).toBeNull();
  });
});

describe("folderImportOutcome", () => {
  it("有失敗就是 partial，不宣稱完成", () => {
    expect(folderImportOutcome({ totalFiles: 3, uploadedFiles: 2, failedFiles: 1, skippedFiles: 0 })).toBe("partial");
    expect(folderImportOutcome({ totalFiles: 3, uploadedFiles: 3, failedFiles: 0, skippedFiles: 0 })).toBe("completed");
    expect(folderImportOutcome({ totalFiles: 3, uploadedFiles: 1, failedFiles: 0, skippedFiles: 0 })).toBe("uploading");
  });
});

describe("上傳佇列參數", () => {
  it("並行數有上下限——不會變成無上限 Promise.all", () => {
    expect(clampUploadConcurrency(undefined)).toBeGreaterThan(0);
    expect(clampUploadConcurrency(1_000)).toBeLessThanOrEqual(6);
    expect(clampUploadConcurrency(0)).toBeGreaterThanOrEqual(1);
  });

  it("退避是遞增且有上限", () => {
    expect(uploadRetryDelayMs(1)).toBeLessThan(uploadRetryDelayMs(2));
    expect(uploadRetryDelayMs(50)).toBeLessThanOrEqual(8_000);
  });
});
