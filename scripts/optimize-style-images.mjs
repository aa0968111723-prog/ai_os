#!/usr/bin/env node
/**
 * 畫風縮圖最佳化管線（npm run assets:styles）
 *
 * 起因：`client/public/styles/` 原本直接放 7 張 1024×1024 的 JPG（合計 6.4MB），
 * 而畫面上它們只是 ~160px 寬的選擇卡。手機 5G 進「創作」分頁時要等好幾秒圖才出來，
 * 使用者看到的是一大塊空白漸層——「圖都沒出來、又占版面」。
 *
 * 這支腳本把原圖（assets-src/styles/，不隨前端打包出貨）壓成三種出貨尺寸：
 *   <name>-card.webp   400×300  卡片主圖（4:3，比原本 1:1 少占三成直向空間）
 *   <name>-card.jpg    400×300  給不支援 webp 的瀏覽器（<picture> fallback）
 *   <name>-thumb.webp  128×128  質感小卡與摘要看板縮圖
 * 另外產生 `client/src/generated/styleImageLqip.ts`：每張圖 24×18 的 base64 佔位圖，
 * 內嵌在 JS bundle 裡，第一幀就有顏色可看，圖片載入完才淡入，不會有空白與位移。
 *
 * 冪等：重跑會覆蓋輸出，不動原圖。
 */
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(ROOT, "assets-src", "styles");
const OUT_DIR = path.join(ROOT, "client", "public", "styles");
const LQIP_OUT = path.join(ROOT, "client", "src", "generated", "styleImageLqip.ts");

const CARD = { width: 400, height: 300 };
const THUMB = { width: 128, height: 128 };
const LQIP = { width: 24, height: 18 };

const fmtKb = (bytes) => `${(bytes / 1024).toFixed(1)}KB`;

async function main() {
  const files = (await fs.readdir(SRC_DIR)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
  if (!files.length) throw new Error(`找不到原圖：${SRC_DIR}`);

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(path.dirname(LQIP_OUT), { recursive: true });

  const lqip = {};
  let srcTotal = 0;
  let outTotal = 0;

  for (const file of files) {
    const slug = path.basename(file, path.extname(file));
    const srcPath = path.join(SRC_DIR, file);
    srcTotal += (await fs.stat(srcPath)).size;

    // 每個輸出都從原檔重新開一個 sharp instance——共用 instance 會把前一次的 resize 疊上去。
    const cardWebp = await sharp(srcPath)
      .resize({ ...CARD, fit: "cover", position: "attention" })
      .webp({ quality: 74, effort: 6 })
      .toBuffer();
    const cardJpg = await sharp(srcPath)
      .resize({ ...CARD, fit: "cover", position: "attention" })
      .jpeg({ quality: 72, progressive: true, mozjpeg: true })
      .toBuffer();
    const thumbWebp = await sharp(srcPath)
      .resize({ ...THUMB, fit: "cover", position: "attention" })
      .webp({ quality: 70, effort: 6 })
      .toBuffer();
    const lqipWebp = await sharp(srcPath)
      .resize({ ...LQIP, fit: "cover" })
      .blur(1.2)
      .webp({ quality: 40 })
      .toBuffer();

    await fs.writeFile(path.join(OUT_DIR, `${slug}-card.webp`), cardWebp);
    await fs.writeFile(path.join(OUT_DIR, `${slug}-card.jpg`), cardJpg);
    await fs.writeFile(path.join(OUT_DIR, `${slug}-thumb.webp`), thumbWebp);

    lqip[slug] = `data:image/webp;base64,${lqipWebp.toString("base64")}`;
    outTotal += cardWebp.length + cardJpg.length + thumbWebp.length;

    console.log(
      `  ${slug.padEnd(18)} card.webp ${fmtKb(cardWebp.length).padStart(8)} ` +
        `card.jpg ${fmtKb(cardJpg.length).padStart(8)} ` +
        `thumb ${fmtKb(thumbWebp.length).padStart(7)} ` +
        `lqip ${fmtKb(lqipWebp.length).padStart(6)}`,
    );
  }

  const entries = Object.entries(lqip)
    .map(([slug, uri]) => `  "${slug}": "${uri}",`)
    .join("\n");

  await fs.writeFile(
    LQIP_OUT,
    `// 由 scripts/optimize-style-images.mjs 產生——請勿手改。\n` +
      `// 每張畫風縮圖的 24×18 模糊佔位圖（base64 webp，各約 0.3KB）。\n` +
      `// 內嵌進 bundle 讓卡片第一幀就有顏色，避免空白區塊與載入後的版面位移。\n` +
      `export const STYLE_IMAGE_LQIP: Record<string, string> = {\n${entries}\n};\n`,
    "utf8",
  );

  console.log(
    `\n✔ ${files.length} 張畫風圖：原圖 ${fmtKb(srcTotal)} → 出貨變體合計 ${fmtKb(outTotal)}\n` +
      `  LQIP 已寫入 ${path.relative(ROOT, LQIP_OUT)}`,
  );
}

main().catch((err) => {
  console.error("[optimize-style-images]", err);
  process.exit(1);
});
