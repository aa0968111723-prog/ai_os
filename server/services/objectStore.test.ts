/**
 * 物件儲存用戶端的單元測試。
 *
 * 重點放在簽章與 key 推導：簽章寫錯的症狀是「403 SignatureDoesNotMatch」，
 * 沒有測試就只能對著真伺服器猜；key 推導寫錯則會安靜地把檔案放到別人的前綴底下。
 * 兩者都不會在型別檢查或一般 e2e 中被抓到。
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  objectKeyFor,
  objectStoreConfig,
  signRequest,
  signingKey,
  uriEncode,
} from "./objectStore";

describe("objectStoreConfig", () => {
  const base = {
    S3_ENDPOINT: "http://minio.internal:9000",
    S3_BUCKET: "aidos",
    S3_ACCESS_KEY_ID: "key",
    S3_SECRET_ACCESS_KEY: "secret",
  } as NodeJS.ProcessEnv;

  it("缺任一必要項就停用（回 null，不是拋錯）", () => {
    expect(objectStoreConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(objectStoreConfig({ ...base, S3_BUCKET: undefined })).toBeNull();
    expect(objectStoreConfig({ ...base, S3_SECRET_ACCESS_KEY: undefined })).toBeNull();
  });

  it("吃 MINIO_* 別名（自架 MinIO 手上只有 ROOT_USER/ROOT_PASSWORD）", () => {
    const config = objectStoreConfig({
      MINIO_ENDPOINT: "minio:9000",
      MINIO_BUCKET: "assets",
      MINIO_ROOT_USER: "admin",
      MINIO_ROOT_PASSWORD: "admin12345",
    } as NodeJS.ProcessEnv);
    expect(config).not.toBeNull();
    expect(config?.accessKeyId).toBe("admin");
    expect(config?.secretAccessKey).toBe("admin12345");
  });

  it("沒帶 scheme 的 endpoint 補成 http（內網 MinIO 常見）", () => {
    expect(objectStoreConfig({ ...base, S3_ENDPOINT: "minio:9000" })?.endpoint).toBe("http://minio:9000");
  });

  it("尾端斜線不會殘留（否則簽章的 canonical path 會多一層）", () => {
    expect(objectStoreConfig({ ...base, S3_ENDPOINT: "https://s3.example.com/" })?.endpoint).toBe("https://s3.example.com");
  });

  it("預設 path-style（MinIO 需要），可用 S3_FORCE_PATH_STYLE=0 關掉", () => {
    expect(objectStoreConfig(base)?.forcePathStyle).toBe(true);
    expect(objectStoreConfig({ ...base, S3_FORCE_PATH_STYLE: "0" })?.forcePathStyle).toBe(false);
    expect(objectStoreConfig({ ...base, S3_FORCE_PATH_STYLE: "false" })?.forcePathStyle).toBe(false);
  });

  it("bucket 名稱不合法時停用，而不是帶著壞值去打 API", () => {
    expect(objectStoreConfig({ ...base, S3_BUCKET: "有中文" })).toBeNull();
    expect(objectStoreConfig({ ...base, S3_BUCKET: "a" })).toBeNull();
    expect(objectStoreConfig({ ...base, S3_BUCKET: "bucket/with/slash" })).toBeNull();
  });

  it("prefix 去掉前後斜線（避免 key 出現連續斜線）", () => {
    expect(objectStoreConfig({ ...base, S3_PREFIX: "/prod/" })?.prefix).toBe("prod");
  });
});

describe("uriEncode", () => {
  it("保留 unreserved 字元不編碼", () => {
    expect(uriEncode("abcXYZ019-._~", false)).toBe("abcXYZ019-._~");
  });

  it("encodeURIComponent 漏掉的 !'()* 也要編（AWS 規格）", () => {
    expect(uriEncode("a!b'c(d)e*f", false)).toBe("a%21b%27c%28d%29e%2Af");
  });

  it("依 encodeSlash 決定斜線是否編碼", () => {
    expect(uriEncode("a/b", false)).toBe("a/b");
    expect(uriEncode("a/b", true)).toBe("a%2Fb");
  });

  it("多位元組字元逐 byte 編碼（中文檔名）", () => {
    expect(uriEncode("中", false)).toBe("%E4%B8%AD");
  });

  it("空白編成 %20 而非 +（+ 只適用 form-encoding，簽章會對不起來）", () => {
    expect(uriEncode("a b", false)).toBe("a%20b");
  });
});

describe("SigV4 簽章", () => {
  // AWS 官方文件「Deriving the signing key」的範例（service=iam）。
  // 用公開的固定向量對照，才驗得出 HMAC 鏈的順序與每一段的輸入都正確——
  // 自己算一遍當期望值只是把同一個錯誤寫兩次。
  it("signingKey 對得上 AWS 官方範例", () => {
    const key = signingKey("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "20150830", "us-east-1", "iam");
    expect(key.toString("hex")).toBe("c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9");
  });

  // AWS SigV4 測試套件的 get-vanilla 案例：整條路徑（canonical request → string to sign → signature）
  // 一次驗完，是這個模組最有價值的一條測試。
  it("完整簽章對得上 AWS sigv4 測試套件的 get-vanilla", () => {
    const emptyHash = createHash("sha256").update("").digest("hex");
    const { authorization } = signRequest({
      method: "GET",
      canonicalUri: "/",
      canonicalQuery: "",
      headers: { host: "example.amazonaws.com", "x-amz-date": "20150830T123600Z" },
      payloadHash: emptyHash,
      now: new Date("2015-08-30T12:36:00Z"),
      config: {
        region: "us-east-1",
        accessKeyId: "AKIDEXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      },
      service: "service",
    });
    expect(authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, " +
        "SignedHeaders=host;x-amz-date, " +
        "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
  });

  it("canonical request 逐段組出來（標頭排序、小寫、空白收斂）", () => {
    const { canonicalRequest } = signRequest({
      method: "GET",
      canonicalUri: "/bucket/key.png",
      canonicalQuery: "",
      headers: {
        "X-Amz-Date": "20250101T000000Z",
        host: "minio:9000",
        "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
      },
      payloadHash: "UNSIGNED-PAYLOAD",
      now: new Date("2025-01-01T00:00:00Z"),
      config: { region: "us-east-1", accessKeyId: "AK", secretAccessKey: "SK" },
    });
    expect(canonicalRequest).toBe(
      [
        "GET",
        "/bucket/key.png",
        "",
        "host:minio:9000",
        "x-amz-content-sha256:UNSIGNED-PAYLOAD",
        "x-amz-date:20250101T000000Z",
        "",
        "host;x-amz-content-sha256;x-amz-date",
        "UNSIGNED-PAYLOAD",
      ].join("\n"),
    );
  });

  it("Authorization 帶正確的 scope 與 SignedHeaders", () => {
    const { authorization } = signRequest({
      method: "PUT",
      canonicalUri: "/bucket/a.png",
      canonicalQuery: "",
      headers: { host: "minio:9000", "x-amz-content-sha256": "abc", "x-amz-date": "20250101T000000Z" },
      payloadHash: "abc",
      now: new Date("2025-01-01T00:00:00Z"),
      config: { region: "ap-northeast-1", accessKeyId: "AKID", secretAccessKey: "SK" },
    });
    expect(authorization).toContain("Credential=AKID/20250101/ap-northeast-1/s3/aws4_request");
    expect(authorization).toContain("SignedHeaders=host;x-amz-content-sha256;x-amz-date");
    expect(authorization).toMatch(/Signature=[0-9a-f]{64}$/);
  });

  it("同樣輸入產生同樣簽章、輸入變一個 byte 簽章就不同（HMAC 有真的吃到內容）", () => {
    const input = {
      method: "GET",
      canonicalUri: "/bucket/a.png",
      canonicalQuery: "",
      headers: { host: "h", "x-amz-content-sha256": "x", "x-amz-date": "20250101T000000Z" },
      payloadHash: "x",
      now: new Date("2025-01-01T00:00:00Z"),
      config: { region: "us-east-1", accessKeyId: "AK", secretAccessKey: "SK" },
    } as const;
    const a = signRequest(input);
    const b = signRequest(input);
    const c = signRequest({ ...input, canonicalUri: "/bucket/b.png" });
    expect(a.authorization).toBe(b.authorization);
    expect(c.authorization).not.toBe(a.authorization);
  });
});

describe("objectKeyFor", () => {
  it("沒有 prefix 時就是原本的相對路徑（與本機後端共用同一組 storage_path）", () => {
    expect(objectKeyFor("2026/08/abc.png", { prefix: "" })).toBe("2026/08/abc.png");
  });

  it("有 prefix 時前置（多環境共用同一個 bucket）", () => {
    expect(objectKeyFor("2026/08/abc.png", { prefix: "prod" })).toBe("prod/2026/08/abc.png");
  });

  it("前導斜線會被吃掉，不產生 //", () => {
    expect(objectKeyFor("/feedback/a.png", { prefix: "prod" })).toBe("prod/feedback/a.png");
  });

  it("路徑跳脫一律拒絕——否則多環境共用 bucket 時等同越權讀寫別人的前綴", () => {
    expect(() => objectKeyFor("../secret.png", { prefix: "prod" })).toThrow("非法儲存路徑");
    expect(() => objectKeyFor("2026/../../etc/passwd", { prefix: "" })).toThrow("非法儲存路徑");
    expect(() => objectKeyFor("a//b.png", { prefix: "" })).toThrow("非法儲存路徑");
    expect(() => objectKeyFor("./a.png", { prefix: "" })).toThrow("非法儲存路徑");
    expect(() => objectKeyFor("", { prefix: "" })).toThrow("非法儲存路徑");
  });
});
