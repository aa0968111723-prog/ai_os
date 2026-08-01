/**
 * 素材備份授權契約（不依賴 DB／磁碟）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./assetBackup.ts", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

describe("assetBackup endpoint wiring", () => {
  it("index mounts GET /api/admin/backup/assets.tar.gz", () => {
    expect(indexSource).toContain('app.get("/api/admin/backup/assets.tar.gz"');
    expect(indexSource).toContain("streamAssetsTarGz");
    expect(indexSource).toContain("authorizeAssetBackup");
  });

  it("authorizes via ADMIN_BACKUP_TOKEN bearer or superAdmin session", () => {
    expect(source).toContain("ADMIN_BACKUP_TOKEN");
    expect(source).toContain("isSuperAdmin");
    expect(source).toContain("tokenMatches");
  });

  it("records backup_runs and streams tar.gz with assets/ prefix", () => {
    expect(source).toContain("backupRuns");
    expect(source).toContain("TarArchive");
    expect(source).toContain('archive.directory(ASSETS_DIR, "assets")');
    expect(source).toContain("aios_assets_");
  });

  it("empty ADMIN_BACKUP_TOKEN does not open public download", () => {
    // 未設權杖時僅 superAdmin；bearer  alone 不應被當公開
    expect(source).toMatch(/expected && bearer && tokenMatches/);
    expect(source).toContain("伺服器未設定 ADMIN_BACKUP_TOKEN");
  });
});
