import { describe, expect, it } from "vitest";
import { CREATIVE_INTENTS } from "./creativeDirectionPresets";
import {
  CREATIVE_KEEP_FAMILIES,
  creativeDirectionSchema,
  compileDirection,
  diagnoseDirectionBatch,
  directionsAreDistinct,
  formatDirectionContext,
  sanitizeDirection,
  summarizeDirection,
  type CreativeDirection,
  type DirectionBaseShot,
} from "./creativeDirections";

const BASE: DirectionBaseShot = {
  camera: { shotSize: "中景", angle: "平視", lighting: "柔光" },
  performance: { emotion: "平靜" },
  action: "站在窗邊",
};

const CLOSER: CreativeDirection = {
  id: "closer",
  label: "更靠近人物",
  camera: { shotSize: "特寫" },
  instruction: "臉不要改",
  keep: ["character", "look"],
};

describe("compileDirection", () => {
  it("虛擬套用時只覆寫方向帶到的欄位，其餘保留", () => {
    const compiled = compileDirection(BASE, CLOSER);
    expect(compiled.camera).toEqual({ shotSize: "特寫", angle: "平視", lighting: "柔光" });
    // 方向沒帶 performance/action → 沿用基準，不是被清掉
    expect(compiled.performance).toEqual({ emotion: "平靜" });
    expect(compiled.action).toBe("站在窗邊");
  });

  it("空字串＝清掉該欄位（與 mergeShotDirection 同語意）", () => {
    const compiled = compileDirection(BASE, { id: "d", label: "去掉光線", camera: { lighting: "" } });
    expect(compiled.camera).toEqual({ shotSize: "中景", angle: "平視" });
    expect(compiled.changes).toContain("光線 柔光→－");
  });

  it("action 空字串清掉走位，未帶則沿用", () => {
    expect(compileDirection(BASE, { id: "d", label: "l", action: "" }).action).toBeNull();
    expect(compileDirection(BASE, { id: "d", label: "l" }).action).toBe("站在窗邊");
  });

  it("changes 是人話 before→after，可直接給使用者看", () => {
    const compiled = compileDirection(BASE, CLOSER);
    expect(compiled.changes).toEqual(["鏡別 中景→特寫"]);
    expect(summarizeDirection(compiled)).toBe("更靠近人物（鏡別 中景→特寫）");
  });

  it("沒有任何結構化差異也沒有指示 → differs=false（不該讓使用者花錢生一張一樣的）", () => {
    const same = compileDirection(BASE, { id: "same", label: "沒差", camera: { shotSize: "中景" } });
    expect(same.differs).toBe(false);
    expect(compileDirection(BASE, { id: "x", label: "只有指示", instruction: "再暗一點" }).differs).toBe(true);
  });
});

describe("sanitizeDirection — Reference Lock 是結構保證不是提示詞求情", () => {
  it("越權欄位被丟掉：方向寫不進 Look／角色／場景", () => {
    const hostile = {
      id: "evil",
      label: "偷改造型",
      camera: { shotSize: "特寫", lookIds: ["look-1"], characterIds: ["c-1"] },
      performance: { emotion: "平靜", scenePresetIds: ["s-1"] },
    } as unknown as CreativeDirection;
    const clean = sanitizeDirection(hostile);
    expect(clean.camera).toEqual({ shotSize: "特寫" });
    expect(clean.performance).toEqual({ emotion: "平靜" });
    expect(JSON.stringify(clean)).not.toContain("look-1");
    expect(JSON.stringify(clean)).not.toContain("c-1");
    expect(JSON.stringify(clean)).not.toContain("s-1");
  });

  it("compileDirection 的輸出永遠只有 camera/performance/action 三個欄位", () => {
    const compiled = compileDirection(BASE, {
      id: "evil",
      label: "x",
      camera: { angle: "低角度", assetId: "a-1" },
    } as unknown as CreativeDirection);
    expect(Object.keys(compiled.camera ?? {}).sort()).toEqual(["angle", "lighting", "shotSize"]);
  });

  it("不認得的 keep 家族被濾掉", () => {
    const clean = sanitizeDirection({ id: "d", label: "l", keep: ["character", "nonsense"] as never });
    expect(clean.keep).toEqual(["character"]);
  });

  it("keep 家族清單與 CREATIVE_KEEP_FAMILIES 同步", () => {
    expect([...CREATIVE_KEEP_FAMILIES]).toEqual(["character", "look", "scene", "prop", "style"]);
  });
});

