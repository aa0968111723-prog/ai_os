import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  avatarRelPath,
  avatarAbsPath,
  isAvatarRelPath,
  parseAvatarDataUrl,
  publicAvatarUrl,
  MAX_AVATAR_BYTES,
} from "./userAvatar";

describe("userAvatar service", () => {
  const validUuid = "12345678-1234-1234-1234-123456789abc";

  describe("avatarRelPath", () => {
    it("generates correct relative path for valid UUID", () => {
      expect(avatarRelPath(validUuid, ".jpg")).toBe(`avatars/${validUuid}.jpg`);
      expect(avatarRelPath(validUuid, ".png")).toBe(`avatars/${validUuid}.png`);
      expect(avatarRelPath(validUuid, ".webp")).toBe(`avatars/${validUuid}.webp`);
    });

    it("throws on invalid UUID", () => {
      expect(() => avatarRelPath("not-a-uuid")).toThrow("非法使用者 id");
      expect(() => avatarRelPath("../../../etc/passwd")).toThrow("非法使用者 id");
    });
  });

  describe("avatarAbsPath", () => {
    it("resolves safe path inside avatars dir", () => {
      const rel = `avatars/${validUuid}.jpg`;
      const abs = avatarAbsPath(rel);
      expect(abs).toContain(path.normalize(rel));
    });

    it("rejects path traversal", () => {
      expect(() => avatarAbsPath("avatars/../../etc/passwd")).toThrow("非法頭像路徑");
    });
  });

  describe("isAvatarRelPath", () => {
    it("matches valid avatar paths", () => {
      expect(isAvatarRelPath(`avatars/${validUuid}.jpg`)).toBe(true);
      expect(isAvatarRelPath(`avatars/${validUuid}.jpeg`)).toBe(true);
      expect(isAvatarRelPath(`avatars/${validUuid}.png`)).toBe(true);
      expect(isAvatarRelPath(`avatars/${validUuid}.webp`)).toBe(true);
    });

    it("rejects invalid paths", () => {
      expect(isAvatarRelPath("avatars/invalid.jpg")).toBe(false);
      expect(isAvatarRelPath("../avatars/12345678-1234-1234-1234-123456789abc.jpg")).toBe(false);
      expect(isAvatarRelPath("uploads/12345678-1234-1234-1234-123456789abc.jpg")).toBe(false);
    });
  });

  describe("parseAvatarDataUrl", () => {
    it("parses valid JPEG data URL", () => {
      // JPEG magic bytes: 0xFF, 0xD8
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const dataUrl = `data:image/jpeg;base64,${buffer.toString("base64")}`;
      const res = parseAvatarDataUrl(dataUrl);
      expect(res).not.toBeNull();
      expect(res?.mime).toBe("image/jpeg");
      expect(res?.buffer.length).toBe(buffer.length);
    });

    it("parses valid PNG data URL", () => {
      // PNG magic bytes: 0x89, 'P', 'N', 'G'
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
      const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
      const res = parseAvatarDataUrl(dataUrl);
      expect(res).not.toBeNull();
      expect(res?.mime).toBe("image/png");
    });

    it("parses valid WebP data URL", () => {
      // WebP header: 'RIFF' .... 'WEBP'
      const buffer = Buffer.concat([
        Buffer.from("RIFF", "latin1"),
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
        Buffer.from("WEBP", "latin1"),
        Buffer.from("VP8 "),
      ]);
      const dataUrl = `data:image/webp;base64,${buffer.toString("base64")}`;
      const res = parseAvatarDataUrl(dataUrl);
      expect(res).not.toBeNull();
      expect(res?.mime).toBe("image/webp");
    });

    it("rejects corrupted magic bytes", () => {
      const buffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
      const dataUrl = `data:image/jpeg;base64,${buffer.toString("base64")}`;
      expect(parseAvatarDataUrl(dataUrl)).toBeNull();
    });

    it("rejects unsupported MIME types", () => {
      const dataUrl = `data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7`;
      expect(parseAvatarDataUrl(dataUrl)).toBeNull();
    });

    it("rejects oversized data", () => {
      const largeBuffer = Buffer.alloc(MAX_AVATAR_BYTES + 100);
      largeBuffer[0] = 0xff;
      largeBuffer[1] = 0xd8;
      const dataUrl = `data:image/jpeg;base64,${largeBuffer.toString("base64")}`;
      expect(parseAvatarDataUrl(dataUrl)).toBeNull();
    });
  });

  describe("publicAvatarUrl", () => {
    it("returns null for empty or invalid paths", () => {
      expect(publicAvatarUrl(validUuid, null)).toBeNull();
      expect(publicAvatarUrl(validUuid, undefined)).toBeNull();
      expect(publicAvatarUrl(validUuid, "invalid/path.jpg")).toBeNull();
    });

    it("returns public url for valid relative path", () => {
      expect(publicAvatarUrl(validUuid, `avatars/${validUuid}.jpg`)).toBe(`/api/avatars/${validUuid}`);
    });
  });
});
