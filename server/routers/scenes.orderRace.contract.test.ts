import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const scenes = readFileSync(join(process.cwd(), "server/routers/scenes.ts"), "utf8");
const sceneList = readFileSync(join(process.cwd(), "client/src/components/SceneList.tsx"), "utf8");
const appRoutes = readFileSync(join(process.cwd(), "client/src/app/AppRoutes.tsx"), "utf8");
const phoneRoute = readFileSync(join(process.cwd(), "client/src/mobile/PhoneRoute.tsx"), "utf8");
const storyboard = readFileSync(join(process.cwd(), "client/src/features/storyboard-center/StoryboardStage.tsx"), "utf8");
const animStudio = readFileSync(join(process.cwd(), "client/src/features/animation-studio/AnimationStudio.tsx"), "utf8");

function block(src: string, startNeedle: string, endNeedle: string) {
  const start = src.indexOf(startNeedle);
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  return src.slice(start, end === -1 ? undefined : end);
}

describe("storyboard order / isolation contracts", () => {
  it("insertAfter and restore still take lockSceneOrder and skip soft-deleted rows", () => {
    const insert = block(scenes, "insertAfter:", "remove:");
    expect(insert).toContain("lockSceneOrder");
    expect(insert).toContain("isNull(schema.scenes.deletedAt)");
    const restore = block(scenes, "restore:", "purge:");
    expect(restore).toContain("lockSceneOrder");
    expect(restore).toContain("restoreOrderPlan");
    expect(restore).toContain("shiftFrom");
    expect(restore).not.toContain("orderIndex: Number(maxOrder) + 1");
  });

  it("SceneList queues blank insertAfter so repeated clicks chain the new id", () => {
    expect(sceneList).toContain("createInsertAfterQueue");
    expect(sceneList).toContain("insertQueueRef.current?.enqueue(s.id)");
    expect(sceneList).toContain("enqueue(s.id, { duplicate: true })");
    expect(sceneList).toMatch(/disabled=\{i === 0 \|\| move\.isPending\}/);
    expect(animStudio).toContain("insertQueueRef.current?.enqueue(shot.id)");
  });

  it("/p/:id and /studio/:id remount on project switch; studio is keyed by shot", () => {
    expect(appRoutes).toContain("<ProjectRoute key={params.id} id={params.id} />");
    expect(appRoutes).toContain("<AnimationStudioPage key={params.projectId}");
    expect(phoneRoute).toContain("`key={id}` 由呼叫端（AppRoutes）保留");
    expect(storyboard).toContain("key={studioShot.id}");
    expect(appRoutes).not.toContain("<Route path=\"/studio\"><AnimationStudioPage key=");
  });

  it("move ACKs carry projectId so a late A write cannot land on B", () => {
    const move = block(scenes, "move:", "insertAfter:");
    expect(move).toContain("return { ok: true, projectId: scene.projectId }");
    expect(animStudio).toContain("shouldApplySceneWriteAck");
    expect(sceneList).toContain("shouldApplySceneWriteAck");
    expect(sceneList).toContain("sceneId: boundSceneId");
  });

  it("applyScript CONFLICTS when expectedSceneIds drift; omit does not delete", () => {
    const apply = block(scenes, "applyScript:", "setCards:");
    expect(apply).toContain('code: "CONFLICT"');
    expect(apply).toContain("expectedSceneIds");
    expect(scenes).toContain("永不刪除");
  });
});