describe("送出邊界：sanitizeDirection 的輸出必須通過伺服器的 .strict() schema", () => {
  it("純顯示欄位（previewResource）被剝掉——起手包的方向可以直接送出", () => {
    for (const intent of CREATIVE_INTENTS) {
      for (const direction of intent.directions) {
        // 起手包帶著 previewResource 供 UI 畫零成本預覽；伺服器 schema 是 .strict()，
        // 整包送過去會 400（實際踩過：每一次「產生方向」都靜默失敗，UI 卻沒有任何動靜）。
        expect(direction.previewResource).toBeTruthy();
        const clean = sanitizeDirection(direction);
        expect("previewResource" in clean).toBe(false);
        // 送出邊界的最終驗證：清乾淨之後必須真的通過伺服器那份 schema
        expect(creativeDirectionSchema.safeParse(clean).success).toBe(true);
      }
    }
  });

  it("任何越權欄位都不會混進送出的 payload", () => {
    const hostile = {
      id: "x", label: "x",
      previewResource: { kind: "image", source: "static", src: "/a.webp", alt: "a" },
      lookIds: ["l-1"],
      assetId: "a-1",
    } as unknown as CreativeDirection;
    const clean = sanitizeDirection(hostile);
    expect(creativeDirectionSchema.safeParse(clean).success).toBe(true);
    expect(JSON.stringify(clean)).not.toContain("l-1");
    expect(JSON.stringify(clean)).not.toContain("a-1");
  });
});

describe("formatDirectionContext", () => {
  it("只補方向／保持／自然語言，不重寫一遍鏡別（避免對擴散模型重複注入）", () => {
    const text = formatDirectionContext(compileDirection(BASE, CLOSER));
    expect(text).toContain("[創作方向] 更靠近人物");
    expect(text).toContain("[保持不變] 角色臉、造型 Look");
    expect(text).toContain("[方向指示] 臉不要改");
    expect(text).not.toContain("特寫");
  });

  it("沒有 keep／instruction 時不產生空段落", () => {
    const text = formatDirectionContext(compileDirection(BASE, { id: "d", label: "純結構", camera: { angle: "低角度" } }));
    expect(text).toBe("[創作方向] 純結構");
  });
});

describe("方向多樣性 — 三個變體必須是三個做法，不是同一 prompt ×3", () => {
  it("結構化結果相同且無指示差異 → 不算不同方向", () => {
    const a = compileDirection(BASE, { id: "a", label: "A", camera: { shotSize: "特寫" } });
    const b = compileDirection(BASE, { id: "b", label: "B", camera: { shotSize: "特寫" } });
    expect(directionsAreDistinct(a, b)).toBe(false);
  });

  it("同樣的結構化、不同的自然語言 → 算不同方向", () => {
    const a = compileDirection(BASE, { id: "a", label: "A", camera: { shotSize: "特寫" }, instruction: "壓暗背景" });
    const b = compileDirection(BASE, { id: "b", label: "B", camera: { shotSize: "特寫" }, instruction: "提亮背景" });
    expect(directionsAreDistinct(a, b)).toBe(true);
  });

  it("diagnoseDirectionBatch 同時抓出 no-op 與重複", () => {
    const report = diagnoseDirectionBatch(BASE, [
      { id: "noop", label: "沒差", camera: { shotSize: "中景" } },
      { id: "close1", label: "近一點", camera: { shotSize: "特寫" } },
      { id: "close2", label: "也是近一點", camera: { shotSize: "特寫" } },
    ]);
    expect(report.noop).toEqual(["noop"]);
    expect(report.duplicates).toEqual([["close1", "close2"]]);
  });

  it("真的不同的三個方向 → 沒有 no-op、沒有重複", () => {
    const report = diagnoseDirectionBatch(BASE, [
      { id: "a", label: "更近", camera: { shotSize: "特寫" } },
      { id: "b", label: "低機位逆光", camera: { angle: "低角度", lighting: "強逆光" } },
      { id: "c", label: "廣角孤立", camera: { shotSize: "遠景", focalLength: "廣角" } },
    ]);
    expect(report.noop).toEqual([]);
    expect(report.duplicates).toEqual([]);
    expect(report.compiled.every((item) => item.differs)).toBe(true);
  });
});
