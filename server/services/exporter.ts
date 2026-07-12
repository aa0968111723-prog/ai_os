/**
 * 交付素材包（盲點掃描定案：不做雲端合成，交付媒體檔給剪映/Premiere 組裝）。
 * 業界標準編號資料夾：01_視頻素材／03_圖像／05_文件（有內容才建）；不含時間軸檔。
 */
import { ZipArchive } from "archiver";
import { proxyFetch } from "./http";
import type { Response } from "express";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { worldviewSchema } from "../../shared/worldview";

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40) || "未命名";
}

export async function exportProjectZip(projectId: string, res: Response): Promise<void> {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new Error("找不到專案");

  const scenes = await db
    .select()
    .from(schema.scenes)
    .where(eq(schema.scenes.projectId, projectId))
    .orderBy(asc(schema.scenes.orderIndex));
  const assets = await db.select().from(schema.assets).where(eq(schema.assets.projectId, projectId));
  const generations = await db.select().from(schema.generations).where(eq(schema.generations.projectId, projectId));

  const worldview = worldviewSchema.parse(project.worldview ?? {});
  const zipName = `${safeName(project.title)}_交付包.zip`;

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`);

  const archive = new ZipArchive({ zlib: { level: 6 } });
  // archiver 對錯誤是發 'error' 事件——未監聽會變 unhandled 'error' 直接讓 Node 程序崩潰。
  archive.on("error", (err) => {
    console.error("[export] 打包錯誤：", err instanceof Error ? err.message : err);
    if (!res.headersSent) res.status(500).end("打包失敗");
    else res.destroy();
  });
  // 用戶端中途取消下載時，停止打包、釋放資源，別再往斷掉的連線寫。
  res.on("close", () => {
    if (!res.writableEnded) archive.destroy();
  });
  archive.pipe(res);

  // 05_文件／腳本與鏡頭表.md（一定有）
  const lines: string[] = [
    `# ${project.title} · 腳本與鏡頭表`,
    "",
    `- 格式：${project.format}（${project.platform}）`,
    `- 一句話故事：${worldview.logline || "—"}`,
    `- 關鍵訊息：${worldview.message || "—"}`,
    `- 調性：${worldview.tones.join("、") || "—"}`,
    `- 禁忌事項：${worldview.taboos.join("；") || "—"}`,
    "",
    "| 鏡號 | 場次 | 秒數 | 類型 | 提示詞 | 模型 |",
    "|---|---|---|---|---|---|",
  ];

  let videoIdx = 0;
  let imageIdx = 0;
  for (const [i, scene] of scenes.entries()) {
    const asset = assets.find((a) => a.id === scene.assetId);
    const gen = asset ? generations.find((g) => g.id === (asset.meta as { generationId?: string })?.generationId) : undefined;
    lines.push(
      `| ${i + 1} | ${scene.title} | ${scene.durationSec}s | ${asset?.kind ?? "—"} | ${gen?.prompt ?? "—"} | ${gen?.modelId ?? "—"} |`,
    );
    if (!asset?.url) continue;
    try {
      const fileRes = await proxyFetch(asset.url);
      if (!fileRes.ok) continue;
      const buffer = Buffer.from(await fileRes.arrayBuffer());
      const num = String(i + 1).padStart(2, "0");
      if (asset.kind === "video") {
        videoIdx += 1;
        archive.append(buffer, { name: `01_視頻素材/${num}_${safeName(scene.title)}.mp4` });
      } else if (asset.kind === "audio") {
        archive.append(buffer, { name: `02_音訊/${num}_${safeName(scene.title)}.wav` });
      } else {
        imageIdx += 1;
        archive.append(buffer, { name: `03_圖像/${num}_${safeName(scene.title)}.jpg` });
      }
    } catch (err) {
      console.warn(`[export] 素材下載失敗 ${asset.url}:`, err instanceof Error ? err.message : err);
      lines.push(`> ⚠ 「${scene.title}」素材下載失敗，未入包（可於系統內重新生成）`);
    }
  }

  lines.push("", `> 共 ${scenes.length} 鏡（影片 ${videoIdx}・圖像 ${imageIdx}）· 由 AI Director OS 產出 · ${new Date().toISOString().slice(0, 10)}`);
  archive.append(lines.join("\n"), { name: "05_文件/腳本與鏡頭表.md" });
  archive.append(
    "資料夾說明：01_視頻素材（依鏡號排序）／03_圖像／05_文件（腳本與鏡頭表）。\n媒體檔請直接匯入剪映或 Premiere 組裝；字幕（04_字幕）於字幕功能上線後加入。\n",
    { name: "README.txt" },
  );

  await archive.finalize();
}
