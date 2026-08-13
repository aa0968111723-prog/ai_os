import { describe, expect, it } from "vitest";
import {
  CREATIVE_INTENTS,
  defaultCreativeDirections,
  findCreativeIntent,
  starterDirectionKey,
} from "./creativeDirectionPresets";
import {
  CREATIVE_KEEP_FAMILIES,
  DIRECTION_CAMERA_KEYS,
  DIRECTION_PERFORMANCE_KEYS,
  diagnoseDirectionBatch,
  sanitizeDirection,
  type DirectionBaseShot,
} from "./creativeDirections";

/** 一個「什麼都填過」的鏡：起手包若只在空白鏡上才有差，等於沒有方向 */
const RICH_SHOT: DirectionBaseShot = {
  camera: { shotSize: "中景", angle: "平視", movement: "固定", focalLength: "50mm", lighting: "柔光", composition: "三分法" },
  performance: { emotion: "平靜", gaze: "看向遠方" },
  action: "站在窗邊",
};

/** 一個全空的鏡：剛拆完分鏡、還沒調過任何鏡頭語言 */
const EMPTY_SHOT: DirectionBaseShot = { camera: null, performance: null, action: null };

describe("起手包結構", () => {
  it("每個 intent 至少三個方向，id 全域唯一", () => {
    const keys = new Set<string>();
    for (const intent of CREATIVE_INTENTS) {
      expect(intent.directions.length).toBeGreaterThanOrEqual(3);
      for (const direction of intent.directions) {
        const key = starterDirectionKey(intent.id, direction.id);
        expect(keys.has(key)).toBe(false);
        keys.add(key);
      }
    }
    expect(keys.size).toBeGreaterThanOrEqual(12);
  });

  it("每個方向都有人看得懂的名稱與理由（不是參數清單）", () => {
    for (const intent of CREATIVE_INTENTS) {
      for (const direction of intent.directions) {
        expect(direction.label.length).toBeGreaterThan(1);
        expect(direction.rationale?.length ?? 0).toBeGreaterThan(4);
      }
    }
  });

  it("每個方向都掛得到 preview 資源（缺圖時走 fallback，不需要 React 改動）", () => {
    for (const intent of CREATIVE_INTENTS) {
      for (const direction of intent.directions) {
        const preview = direction.previewResource;
        expect(preview?.kind).toBe("image");
        expect(preview && "src" in preview ? preview.src : "").toContain("/creative-choice/");
        expect(preview && "fallback" in preview ? preview.fallback : null).toBeTruthy();
      }
    }
  });

  it("零成本預覽必須看得懂——不准退化成一個點", () => {
    /*
     * fallbackPreviewFor 是靠 id 反查對照表（camera.* / lighting.* / style.* / action.*）。
     * v4 的方向用的是新的命名空間 `intent.<意圖>.<方向>`，全部反查不到 ⇒ 一律落到
     * { kind: "fallback", icon: "•" }。零成本預覽的整個重點是「看不懂 prompt 的人
     * 一眼分辨得出三個方向」，退化成一個點等於沒有預覽。
     * 所以起手包自己講清楚要畫什麼，並由這條測試鎖住。
     */
    for (const intent of CREATIVE_INTENTS) {
      for (const direction of intent.directions) {
        const preview = direction.previewResource;
        const fallback = preview && "fallback" in preview ? preview.fallback : undefined;
        expect({ id: direction.id, kind: fallback?.kind }).not.toEqual({ id: direction.id, kind: "fallback" });
        expect(["composition", "swatch", "pose", "expression"]).toContain(fallback?.kind);
        // alt 由 label＋rationale 組出來，讀螢幕的人拿得到同一份資訊
        expect(fallback?.alt).toContain(direction.label);
      }
    }
  });

  it("同一個意圖裡的三個方向，預覽圖形彼此不同（否則三張看起來一樣）", () => {
    for (const intent of CREATIVE_INTENTS) {
      const shapes = intent.directions.map((direction) => {
        const preview = direction.previewResource;
        const fallback = preview && "fallback" in preview ? preview.fallback : undefined;
        const shape = fallback as { kind?: string; motif?: string; colors?: readonly string[] } | undefined;
        return JSON.stringify([shape?.kind, shape?.motif ?? shape?.colors]);
      });
      expect({ intent: intent.id, unique: new Set(shapes).size }).toEqual({ intent: intent.id, unique: intent.directions.length });
    }
  });
});

describe("Reference Lock：起手包不會偷改角色／造型／場景", () => {
  it("所有方向都宣告保持全部家族", () => {
    for (const intent of CREATIVE_INTENTS) {
      for (const direction of intent.directions) {
        expect([...(direction.keep ?? [])].sort()).toEqual([...CREATIVE_KEEP_FAMILIES].sort());
      }
    }
  });

  it("所有方向的結構化欄位都落在 Camera/Lighting/Action/Performance 白名單內", () => {
    const allowed = new Set<string>([...DIRECTION_CAMERA_KEYS, ...DIRECTION_PERFORMANCE_KEYS]);
    for (const intent of CREATIVE_INTENTS) {
      for (const direction of intent.directions) {
        for (const key of Object.keys(direction.camera ?? {})) expect(allowed.has(key)).toBe(true);
        for (const key of Object.keys(direction.performance ?? {})) expect(allowed.has(key)).toBe(true);
        // sanitize 之後應該完全等價 → 起手包本身沒有越權欄位
        expect(sanitizeDirection(direction).camera ?? null).toEqual(direction.camera ?? null);
        expect(sanitizeDirection(direction).performance ?? null).toEqual(direction.performance ?? null);
      }
    }
  });
});

describe("方向多樣性 — 這是這一輪的核心承諾", () => {
  it("每個 intent 的方向在「已填滿的鏡」上彼此不同、且都真的有差", () => {
    for (const intent of CREATIVE_INTENTS) {
      const report = diagnoseDirectionBatch(RICH_SHOT, intent.directions);
      expect({ intent: intent.id, noop: report.noop }).toEqual({ intent: intent.id, noop: [] });
      expect({ intent: intent.id, dup: report.duplicates }).toEqual({ intent: intent.id, dup: [] });
    }
  });

  it("在全空的鏡上同樣彼此不同（不能只在有底稿時才有差）", () => {
    for (const intent of CREATIVE_INTENTS) {
      const report = diagnoseDirectionBatch(EMPTY_SHOT, intent.directions);
      expect({ intent: intent.id, noop: report.noop }).toEqual({ intent: intent.id, noop: [] });
      expect({ intent: intent.id, dup: report.duplicates }).toEqual({ intent: intent.id, dup: [] });
    }
  });

  it("預設三方向（使用者什麼都沒說）也是三個不同做法", () => {
    const report = diagnoseDirectionBatch(RICH_SHOT, defaultCreativeDirections());
    expect(report.noop).toEqual([]);
    expect(report.duplicates).toEqual([]);
    expect(report.compiled).toHaveLength(3);
  });
});

describe("查找", () => {
  it("findCreativeIntent 用穩定 id 找得到", () => {
    expect(findCreativeIntent("intent.tension")?.label).toBe("不夠有張力");
    expect(findCreativeIntent("nope")).toBeUndefined();
  });
});
